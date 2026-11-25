// GitHub as an AppPort provider of Eve (feltkit({ providers })): three neutral contract families, ported from Eve2's
// standalone GitHub provider (rkendel1/eve2 experiments/eve2-on-appboundry/providers/github.mjs, live-tested):
//   tracker.items.*   issues: get, find, create, comment
//   code.workspace.*  a working copy: open (or restore), status, list, read, search, write, run (declared checks), result, diff
//   code.changes.*    publish a working copy as a branch and pull request; find; read a pull request back
//
// It runs in the application's server (FeltKit loads it). Its external effects (an issue, a comment, a branch and pull
// request) begin with context.effect.begin({ repository, operation }), so FeltKit records each call before the effect;
// an unanswered call is unknown, never retried, and its verify() finds the effect on GitHub by its operation marker.
// Nothing it holds in memory is the only record: working copies are rebuilt from a base commit and checkpointed files,
// creations are reconciled by marker before anything is sent again, commits are deterministic, branches are never
// force-pushed. Bounds, whatever the caller asks: an allowlist of repositories, branches under eve/, no merge, no
// workflow files, only the checks declared per repository.
//
// FAULT_EXIT_AFTER=<boundary>[#n] (tests only): exit right after that effect, before answering: issue.create,
// comment.create, push, pull.create, write, run.start.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync, readdirSync, rmSync, copyFileSync } from "node:fs";
import { join, normalize, isAbsolute, dirname } from "node:path";
import { tmpdir } from "node:os";
import { defineProvider, providerCapability } from "@appport/core";
import { AppPortError } from "@appport/protocol";
import { s } from "@appport/schema";

const log = (event, fields = {}) => process.stderr.write(`${JSON.stringify({ at: new Date().toISOString(), provider: "github", event, ...fields })}\n`);
// Set when the provider starts (its configuration and credential), read by every capability.
let ALLOWED = [];
let WORK = join(tmpdir(), "eve-workspaces");
let API = "https://api.github.com";
let GIT_URL = "https://github.com/{repository}.git";
let FOOTER = "";
let CHECKS = {};
let TOKEN = null;
const EXIT_AFTER = process.env.FAULT_EXIT_AFTER ?? "";
// Ambient settings that would change what a check reports (NODE_TEST_CONTEXT turns `node --test` into a silent child reporter).
const NOISE_ENV = ["FELTDB_URL", "FELTDB_APPLICATION_ID", "FELTDB_ENVIRONMENT", "FELTDB_MODE", "FELTDB_NAMESPACE", "FELTDB_TOKEN", "NODE_TEST_CONTEXT", "NODE_OPTIONS", "EVE_FELTDB_PATH"];

const sha256 = (v) => createHash("sha256").update(v).digest("hex");
const markerOf = (operation) => `<!-- eve:operation=${operation} -->`;
const [EXIT_BOUNDARY, EXIT_NTH] = [EXIT_AFTER.split("#")[0], Number(EXIT_AFTER.split("#")[1] ?? 1)];
const seen = new Map();
/** FAULT_EXIT_AFTER=<boundary>[#n]: exit right after the n-th occurrence of that effect in this process, before answering. */
function crashAfter(boundary) {
  const n = (seen.get(boundary) ?? 0) + 1;
  seen.set(boundary, n);
  if (EXIT_BOUNDARY !== boundary || n !== EXIT_NTH) return;
  log("fault.exit", { boundary, occurrence: n });
  process.exit(137);
}
function repository(name) {
  if (!ALLOWED.includes(name)) throw new AppPortError("FORBIDDEN", `This provider does not work on ${name}; it serves ${ALLOWED.join(", ")}.`);
  return name;
}

async function gh(method, path, body) {
  const headers = { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "eve-github-provider" };
  if (TOKEN) headers.authorization = `Bearer ${TOKEN}`;
  if (body) headers["content-type"] = "application/json";
  const response = await fetch(`${API}${path}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
  const json = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    log("github.error", { method, path, status: response.status, message: json?.message });
    const code = response.status === 404 ? "NOT_FOUND" : response.status === 401 || response.status === 403 ? "FORBIDDEN" : response.status === 409 || response.status === 422 ? "CONFLICT" : response.status === 429 ? "RATE_LIMITED" : "provider.UNAVAILABLE";
    throw new AppPortError(code, `GitHub ${method} ${path.split("?")[0]}: ${json?.message ?? response.status}`);
  }
  log("github.call", { method, path: path.split("?")[0], status: response.status });
  return json;
}

/* ------------------------------------------------------------------ tracker.items.* */

const item = (i) => ({ number: i.number, title: i.title, state: i.state, url: i.html_url, author: i.user?.login, labels: (i.labels ?? []).map((l) => l.name ?? l), body: i.body ?? "" });
/**
 * Recent issues and pull requests (one numbering) carrying the marker, newest first. GitHub's list lags a just-created
 * item by seconds (observed live: 7 s), so after the list, the numbers above its newest are read one by one until one
 * does not exist.
 */
async function recentWithMarker(r, marker) {
  const listed = await gh("GET", `/repos/${r}/issues?state=all&sort=created&direction=desc&per_page=100`);
  const items = [...listed];
  for (let n = Math.max(0, ...listed.map((i) => i.number)) + 1, probes = 0; probes < 20; n++, probes++) {
    try { items.unshift(await gh("GET", `/repos/${r}/issues/${n}`)); } catch (error) { if (error.code === "NOT_FOUND") break; throw error; }
  }
  return items.filter((i) => (i.body ?? "").includes(marker));
}
const issuesWithMarker = async (r, marker) => (await recentWithMarker(r, marker)).filter((i) => !i.pull_request).map(item);
async function pullWithMarker(r, marker) {
  const [found] = (await recentWithMarker(r, marker)).filter((i) => i.pull_request);
  return found ? gh("GET", `/repos/${r}/pulls/${found.number}`) : null;
}

const tracker = [
  providerCapability({
    name: "tracker.items.get", version: 1, description: "Read an issue with its comments.",
    input: s.object({ repository: s.string(), number: s.number() }), output: s.unknown(), authorization: ["repo.read"],
    handler: async ({ repository: r, number }) => {
      const issue = await gh("GET", `/repos/${repository(r)}/issues/${number}`);
      const comments = await gh("GET", `/repos/${r}/issues/${number}/comments?per_page=100`);
      return { ...item(issue), comments: comments.map((c) => ({ id: String(c.id), author: c.user?.login, body: c.body, at: c.created_at })) };
    },
  }),
  providerCapability({
    name: "tracker.items.find", version: 1, description: "Find issues by an operation marker (exact), or by words in the title (possible duplicates).",
    input: s.object({ repository: s.string(), operation: s.optional(s.string()), query: s.optional(s.string()) }), output: s.unknown(), authorization: ["repo.read"],
    handler: async ({ repository: r, operation, query }) => {
      repository(r);
      if (operation) return { matches: await issuesWithMarker(r, markerOf(operation)), by: "operation" };
      const issues = await gh("GET", `/repos/${r}/issues?state=all&per_page=100`);
      const words = (query ?? "").toLowerCase().split(/\W+/).filter((w) => w.length > 3);
      const scored = issues.filter((i) => !i.pull_request).map((i) => ({ i, hits: words.filter((w) => i.title.toLowerCase().includes(w)).length }));
      return { matches: scored.filter((x) => words.length && x.hits / words.length >= 0.6).map((x) => item(x.i)), by: "title" };
    },
  }),
  providerCapability({
    name: "tracker.items.create", version: 1, description: "Open an issue for an operation. A repeat of the same operation returns the issue it already opened.",
    input: s.object({ repository: s.string(), operation: s.string(), title: s.string(), body: s.string() }), output: s.unknown(), authorization: ["repo.publish"], effect: "consequential", idempotency: "supported",
    handler: async ({ repository: r, operation, title, body }, context) => {
      const marker = markerOf(operation);
      const [existing] = await issuesWithMarker(repository(r), marker);
      if (existing) { log("issue.reconciled", { operation, number: existing.number }); return { ...existing, reconciled: true }; }
      await context.effect.begin({ repository: r, operation });
      const created = item(await gh("POST", `/repos/${r}/issues`, { title, body: `${body}\n\n${marker}${FOOTER}` }));
      log("issue.created", { operation, number: created.number });
      crashAfter("issue.create");
      return { ...created, reconciled: false };
    },
    async verify(call) {
      const { repository: r, operation } = call.detail ?? {};
      if (!r || !operation) return { outcome: "unknown", reason: "the call recorded no repository and operation" };
      const found = await issuesWithMarker(r, markerOf(operation)).catch(() => null);
      if (!found) return { outcome: "unknown", reason: "GitHub did not answer" };
      return found.length ? { outcome: "succeeded", evidence: { issue: found[0].number, url: found[0].url } } : { outcome: "failed", evidence: { repository: r, operation, issue: "none carries the marker" } };
    },
  }),
  providerCapability({
    name: "tracker.items.comment", version: 1, description: "Comment on an issue for an operation. A repeat of the same operation returns the comment it already made.",
    input: s.object({ repository: s.string(), number: s.number(), operation: s.string(), body: s.string() }), output: s.unknown(), authorization: ["repo.publish"], effect: "consequential", idempotency: "supported",
    handler: async ({ repository: r, number, operation, body }, context) => {
      const marker = markerOf(operation);
      const comments = await gh("GET", `/repos/${repository(r)}/issues/${number}/comments?per_page=100`);
      const existing = comments.find((c) => (c.body ?? "").includes(marker));
      if (existing) return { id: String(existing.id), url: existing.html_url, reconciled: true };
      await context.effect.begin({ repository: r, number, operation });
      const c = await gh("POST", `/repos/${r}/issues/${number}/comments`, { body: `${body}\n\n${marker}${FOOTER}` });
      crashAfter("comment.create");
      return { id: String(c.id), url: c.html_url, reconciled: false };
    },
    async verify(call) {
      const { repository: r, number, operation } = call.detail ?? {};
      if (!r || !number || !operation) return { outcome: "unknown", reason: "the call recorded no repository, issue and operation" };
      const comments = await gh("GET", `/repos/${r}/issues/${number}/comments?per_page=100`).catch(() => null);
      if (!comments) return { outcome: "unknown", reason: "GitHub did not answer" };
      const found = comments.find((c) => (c.body ?? "").includes(markerOf(operation)));
      return found ? { outcome: "succeeded", evidence: { comment: String(found.id), url: found.html_url } } : { outcome: "failed", evidence: { repository: r, issue: number, comment: "none carries the marker" } };
    },
  }),
];

/* ------------------------------------------------------------------ code.workspace.* */

const workspaces = new Map();
const runs = new Map();

function exec(argv, cwd, timeoutMs, extraEnv = {}) {
  return new Promise((resolve) => {
    const env = { ...process.env, CI: "1", NO_COLOR: "1", FORCE_COLOR: "0", ...extraEnv };
    for (const k of NOISE_ENV) delete env[k];
    const child = spawn(argv[0], argv.slice(1), { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    const keep = (d) => { out += d; if (out.length > 400_000) out = out.slice(-200_000); };
    child.stdout.on("data", keep); child.stderr.on("data", keep);
    const started = Date.now();
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("close", (code, signal) => { clearTimeout(timer); resolve({ exitCode: code ?? -1, signal, durationMs: Date.now() - started, output: out }); });
  });
}
async function git(dir, args, timeoutMs = 60_000) {
  const r = await exec(["git", "-c", "advice.detachedHead=false", ...args], dir, timeoutMs);
  if (r.exitCode !== 0) throw new AppPortError("provider.UNAVAILABLE", `git ${args[0]} failed: ${r.output.trim().slice(-400)}`);
  return r.output.trim();
}
/** The content tree of a directory as git would commit it: the identity of the revision a check ran on. */
async function tree(dir) {
  await git(dir, ["add", "-A"]);
  return git(dir, ["write-tree"]);
}
function workspace(id) {
  const w = workspaces.get(id);
  if (!w) throw new AppPortError("NOT_FOUND", `Workspace ${id} is not open in this provider process; open it again from its base and checkpoint.`);
  return w;
}
function inside(w, path) {
  const p = normalize(path ?? ".").replace(/^\/+/, "");
  if (isAbsolute(p) || p.startsWith("..") || p === ".git" || p.startsWith(".git/")) throw new AppPortError("INVALID_INPUT", `Path ${path} is outside the working copy.`);
  return { rel: p, abs: join(w.dir, p) };
}
/** Clone `repository` into `dir` at `sha` (or the default branch's head). Returns { sha, base }. */
async function checkout(r, dir, sha) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const url = GIT_URL.replace("{repository}", r);
  await git(dir, ["init", "-q"]);
  // Installed dependencies are never part of a working copy's content, whether or not the repository ignores them.
  writeFileSync(join(dir, ".git", "info", "exclude"), "node_modules/\n");
  await git(dir, ["remote", "add", "origin", url]);
  const head = await git(dir, ["ls-remote", "--symref", "origin", "HEAD"], 120_000);
  const base = /ref: refs\/heads\/(\S+)\s+HEAD/.exec(head)?.[1] ?? "main";
  await git(dir, ["fetch", "-q", "--depth", "50", "origin", sha ?? `refs/heads/${base}`], 300_000);
  await git(dir, ["checkout", "-q", "--detach", "FETCH_HEAD"]);
  return { sha: await git(dir, ["rev-parse", "HEAD"]), base };
}
function prepareRun(w, dir, label) {
  const spec = CHECKS[w.repository]?.prepare;
  return spec ? exec(spec.argv, dir, spec.timeoutMs).then((r) => { log("check.finished", { workspace: w.id, check: label, exitCode: r.exitCode, durationMs: r.durationMs }); return r; }) : Promise.resolve({ exitCode: 0, durationMs: 0, output: "" });
}
function startRun(w, check, target, against) {
  const spec = CHECKS[w.repository]?.[check];
  if (!spec || check === "prepare") throw new AppPortError("INVALID_INPUT", `Unknown check ${check}; declared: ${Object.keys(CHECKS[w.repository] ?? {}).filter((c) => c !== "prepare").join(", ")}.`);
  if (spec.target && !target) throw new AppPortError("INVALID_INPUT", `${check} needs a target path.`);
  const rel = target ? inside(w, target).rel : null;
  const id = `run_${sha256(`${w.id}:${check}:${rel}:${against}:${Date.now()}:${Math.random()}`).slice(0, 10)}`;
  const run = { id, workspace: w.id, check, target: rel, against, state: "running", startedAt: new Date().toISOString() };
  runs.set(id, run);
  run.promise = (async () => {
    await w.ready;
    let dir = w.dir;
    if (against === "base") {
      // The unmodified base, prepared once, with only the target test copied in: does the test fail without the change?
      if (!w.baseline) w.baseline = (async () => { const d = `${w.dir}-base`; await checkout(w.repository, d, w.sha); const p = await prepareRun(w, d, "prepare-base"); if (p.exitCode !== 0) throw new Error(`base did not prepare: ${p.output.slice(-300)}`); return d; })();
      dir = await w.baseline;
      if (rel) { mkdirSync(dirname(join(dir, rel)), { recursive: true }); copyFileSync(join(w.dir, rel), join(dir, rel)); }
    }
    run.tree = await tree(dir);
    const r = await exec([...spec.argv, ...(rel ? [rel] : [])], dir, spec.timeoutMs);
    Object.assign(run, { state: "finished", exitCode: r.exitCode, signal: r.signal, durationMs: r.durationMs, output: r.output.slice(-6000) });
    log("check.finished", { id, check, target: rel, against, tree: run.tree, exitCode: r.exitCode, durationMs: r.durationMs });
  })().catch((error) => Object.assign(run, { state: "finished", exitCode: -1, output: String(error.message ?? error) }));
  crashAfter("run.start");
  return run;
}
const runView = ({ promise, ...r }) => r;
async function settle(run, waitMs) { await Promise.race([run.promise, new Promise((r) => setTimeout(r, waitMs))]); return runView(run); }

const code = [
  providerCapability({
    name: "code.workspace.open", version: 1,
    description: "Open a working copy named by the consumer: at the default branch, or restored at a base commit with checkpointed file contents. Preparation (install, build) runs in the background.",
    input: s.object({ repository: s.string(), workspace: s.string(), sha: s.optional(s.string()), files: s.optional(s.array(s.object({ path: s.string(), content: s.string() }))) }),
    output: s.unknown(), authorization: ["repo.work"],
    handler: async ({ repository: r, workspace: id, sha, files }) => {
      repository(r);
      if (!/^[a-z0-9_-]{4,64}$/.test(id)) throw new AppPortError("INVALID_INPUT", "A workspace name is 4-64 of a-z, 0-9, _ and -.");
      const existing = workspaces.get(id);
      if (existing) return { workspace: id, repository: r, base: existing.base, sha: existing.sha, tree: await tree(existing.dir), restored: false, reused: true };
      const dir = join(WORK, id);
      const { sha: at, base } = await checkout(r, dir, sha);
      for (const f of files ?? []) { const { abs } = inside({ dir }, f.path); mkdirSync(dirname(abs), { recursive: true }); writeFileSync(abs, f.content); }
      const w = { id, repository: r, dir, sha: at, base };
      w.ready = prepareRun(w, dir, "prepare").then((p) => { w.prepared = p; if (p.exitCode !== 0) throw new AppPortError("provider.UNAVAILABLE", `The working copy did not prepare: ${p.output.slice(-300)}`); });
      w.ready.catch(() => undefined);
      workspaces.set(id, w);
      const t = await tree(dir);
      log("workspace.opened", { id, repository: r, sha: at, base, files: files?.length ?? 0, tree: t });
      return { workspace: id, repository: r, base, sha: at, tree: t, checks: Object.keys(CHECKS[r] ?? {}).filter((c) => c !== "prepare"), restored: Boolean(files?.length) };
    },
  }),
  providerCapability({
    name: "code.workspace.status", version: 1, description: "Whether a working copy is open here and prepared, and its current content tree.",
    input: s.object({ workspace: s.string() }), output: s.unknown(), authorization: ["repo.read"],
    handler: async ({ workspace: id }) => {
      const w = workspace(id);
      await Promise.race([w.ready.catch(() => undefined), new Promise((r) => setTimeout(r, 15_000))]);
      return { workspace: id, sha: w.sha, prepared: w.prepared ? w.prepared.exitCode === 0 : null, prepareOutput: w.prepared && w.prepared.exitCode !== 0 ? w.prepared.output.slice(-2000) : undefined, tree: await tree(w.dir) };
    },
  }),
  providerCapability({
    name: "code.workspace.list", version: 1, description: "List a directory of the working copy.",
    input: s.object({ workspace: s.string(), path: s.optional(s.string()) }), output: s.unknown(), authorization: ["repo.read"],
    handler: async ({ workspace: id, path }) => {
      const w = workspace(id); const { rel, abs } = inside(w, path);
      if (!existsSync(abs) || !statSync(abs).isDirectory()) throw new AppPortError("NOT_FOUND", `${rel} is not a directory.`);
      return { path: rel, entries: readdirSync(abs, { withFileTypes: true }).filter((e) => e.name !== ".git" && e.name !== "node_modules" && e.name !== "dist").map((e) => `${e.name}${e.isDirectory() ? "/" : ""}`).sort() };
    },
  }),
  providerCapability({
    name: "code.workspace.read", version: 1, description: "Read a file (or a range of lines) of the working copy, with line numbers.",
    input: s.object({ workspace: s.string(), path: s.string(), startLine: s.optional(s.number()), endLine: s.optional(s.number()) }), output: s.unknown(), authorization: ["repo.read"],
    handler: async ({ workspace: id, path, startLine, endLine }) => {
      const w = workspace(id); const { rel, abs } = inside(w, path);
      if (!existsSync(abs) || !statSync(abs).isFile()) throw new AppPortError("NOT_FOUND", `${rel} is not a file.`);
      const lines = readFileSync(abs, "utf8").split("\n");
      const from = Math.max(1, startLine ?? 1), to = Math.min(lines.length, endLine ?? Math.min(lines.length, from + 299));
      return { path: rel, sha: w.sha, startLine: from, endLine: to, totalLines: lines.length, content: lines.slice(from - 1, to).map((l, i) => `${from + i}\t${l}`).join("\n") };
    },
  }),
  providerCapability({
    name: "code.workspace.search", version: 1, description: "Search the working copy for a regular expression (git grep). A dependency's own source is searchable with path node_modules/<package>.",
    input: s.object({ workspace: s.string(), pattern: s.string(), path: s.optional(s.string()) }), output: s.unknown(), authorization: ["repo.read"],
    handler: async ({ workspace: id, pattern, path }) => {
      const w = workspace(id);
      const scope = path ? inside(w, path).rel : null;
      const r = scope?.startsWith("node_modules/") || scope?.includes("/node_modules/")
        ? await exec(["grep", "-rnIE", "--max-count=20", "--exclude-dir=node_modules", pattern, `${scope.replace(/\/$/, "")}/`], w.dir, 30_000)
        : await exec(["git", "grep", "-n", "-I", "-E", "--max-count", "20", pattern, "--", ...(scope ? [scope] : [])], w.dir, 30_000);
      const matches = r.output.split("\n").filter(Boolean).slice(0, 120).map((l) => { const m = /^([^:]+):(\d+):(.*)$/.exec(l); return m ? { path: m[1], line: Number(m[2]), text: m[3].slice(0, 240) } : null; }).filter(Boolean);
      return { pattern, matches, truncated: r.output.split("\n").length > 120 };
    },
  }),
  providerCapability({
    name: "code.workspace.write", version: 1, description: "Write a file of the working copy (whole content). Workflow files are refused. Answers with the new content tree.",
    input: s.object({ workspace: s.string(), path: s.string(), content: s.string() }), output: s.unknown(), authorization: ["repo.work"],
    handler: async ({ workspace: id, path, content }) => {
      const w = workspace(id); const { rel, abs } = inside(w, path);
      if (rel.startsWith(".github/")) throw new AppPortError("FORBIDDEN", "Workflow and repository settings files are not written by this provider.");
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content);
      crashAfter("write");
      return { path: rel, bytes: Buffer.byteLength(content), sha256: sha256(content), tree: await tree(w.dir) };
    },
  }),
  providerCapability({
    name: "code.workspace.run", version: 1,
    description: "Start a declared check (build, or test with a target path) on the working copy, or with against \"base\" on the unmodified base commit with only the target test copied in. Answers when it finishes or after 20 s with its run id. Results name the content tree they ran on.",
    input: s.object({ workspace: s.string(), check: s.string(), target: s.optional(s.string()), against: s.optional(s.enum(["change", "base"])) }), output: s.unknown(), authorization: ["repo.work"],
    handler: async ({ workspace: id, check, target, against }) => settle(startRun(workspace(id), check, target, against ?? "change"), 20_000),
  }),
  providerCapability({
    name: "code.workspace.result", version: 1, description: "The state of a check run, and its output once finished. Runs do not outlive this provider process.",
    input: s.object({ run: s.string() }), output: s.unknown(), authorization: ["repo.read"],
    handler: async ({ run }) => { const r = runs.get(run); if (!r) throw new AppPortError("NOT_FOUND", `Run ${run} is not known to this provider process; run the check again.`); return settle(r, 15_000); },
  }),
  providerCapability({
    name: "code.workspace.diff", version: 1, description: "What changed in the working copy since its base commit, with the content tree.",
    input: s.object({ workspace: s.string() }), output: s.unknown(), authorization: ["repo.read"],
    handler: async ({ workspace: id }) => {
      const w = workspace(id);
      const t = await tree(w.dir);
      const stat = (await git(w.dir, ["diff", "--cached", "--numstat", w.sha])).split("\n").filter(Boolean).map((l) => { const [a, d, p] = l.split("\t"); return { path: p, additions: Number(a), deletions: Number(d) }; });
      const patch = await git(w.dir, ["diff", "--cached", w.sha]);
      return { base: w.sha, tree: t, files: stat, patch: patch.slice(0, 20_000), patchTruncated: patch.length > 20_000, patchSha256: sha256(patch) };
    },
  }),
];

/* ------------------------------------------------------------------ code.changes.* */

const pr = (p) => ({ number: p.number, url: p.html_url, state: p.state, merged: Boolean(p.merged_at ?? p.merged), draft: p.draft, branch: p.head.ref, headSha: p.head.sha, base: p.base.ref, body: p.body ?? "" });

const changes = [
  providerCapability({
    name: "code.changes.publish", version: 1,
    description: "Publish a working copy for review: a deterministic commit on an eve/ branch, and a pull request for the operation. Reconciles an existing branch (by tree) and pull request (by operation) instead of creating another. Never merges, never force-pushes.",
    input: s.object({ workspace: s.string(), operation: s.string(), branch: s.string(), title: s.string(), body: s.string(), message: s.string(), expectTree: s.string() }), output: s.unknown(), authorization: ["repo.publish"], effect: "consequential", idempotency: "supported",
    handler: async ({ workspace: id, operation, branch, title, body, message, expectTree }, context) => {
      const w = workspace(id);
      if (!/^eve\/[a-z0-9._/-]{1,80}$/.test(branch)) throw new AppPortError("INVALID_INPUT", "Branches are eve/<lowercase name>.");
      const marker = markerOf(operation);
      const owner = w.repository.split("/")[0];
      const steps = [];
      // 1. A pull request for this operation already exists: that is the answer.
      const prs = await gh("GET", `/repos/${w.repository}/pulls?state=all&head=${owner}:${encodeURIComponent(branch)}`);
      const mine = prs.find((p) => (p.body ?? "").includes(marker)) ?? await pullWithMarker(w.repository, marker);
      if (mine) { log("pull.reconciled", { operation, number: mine.number }); return { ...pr(mine), steps: ["pull request already open for this operation"], reconciled: true }; }
      if (prs.length) throw new AppPortError("CONFLICT", `${branch} already has pull request #${prs[0].number}, which is not this operation's.`);
      // 2. The exact content the consumer verified, as a deterministic commit.
      const current = await tree(w.dir);
      if (current !== expectTree) throw new AppPortError("CONFLICT", `The working copy is at tree ${current.slice(0, 12)}, not the verified ${expectTree.slice(0, 12)}; nothing was published.`);
      if (current === await git(w.dir, ["rev-parse", `${w.sha}^{tree}`])) throw new AppPortError("INVALID_INPUT", "Nothing changed in the working copy.");
      const date = (await git(w.dir, ["show", "-s", "--format=%cI", w.sha]));
      const commit = (await exec(["git", "commit-tree", current, "-p", w.sha, "-m", `${message}\n\n${marker.replace(/<!-- | -->/g, "")}`], w.dir, 30_000, {
        GIT_AUTHOR_NAME: "Eve", GIT_AUTHOR_EMAIL: "eve@users.noreply.github.com", GIT_AUTHOR_DATE: date, GIT_COMMITTER_NAME: "Eve", GIT_COMMITTER_EMAIL: "eve@users.noreply.github.com", GIT_COMMITTER_DATE: date,
      })).output.trim();
      if (!/^[0-9a-f]{40}$/.test(commit)) throw new AppPortError("provider.UNAVAILABLE", `Commit failed: ${commit.slice(-300)}`);
      // The first external effect follows: record the call before it.
      await context.effect.begin({ repository: w.repository, operation, branch });
      // 3. The branch: absent → push; present at this commit → done; present with this tree → reuse; anything else → refuse.
      const remote = (await git(w.dir, ["ls-remote", "origin", `refs/heads/${branch}`], 120_000)).split(/\s+/)[0] || null;
      let head = commit;
      if (!remote) {
        const pushed = await exec(["git", "push", "origin", `${commit}:refs/heads/${branch}`], w.dir, 120_000);
        if (pushed.exitCode !== 0) { log("changes.push.refused", { branch, output: pushed.output.slice(-400) }); throw new AppPortError("FORBIDDEN", `Pushing ${branch} was refused: ${pushed.output.trim().split("\n").slice(-2).join(" ")}`); }
        steps.push(`pushed ${branch} at ${commit.slice(0, 12)}`);
        log("changes.pushed", { branch, commit });
        crashAfter("push");
      } else if (remote === commit) {
        steps.push(`${branch} already at ${commit.slice(0, 12)}`);
      } else {
        await git(w.dir, ["fetch", "-q", "--depth", "1", "origin", `refs/heads/${branch}`], 120_000);
        const remoteTree = await git(w.dir, ["rev-parse", "FETCH_HEAD^{tree}"]);
        if (remoteTree !== current) throw new AppPortError("CONFLICT", `${branch} exists at ${remote.slice(0, 12)} with different content; it was not overwritten.`);
        head = remote;
        steps.push(`${branch} already at ${remote.slice(0, 12)} with the same tree`);
      }
      // 4. The pull request.
      const created = await gh("POST", `/repos/${w.repository}/pulls`, { title, body: `${body}\n\n${marker}${FOOTER}`, head: branch, base: w.base, draft: false });
      log("pull.created", { operation, number: created.number, branch, head });
      crashAfter("pull.create");
      return { ...pr(created), steps: [...steps, `opened #${created.number}`], reconciled: false };
    },
    async verify(call) {
      const { repository: r, operation, branch } = call.detail ?? {};
      if (!r || !operation) return { outcome: "unknown", reason: "the call recorded no repository and operation" };
      const found = await pullWithMarker(r, markerOf(operation)).catch(() => undefined);
      if (found === undefined) return { outcome: "unknown", reason: "GitHub did not answer" };
      if (found) return { outcome: "succeeded", evidence: { pullRequest: found.number, url: found.html_url, branch } };
      return { outcome: "unknown", reason: `no pull request carries the marker; the branch ${branch} may have been pushed without one (publish again reconciles it)` };
    },
  }),
  providerCapability({
    name: "code.changes.find", version: 1, description: "Find the branch and pull request of an operation, without changing anything.",
    input: s.object({ repository: s.string(), operation: s.string(), branch: s.string() }), output: s.unknown(), authorization: ["repo.read"],
    handler: async ({ repository: r, operation, branch }) => {
      const owner = repository(r).split("/")[0];
      const prs = await gh("GET", `/repos/${r}/pulls?state=all&head=${owner}:${encodeURIComponent(branch)}`);
      const mine = prs.find((p) => (p.body ?? "").includes(markerOf(operation))) ?? await pullWithMarker(r, markerOf(operation));
      const dir = join(WORK, `.probe-${sha256(r).slice(0, 8)}`);
      if (!existsSync(join(dir, ".git"))) { mkdirSync(dir, { recursive: true }); await git(dir, ["init", "-q"]); await git(dir, ["remote", "add", "origin", GIT_URL.replace("{repository}", r)]); }
      const remote = (await git(dir, ["ls-remote", "origin", `refs/heads/${branch}`], 120_000)).split(/\s+/)[0] || null;
      return { branch: remote ? { name: branch, sha: remote } : null, pullRequest: mine ? pr(mine) : null };
    },
  }),
  providerCapability({
    name: "code.changes.get", version: 1, description: "Read a pull request back: state, head commit, files, and check runs on the head commit.",
    input: s.object({ repository: s.string(), number: s.number() }), output: s.unknown(), authorization: ["repo.read"],
    handler: async ({ repository: r, number }) => {
      const p = await gh("GET", `/repos/${repository(r)}/pulls/${number}`);
      const files = await gh("GET", `/repos/${r}/pulls/${number}/files?per_page=100`);
      const checks = await gh("GET", `/repos/${r}/commits/${p.head.sha}/check-runs?per_page=100`);
      return { ...pr(p), files: files.map((f) => ({ path: f.filename, status: f.status, additions: f.additions, deletions: f.deletions })), checks: (checks.check_runs ?? []).map((c) => ({ name: c.name, status: c.status, conclusion: c.conclusion })) };
    },
  }),
];

/** The provider (feltkit({ providers: { github: { module: "./providers/github.mjs", export: "githubProvider", … } } })). */
export const githubProvider = defineProvider({
  id: "eve-github",
  version: "0.1.0",
  configuration: s.object({
    repositories: s.array(s.string()),
    workdir: s.optional(s.string()),
    apiUrl: s.optional(s.string()),
    gitUrl: s.optional(s.string()),
    footer: s.optional(s.string()),
    // Per repository: check name → { argv, target?: "path", timeoutMs }; "prepare" runs when a working copy opens.
    checks: s.unknown(),
  }),
  credentials: [{ id: "github-token", description: "A GitHub token for the allowed repositories (issues, contents, pull requests). Optional where the network adds it." }],
  async start({ config, credential }) {
    ALLOWED = config.repositories;
    WORK = config.workdir ?? join(tmpdir(), "eve-workspaces");
    API = config.apiUrl ?? "https://api.github.com";
    GIT_URL = config.gitUrl ?? "https://github.com/{repository}.git";
    FOOTER = config.footer ?? "";
    CHECKS = config.checks ?? {};
    TOKEN = (await credential("github-token")) ?? null;
    mkdirSync(WORK, { recursive: true });
    log("started", { repositories: ALLOWED, api: API, token: Boolean(TOKEN), exitAfter: EXIT_AFTER || null });
    return { runtime: {}, health: () => ({ state: "ready" }), close: () => undefined };
  },
  capabilities: [...tracker, ...code, ...changes],
});
