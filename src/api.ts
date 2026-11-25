/**
 * Everything the UI shows comes from the application's API as the signed-in person: eve's recorded sessions (FeltKit's
 * evidence of each), the Resolver receipts in FeltDB, and Resolver's current bindings. On Vercel this UI is served by the
 * same FeltKit application, so the client is same-origin and holds the session in an HttpOnly cookie.
 */
import { createClient } from "@feltdb/feltkit/client";

export const client = createClient();
export const AGENT = "engineer";
export const eve = () => client.eve(AGENT);

export type Fact = Record<string, any> & { kind: string; at?: string };
export interface SessionView { id: string; title: string; createdBy: string; createdAt: number; taskId?: string; evidence?: any; receipt?: any }

export const query = (name: string, args: Record<string, unknown> = {}) => client.query({ name } as never, args as never) as Promise<any>;
export const action = (name: string, args: Record<string, unknown> = {}) => client.action({ name } as never, args as never) as Promise<any>;

/** The calls that act on another system: their outcome is confirmed only by what came back. */
export const CONSEQUENTIAL = new Set(["repo.changes.publish", "repo.issues.create", "repo.issues.comment"]);

/** What a fact is, for the Board: a proposal is not an effect, and an effect is confirmed only by its answer. */
export function classify(f: Fact): { label: string; tone: string } {
  if (f.kind === "message") return { label: "Task", tone: "intent" };
  if (f.kind === "model") return { label: "Model step", tone: "model" };
  if (f.kind === "reply") return { label: "Agent report", tone: "model" };
  if (f.kind === "turn") return { label: `Turn ${f.outcome ?? ""}`.trim(), tone: "neutral" };
  if (f.kind === "approval") return { label: "Approval requested", tone: "approval" };
  if (f.kind === "tool") {
    const consequential = CONSEQUENTIAL.has(f.capability);
    if (f.outcome === "completed") return { label: consequential ? "Confirmed effect" : "Capability call", tone: consequential ? "effect" : "call" };
    if (f.outcome === "failed") return { label: consequential ? "Effect refused / failed" : "Call refused / failed", tone: "failed" };
    if (consequential) return { label: "Effect: outcome not confirmed", tone: "unknown" };
    return { label: "Capability call (running)", tone: "call" };
  }
  return { label: f.kind, tone: "neutral" };
}

export const when = (at?: string | number) => (at ? new Date(at).toLocaleString() : "");
export const short = (v: unknown, n = 140) => { const s = typeof v === "string" ? v : JSON.stringify(v); return s && s.length > n ? `${s.slice(0, n)}…` : s ?? ""; };

/** Pull requests and issues an effect's answer names (from the tool's recorded output). */
export function outcomesOf(timeline: Fact[]): Array<{ kind: string; number: number; url: string; state?: string; at?: string }> {
  const out: Array<{ kind: string; number: number; url: string; state?: string; at?: string }> = [];
  for (const f of timeline) {
    if (f.kind !== "tool" || f.outcome !== "completed" || !f.output || typeof f.output !== "object") continue;
    if ((f.capability === "repo.changes.publish" || f.capability === "repo.changes.get") && f.output.url) out.push({ kind: "Pull request", number: f.output.number, url: f.output.url, state: f.output.merged ? "merged" : f.output.state, at: f.at });
    if (f.capability === "repo.issues.create" && f.output.url) out.push({ kind: "Issue", number: f.output.number, url: f.output.url, state: f.output.state, at: f.at });
  }
  const seen = new Set<string>();
  return out.filter((o) => (seen.has(o.url) ? false : (seen.add(o.url), true)));
}

/** Check runs (tests, builds) with the tree they ran on: the evidence of verification. */
export function runsOf(timeline: Fact[]) {
  return timeline.filter((f) => f.kind === "tool" && (f.capability === "repo.workspace.run" || f.capability === "repo.workspace.result") && f.output && typeof f.output === "object" && f.output.state).map((f) => ({ at: f.at, ...f.output }));
}

/** A component that took part in a fact: who, and what it did there. */
export interface Step { actor: string; kind: "person" | "eve" | "model" | "feltkit" | "appport" | "resolver" | "github" | "workspace" | "feltdb"; did: string; tone?: "ok" | "failed" | "unknown" }

const GITHUB = new Set(["repo.issues.get", "repo.issues.find", "repo.issues.create", "repo.issues.comment", "repo.changes.publish", "repo.changes.find", "repo.changes.get", "repo.workspace.open"]);
const AUTHORITY_CODES = /^(FORBIDDEN|UNAUTHENTICATED|GRANT_|APPROVAL_|NOT_GRANTED|PERMISSION)/;

/**
 * Who did what in a fact, in order, from what the records say. A tool call is always Eve's proposal, FeltKit's bridge
 * and AppPort's check under the person's grant; the provider acts only if the call was let through; GitHub appears
 * only for calls that reach it. Nothing here is guessed: an entry without the field that shows a step leaves it out.
 */
export function actorsOf(f: Fact, s: { createdBy: string; receipt?: any; evidence?: any }): Step[] {
  const model = s.receipt?.refs?.find((r: any) => r.name === "model")?.value;
  switch (f.kind) {
    case "message": return [{ actor: f.from ?? s.createdBy, kind: "person", did: "asked" }, { actor: "FeltKit", kind: "feltkit", did: "signed the request, forwarded to eve" }];
    case "update": return [{ actor: "Person", kind: "person", did: "sent an update" }, { actor: "FeltKit", kind: "feltkit", did: "delivered at a safe boundary" }];
    case "model": return [{ actor: "Eve", kind: "eve", did: "model step" }, { actor: model?.model ?? "model", kind: "model", did: model ? (model.provider ? `via ${model.provider}` : "generated") : "generated (no Resolver receipt for this task)" }];
    case "reply": return [{ actor: "Eve", kind: "eve", did: "reported" }];
    case "turn": return [{ actor: "Eve", kind: "eve", did: `turn ${f.outcome ?? ""}`.trim() }, { actor: "FeltDB", kind: "feltdb", did: "recorded the run" }];
    case "held": return [{ actor: "FeltKit", kind: "feltkit", did: `held at ${f.boundary ?? "boundary"}${f.reason ? `: ${f.reason}` : ""}` }];
    case "approval": return [{ actor: "Eve", kind: "eve", did: "paused for approval" }, { actor: "FeltKit", kind: "feltkit", did: "waiting for a person" }];
    case "resolution": return [{ actor: "Resolver", kind: "resolver", did: "resolved references" }, { actor: "FeltDB", kind: "feltdb", did: "receipt recorded" }];
    case "answer": return [{ actor: f.by, kind: "person", did: f.decision === "approve" ? "approved" : "denied" }, ...(f.approval ? [{ actor: "AppPort", kind: "appport" as const, did: `issued approval ${f.approval}` }] : [])];
    case "tool": {
      const steps: Step[] = [{ actor: "Eve", kind: "eve", did: `called ${f.tool ?? f.capability}` }, { actor: "FeltKit", kind: "feltkit", did: "bridge → app function" }];
      const code = f.output && typeof f.output === "object" ? (f.output.code ?? f.output.error?.code) : undefined;
      const refusedByAuthority = f.outcome === "failed" && typeof code === "string" && AUTHORITY_CODES.test(code);
      const answer = f.approved ? (s.evidence?.answers ?? []).find((a: any) => a.interactionId === f.approved) : undefined;
      if (answer) steps.splice(1, 0, { actor: answer.by, kind: "person", did: "approved this exact call" });
      steps.push({ actor: "AppPort", kind: "appport", did: refusedByAuthority ? `refused (${code})` : answer?.approval ? `checked grant + approval ${answer.approval}` : f.approved ? "checked grant + approval" : "checked grant", tone: refusedByAuthority ? "failed" : undefined });
      if (refusedByAuthority || f.effect === "not-run") return steps;
      const tone = f.outcome === "completed" ? "ok" : f.outcome === "failed" ? "failed" : "unknown";
      const provider = GITHUB.has(f.capability) ? { actor: "GitHub", kind: "github" as const } : { actor: "Workspace", kind: "workspace" as const };
      steps.push({ ...provider, did: f.outcome === "completed" ? (CONSEQUENTIAL.has(f.capability) ? "confirmed effect" : "answered") : f.outcome === "failed" ? `failed${code ? ` (${code})` : ""}` : "no confirmed outcome", tone });
      return steps;
    }
    default: return [];
  }
}
