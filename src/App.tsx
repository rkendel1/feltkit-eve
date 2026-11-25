import { useCallback, useEffect, useMemo, useState } from "react";
import { action, actorsOf, classify, client, eve, outcomesOf, query, runsOf, short, when, type Fact, type SessionView, type Step } from "./api";

type Page = "home" | "tasks" | "board" | "resolver" | "approvals" | "evidence";
const PAGES: Array<[Page, string]> = [["home", "Home"], ["tasks", "Tasks"], ["board", "Board"], ["approvals", "Approvals"], ["evidence", "Evidence"], ["resolver", "Resolver"]];

export function App() {
  const [me, setMe] = useState<any>(undefined);
  const [tenants, setTenants] = useState<any>(null);
  const refreshAuth = useCallback(async () => {
    const s = await (client as any).session().catch(() => null);
    setMe(s?.principal ?? null);
    if (s?.principal) setTenants(await (client as any).tenants().catch(() => null));
  }, []);
  useEffect(() => { void refreshAuth(); }, [refreshAuth]);
  if (me === undefined) return <div className="center muted">Loading…</div>;
  if (!me) return <SignIn onDone={refreshAuth} />;
  if (!tenants?.current) return <Workspaces tenants={tenants} onDone={refreshAuth} />;
  return <Workbench me={me} tenant={tenants.current} onSignOut={async () => { await (client as any).signOut(); await refreshAuth(); }} />;
}

function SignIn({ onDone }: { onDone(): void }) {
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => { setError(null); try { await fn(); onDone(); } catch (e: any) { setError(e?.message ?? String(e)); } };
  return (
    <div className="center">
      <div className="card auth">
        <div className="cb">
          <div className="brand"><span className="dot" />Eve</div>
          <p className="muted">An engineering agent whose model, repository and behavior change without a redeploy, and whose every step you can inspect.</p>
          <div className="grid" style={{ marginTop: 12 }}>
            <input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <input placeholder="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <div className="row">
              <button className="btn primary" onClick={() => run(() => (client as any).signIn({ email, password }))}>Sign in</button>
              <button className="btn" onClick={() => run(() => (client as any).signUp({ email, password }))}>Create account</button>
            </div>
            <div className="row small muted">Development: <button className="btn" onClick={() => run(() => (client as any).signInAsDevUser("ada"))}>Ada</button><button className="btn" onClick={() => run(() => (client as any).signInAsDevUser("lin"))}>Lin</button></div>
            {error ? <div className="err">{error}</div> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function Workspaces({ tenants, onDone }: { tenants: any; onDone(): void }) {
  const [name, setName] = useState(""); const [error, setError] = useState<string | null>(null);
  return (
    <div className="center">
      <div className="card auth"><div className="cb grid">
        <h2>Choose a workspace</h2>
        {(tenants?.tenants ?? []).map((t: any) => <button key={t.id} className="btn" onClick={async () => { await (client as any).switchTenant(t.id); onDone(); }}>{t.name}</button>)}
        <div className="row"><input placeholder="New workspace" value={name} onChange={(e) => setName(e.target.value)} /><button className="btn primary" disabled={!name} onClick={async () => { try { await client.createTenant(name); onDone(); } catch (e: any) { setError(e.message); } }}>Create</button></div>
        {error ? <div className="err">{error}</div> : null}
      </div></div>
    </div>
  );
}

/** Eve's sessions with their recorded evidence and Resolver receipts, refreshed every few seconds. */
function useEve() {
  const [status, setStatus] = useState<any>(null);
  const [sessions, setSessions] = useState<SessionView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const s = await eve().status();
        const list = (await eve().sessions()).slice(0, 25);
        const full = await Promise.all(list.map(async (x: any) => ({ ...x, evidence: await eve().evidence(x.id).catch(() => null), receipt: await query("bindings:forSession", { sessionId: x.id }).catch(() => null) })));
        if (live) { setStatus(s); setSessions(full); setError(null); }
      } catch (e: any) { if (live) setError(e?.message ?? String(e)); }
    })();
    const t = setTimeout(() => setTick((n) => n + 1), 5000);
    return () => { live = false; clearTimeout(t); };
  }, [tick]);
  return { status, sessions, error, refresh: () => setTick((n) => n + 1) };
}

function pendingApprovals(sessions: SessionView[]) {
  const out: Array<{ session: SessionView; fact: Fact; call?: Fact }> = [];
  for (const s of sessions) {
    const t: Fact[] = s.evidence?.timeline ?? [];
    const answered = new Set((s.evidence?.answers ?? []).map((a: any) => a.interactionId));
    t.forEach((f, i) => { if (f.kind === "approval" && !answered.has(f.interactionId)) out.push({ session: s, fact: f, call: [...t.slice(0, i)].reverse().find((x) => x.kind === "tool") }); });
  }
  return out;
}

function Workbench({ me, tenant, onSignOut }: { me: any; tenant: any; onSignOut(): void }) {
  const [page, setPage] = useState<Page>("home");
  const [open, setOpen] = useState<string | null>(null);
  const data = useEve();
  const pending = useMemo(() => pendingApprovals(data.sessions), [data.sessions]);
  const show = (id: string) => { setOpen(id); setPage("tasks"); };
  return (
    <div className="shell">
      <aside className="side">
        <div className="brand"><span className="dot" />Eve</div>
        {PAGES.map(([p, label]) => <button key={p} className={`nav ${page === p ? "on" : ""}`} onClick={() => { setPage(p); if (p !== "tasks") setOpen(null); }}>{label}{p === "approvals" && pending.length ? <span className="count">{pending.length}</span> : null}</button>)}
        <div className="foot">{me.displayName ?? me.id} · {tenant.name}<br /><a href="#" onClick={(e) => { e.preventDefault(); onSignOut(); }}>Sign out</a></div>
      </aside>
      <main>
        {data.error ? <div className="err" style={{ marginBottom: 14 }}>{data.error}</div> : null}
        {page === "home" ? <Home data={data} onOpen={show} onGo={setPage} /> : null}
        {page === "tasks" ? <Tasks data={data} open={open} setOpen={setOpen} /> : null}
        {page === "board" ? <Board sessions={data.sessions} onOpen={show} /> : null}
        {page === "approvals" ? <Approvals pending={pending} onAnswered={data.refresh} onOpen={show} /> : null}
        {page === "evidence" ? <Evidence sessions={data.sessions} onOpen={show} /> : null}
        {page === "resolver" ? <Resolver sessions={data.sessions} onOpen={show} /> : null}
      </main>
    </div>
  );
}

function stateOf(s: SessionView) {
  const st = s.evidence?.state as string | undefined;
  if (st === "approval" || pendingApprovals([s]).length) return { label: "Waiting for approval", cls: "wait" };
  if (st === "completed" || st === "idle") return { label: "Settled", cls: "ok" };
  if (st === "failed" || st === "stopped" || st === "interrupted") return { label: st, cls: "" };
  return { label: st ?? "…", cls: "running" };
}

function Home({ data, onOpen, onGo }: { data: ReturnType<typeof useEve>; onOpen(id: string): void; onGo(p: Page): void }) {
  const [text, setText] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const s = data.status;
  const start = async () => { setBusy(true); setError(null); try { const r = await eve().start(text); setText(""); data.refresh(); onOpen(r.sessionId); } catch (e: any) { setError(e.message); } finally { setBusy(false); } };
  return (
    <>
      <div className="card hero">
        <h1>Eve does engineering work you can inspect.</h1>
        <p>Give Eve a task on a repository. It reads, changes and tests code in a working copy, and asks you before it opens anything on GitHub. Its model, repository and behavior come from Resolver references, resolved when each task starts, so they change without rebuilding or redeploying Eve, and every step it takes is recorded.</p>
      </div>
      <div className="grid g3" style={{ marginTop: 14 }}>
        <div className="card"><div className="cb"><div className="muted small">Agent</div><div className="row" style={{ marginTop: 6 }}><span className={`state-dot ${s?.state === "ready" ? "ok" : ""}`} /> {s ? `${s.displayName} · ${s.state}` : "…"}</div>
          {s && !s.activated ? <button className="btn" style={{ marginTop: 10 }} onClick={async () => { await eve().activate(); data.refresh(); }}>Activate in this workspace</button> : null}</div></div>
        <div className="card"><div className="cb"><div className="muted small">Tasks</div><div style={{ fontSize: 22, fontWeight: 650 }}>{data.sessions.length}</div></div></div>
        <div className="card"><div className="cb"><div className="muted small">Waiting for you</div><div style={{ fontSize: 22, fontWeight: 650 }}><a href="#" onClick={(e) => { e.preventDefault(); onGo("approvals"); }}>{pendingApprovals(data.sessions).length} approvals</a></div></div></div>
      </div>
      <div className="card" style={{ marginTop: 14 }}>
        <div className="ch"><h2>Give Eve a task</h2></div>
        <div className="cb grid">
          <textarea placeholder="e.g. Resolve issue #101: read it, write its regression test, show it fails on the base, fix it, verify, and open a pull request." value={text} onChange={(e) => setText(e.target.value)} />
          <div className="row spread"><span className="muted small">Runs on AppBoundry as Eve's worker in this workspace, under your grant.</span><button className="btn primary" disabled={!text.trim() || busy || !s?.activated} onClick={start}>{busy ? "Starting…" : "Start"}</button></div>
          {error ? <div className="err">{error}</div> : null}
        </div>
      </div>
      <SessionsTable sessions={data.sessions.slice(0, 8)} onOpen={onOpen} title="Recent tasks" />
    </>
  );
}

function SessionsTable({ sessions, onOpen, title }: { sessions: SessionView[]; onOpen(id: string): void; title: string }) {
  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="ch"><h2>{title}</h2></div>
      {sessions.length ? (
        <table><thead><tr><th>Task</th><th>State</th><th>Model · profile</th><th>Outcomes</th><th>Started</th></tr></thead><tbody>
          {sessions.map((s) => { const st = stateOf(s); const m = s.receipt?.refs?.find((r: any) => r.name === "model"); const p = s.receipt?.refs?.find((r: any) => r.name === "profile"); const o = outcomesOf(s.evidence?.timeline ?? []);
            return <tr key={s.id} className="click" onClick={() => onOpen(s.id)}><td>{short(s.title, 90)}</td><td><span className={`state-dot ${st.cls}`} /> {st.label}</td><td className="small">{m ? `${m.value.model} (r${m.revision})` : "—"}<br /><span className="muted">{p ? `${p.value.name} (r${p.revision})` : ""}</span></td><td>{o.map((x) => <div key={x.url}><a href={x.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>{x.kind} #{x.number}</a></div>)}</td><td className="small muted">{when(s.createdAt)}</td></tr>; })}
        </tbody></table>
      ) : <div className="empty">No tasks yet. Start one above.</div>}
    </div>
  );
}

function Tasks({ data, open, setOpen }: { data: ReturnType<typeof useEve>; open: string | null; setOpen(id: string | null): void }) {
  const s = data.sessions.find((x) => x.id === open);
  if (!s) return (<><div className="head"><div><h1>Tasks</h1><div className="sub">Every task is an eve session, recorded in FeltDB.</div></div></div><SessionsTable sessions={data.sessions} onOpen={setOpen} title="All tasks" /></>);
  return <SessionDetail s={s} onBack={() => setOpen(null)} onChanged={data.refresh} />;
}

function SessionDetail({ s, onBack, onChanged }: { s: SessionView; onBack(): void; onChanged(): void }) {
  const [msg, setMsg] = useState(""); const t: Fact[] = s.evidence?.timeline ?? []; const st = stateOf(s);
  const pending = pendingApprovals([s]);
  return (
    <>
      <div className="head"><div><a href="#" onClick={(e) => { e.preventDefault(); onBack(); }} className="small">← Tasks</a><h1 style={{ marginTop: 6 }}>{short(s.title, 110)}</h1><div className="sub"><span className={`state-dot ${st.cls}`} /> {st.label} · started {when(s.createdAt)} by {s.createdBy} · <span className="mono">{s.id}</span></div></div></div>
      {pending.map((p) => <ApprovalCard key={p.fact.interactionId} item={p} onAnswered={onChanged} />)}
      <div className="grid g2">
        <Receipt receipt={s.receipt} />
        <div className="card"><div className="ch"><h2>Outcomes</h2></div><div className="cb">{outcomesOf(t).length ? outcomesOf(t).map((o) => <div key={o.url} className="row spread"><a href={o.url} target="_blank" rel="noreferrer">{o.kind} #{o.number}</a><span className="badge t-ok">{o.state ?? "confirmed"}</span></div>) : <span className="muted">No external effect confirmed.</span>}
          {t.some((f) => f.kind === "tool" && classify(f).tone === "unknown") ? <div className="err" style={{ marginTop: 8 }}>An external effect has no confirmed outcome. Do not retry it; settle it after checking GitHub.</div> : null}</div></div>
      </div>
      <Timeline facts={t} session={s} />
      <div className="card" style={{ marginTop: 14 }}><div className="cb row"><input placeholder="Send Eve a follow-up…" value={msg} onChange={(e) => setMsg(e.target.value)} /><button className="btn primary" disabled={!msg.trim()} onClick={async () => { await eve().send(s.id, msg); setMsg(""); onChanged(); }}>Send</button></div></div>
    </>
  );
}

function Receipt({ receipt }: { receipt: any }) {
  return (
    <div className="card"><div className="ch"><h2>Configuration this task ran on</h2><span className="muted small">Resolver receipt</span></div><div className="cb">
      {receipt ? <div className="kv">{receipt.refs.map((r: any) => [<div key={`${r.name}k`}>{r.name}</div>, <div key={`${r.name}v`}><div>{r.value.model ?? r.value.repository ?? r.value.name ?? short(r.value)}</div><div className="ref muted">{r.ref} · revision {r.revision}</div></div>])}<div>resolved</div><div className="small">{when(receipt.resolvedAt)}</div></div> : <span className="muted">Not resolved yet (the agent resolves on its first step).</span>}
    </div></div>
  );
}

function Timeline({ facts, session }: { facts: Fact[]; session: SessionView }) {
  return (
    <div className="card" style={{ marginTop: 14 }}><div className="ch"><h2>What happened</h2><span className="muted small">{facts.length} recorded facts</span></div>
      <div className="timeline">{facts.length ? facts.map((f, i) => <FactRow key={i} f={f} session={session} />) : <div className="empty">Nothing recorded yet.</div>}</div></div>
  );
}

function FactRow({ f, session }: { f: Fact; session?: SessionView }) {
  const c = classify(f);
  const summary = f.kind === "tool" ? <><span className="mono">{f.capability}</span> <span className="muted">{short(f.input, 120)}</span></> : f.kind === "approval" ? f.prompt : f.text ?? f.outcome ?? "";
  const detail = f.kind === "tool" ? { input: f.input, outcome: f.outcome, output: f.output } : f.kind === "reply" || f.kind === "message" ? null : f;
  return (
    <div className="ev">
      <div className="time">{f.at ? new Date(f.at).toLocaleTimeString() : ""}</div>
      <div><span className={`badge t-${c.tone}`}>{c.label}</span></div>
      <div>{session ? <Chain steps={actorsOf(f, session)} /> : null}
        {detail ? <details><summary>{summary}</summary><pre>{JSON.stringify(detail, null, 2).slice(0, 20000)}</pre></details> : <div style={{ whiteSpace: "pre-wrap" }}>{summary}</div>}</div>
    </div>
  );
}

function Chain({ steps }: { steps: Step[] }) {
  return <div className="chain">{steps.map((st, i) => <span key={i} className="step"><span className={`actor a-${st.kind}`}>{st.actor}</span> <span className={`did ${st.tone ? `d-${st.tone}` : ""}`}>{st.did}</span>{i < steps.length - 1 ? <span className="arrow">→</span> : null}</span>)}</div>;
}

const ACTORS: Array<[Step["kind"], string]> = [["person", "People"], ["eve", "Eve"], ["model", "Model"], ["feltkit", "FeltKit"], ["appport", "AppPort"], ["resolver", "Resolver"], ["workspace", "Workspace"], ["github", "GitHub"], ["feltdb", "FeltDB"]];
function Board({ sessions, onOpen }: { sessions: SessionView[]; onOpen(id: string): void }) {
  const [only, setOnly] = useState<Step["kind"] | null>(null);
  const rows = useMemo(() => sessions.flatMap((s) => [
    ...(s.receipt ? [{ s, f: { kind: "resolution", at: s.receipt.resolvedAt, text: s.receipt.refs.map((r: any) => `${r.name} → ${r.value.model ?? r.value.repository ?? r.value.name} (r${r.revision})`).join(" · ") } as Fact }] : []),
    ...(s.evidence?.timeline ?? []).map((f: Fact) => ({ s, f })),
    ...(s.evidence?.answers ?? []).map((a: any) => ({ s, f: { ...a, kind: "answer", at: new Date(a.at).toISOString(), text: a.capability ?? "" } as Fact })),
  ]).filter((r) => r.f.at).map((r) => ({ ...r, steps: actorsOf(r.f, r.s) as Step[] })).sort((a, b) => (a.f.at! < b.f.at! ? 1 : -1)), [sessions]);
  const shown = rows.filter((r) => !only || r.steps.some((st: Step) => st.kind === only));
  const counts = (k: Step["kind"]) => rows.filter((r) => r.steps.some((st: Step) => st.kind === k)).length;
  return (
    <>
      <div className="head"><div><h1>Board</h1><div className="sub">Every recorded fact of every task, newest first, with the component that did each part. Eve proposes; FeltKit and AppPort decide; GitHub's answer is the only confirmation of an effect.</div></div></div>
      <div className="filters" style={{ marginBottom: 12 }}><button className={only === null ? "on" : ""} onClick={() => setOnly(null)}>All {rows.length}</button>{ACTORS.map(([k, label]) => <button key={k} className={only === k ? "on" : ""} onClick={() => setOnly(k)}><span className={`swatch a-${k}`} />{label} {counts(k)}</button>)}</div>
      <div className="card">{shown.length ? shown.slice(0, 400).map((r, i) => {
        const c = r.f.kind === "resolution" ? { label: "Resolver", tone: "intent" } : r.f.kind === "answer" ? { label: "Approval answered", tone: "approval" } : classify(r.f);
        const detail = r.f.kind === "tool" ? <><span className="mono">{r.f.capability}</span> <span className="muted">{short(r.f.input, 110)}</span></> : r.f.kind === "approval" ? r.f.prompt : r.f.kind === "answer" ? r.f.text : short(r.f.text ?? r.f.outcome ?? "", 200);
        return <div key={i} className="ev board" onClick={() => onOpen(r.s.id)}>
          <div className="time">{new Date(r.f.at!).toLocaleTimeString()}</div>
          <div><span className={`badge t-${c.tone}`}>{c.label}</span></div>
          <div><Chain steps={r.steps} /><div className="small" style={{ marginTop: 4 }}>{detail}</div><div className="small muted">{short(r.s.title, 80)}</div></div>
        </div>; }) : <div className="empty">No activity yet.</div>}</div>
    </>
  );
}

function ApprovalCard({ item, onAnswered }: { item: { session: SessionView; fact: Fact; call?: Fact }; onAnswered(): void }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const answer = async (d: "approve" | "deny") => { setBusy(true); setError(null); try { await eve().answer(item.session.id, item.fact.interactionId, d); onAnswered(); } catch (e: any) { setError(e.message); } finally { setBusy(false); } };
  return (
    <div className="card" style={{ marginBottom: 14, borderColor: "var(--warn)" }}>
      <div className="ch"><h2>{item.fact.prompt}</h2><span className="badge t-approval">Waiting for you</span></div>
      <div className="cb grid">
        <div className="small muted">Task: {short(item.session.title, 100)} · requested {when(item.fact.at)}. Approving allows exactly this call, with exactly this input.</div>
        {item.call ? <pre className="card" style={{ padding: 10, maxHeight: 320, overflow: "auto" }}>{JSON.stringify({ capability: item.call.capability, input: item.call.input }, null, 2)}</pre> : null}
        <div className="row"><button className="btn ok" disabled={busy} onClick={() => answer("approve")}>Approve this call</button><button className="btn bad" disabled={busy} onClick={() => answer("deny")}>Deny</button></div>
        {error ? <div className="err">{error}</div> : null}
      </div>
    </div>
  );
}

function Approvals({ pending, onAnswered, onOpen }: { pending: ReturnType<typeof pendingApprovals>; onAnswered(): void; onOpen(id: string): void }) {
  return (
    <>
      <div className="head"><div><h1>Approvals</h1><div className="sub">Calls that act on GitHub wait for a person. Each approval covers one exact call.</div></div></div>
      {pending.length ? pending.map((p) => <div key={p.fact.interactionId}><ApprovalCard item={p} onAnswered={onAnswered} /><a href="#" className="small" onClick={(e) => { e.preventDefault(); onOpen(p.session.id); }}>Open the task →</a></div>) : <div className="card"><div className="empty">Nothing is waiting for approval.</div></div>}
    </>
  );
}

function Evidence({ sessions, onOpen }: { sessions: SessionView[]; onOpen(id: string): void }) {
  const items = sessions.map((s) => ({ s, runs: runsOf(s.evidence?.timeline ?? []), outcomes: outcomesOf(s.evidence?.timeline ?? []), diff: [...(s.evidence?.timeline ?? [])].reverse().find((f: Fact) => f.capability === "repo.workspace.diff" && f.output) })).filter((x) => x.runs.length || x.outcomes.length || x.diff);
  return (
    <>
      <div className="head"><div><h1>Evidence</h1><div className="sub">Checks with the exact content tree they ran on, the change, and what GitHub confirmed.</div></div></div>
      {items.length ? items.map(({ s, runs, outcomes, diff }) => (
        <div key={s.id} className="card">
          <div className="ch"><a href="#" onClick={(e) => { e.preventDefault(); onOpen(s.id); }}><h2>{short(s.title, 100)}</h2></a><span className="muted small">{when(s.createdAt)}</span></div>
          <div className="cb grid">
            {runs.length ? <table><thead><tr><th>Check</th><th>Against</th><th>Tree</th><th>Result</th></tr></thead><tbody>{runs.map((r: any, i: number) => <tr key={i}><td className="mono">{r.check}{r.target ? ` ${r.target}` : ""}</td><td>{r.against}</td><td className="mono">{String(r.tree ?? "").slice(0, 12)}</td><td><details><summary><span className={`badge ${r.state !== "finished" ? "t-neutral" : r.exitCode === 0 ? "t-ok" : "t-failed"}`}>{r.state !== "finished" ? r.state : r.exitCode === 0 ? "passed" : `failed (exit ${r.exitCode})`}</span></summary><pre>{r.output}</pre></details></td></tr>)}</tbody></table> : null}
            {diff ? <details><summary>Change: {diff.output.files?.map((f: any) => `${f.path} (+${f.additions} −${f.deletions})`).join(", ")} · tree <span className="mono">{String(diff.output.tree).slice(0, 12)}</span></summary><pre>{diff.output.patch}</pre></details> : null}
            {outcomes.map((o) => <div key={o.url} className="row spread"><a href={o.url} target="_blank" rel="noreferrer">{o.kind} #{o.number}</a><span className="badge t-ok">{o.state}</span></div>)}
          </div>
        </div>)) : <div className="card"><div className="empty">No verification recorded yet.</div></div>}
    </>
  );
}

function Resolver({ sessions, onOpen }: { sessions: SessionView[]; onOpen(id: string): void }) {
  const [current, setCurrent] = useState<any[] | null>(null); const [error, setError] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ name: string; value: string; expectedRevision: number; reason: string } | null>(null);
  const load = useCallback(async () => { try { setCurrent(await action("bindings:current")); } catch (e: any) { setError(e.message); } }, []);
  useEffect(() => { void load(); }, [load]);
  const save = async () => { if (!edit) return; setError(null); try { await action("bindings:set", { name: edit.name, value: JSON.parse(edit.value), expectedRevision: edit.expectedRevision, reason: edit.reason }); setEdit(null); await load(); } catch (e: any) { setError(e.message); } };
  const receipts = sessions.filter((s) => s.receipt);
  return (
    <>
      <div className="head"><div><h1>Resolver</h1><div className="sub">Eve depends on stable references. Resolver decides what they mean now; each task records what they meant when it started. Resolver decides configuration, never authority.</div></div><button className="btn" onClick={load}>Refresh</button></div>
      {error ? <div className="err" style={{ marginBottom: 12 }}>{error}</div> : null}
      <div className="card"><div className="ch"><h2>Current bindings</h2><span className="muted small">the next task uses these</span></div>
        <table><thead><tr><th>Reference</th><th>Resolves to</th><th>Revision</th><th /></tr></thead><tbody>
          {(current ?? []).map((r: any) => <tr key={r.ref}><td><div>{r.name}</div><div className="ref muted">{r.ref}</div></td><td>{r.error ? <span className="err">{r.error}</span> : <pre className="small">{JSON.stringify(r.value, null, 1)}</pre>}</td><td>{r.revision ?? "—"}</td><td>{r.error ? null : <button className="btn" onClick={() => setEdit({ name: r.name, value: JSON.stringify(r.value, null, 2), expectedRevision: r.revision, reason: "" })}>Change</button>}</td></tr>)}
        </tbody></table>
        {edit ? <div className="cb grid" style={{ borderTop: "1px solid var(--line)" }}>
          <h2>Change {edit.name} (from revision {edit.expectedRevision})</h2>
          <textarea className="mono" value={edit.value} onChange={(e) => setEdit({ ...edit, value: e.target.value })} />
          <input placeholder="Reason (recorded in Resolver's history)" value={edit.reason} onChange={(e) => setEdit({ ...edit, reason: e.target.value })} />
          <div className="row"><button className="btn primary" disabled={!edit.reason} onClick={save}>Save to Resolver</button><button className="btn" onClick={() => setEdit(null)}>Cancel</button><span className="muted small">Running tasks keep theirs; the next task uses the new binding.</span></div>
        </div> : null}
      </div>
      <div className="card"><div className="ch"><h2>What each task ran on</h2><span className="muted small">receipts in FeltDB</span></div>
        {receipts.length ? <table><thead><tr><th>Task</th><th>Model</th><th>Repository</th><th>Profile</th><th>Resolved</th></tr></thead><tbody>
          {receipts.map((s) => { const g = (n: string) => s.receipt.refs.find((r: any) => r.name === n); const cell = (n: string, k: string) => g(n) ? <>{g(n).value[k]} <span className="muted small">r{g(n).revision}</span></> : "—";
            return <tr key={s.id} className="click" onClick={() => onOpen(s.id)}><td>{short(s.title, 60)}</td><td>{cell("model", "model")}</td><td>{cell("repository", "repository")}</td><td>{cell("profile", "name")}</td><td className="small muted">{when(s.receipt.resolvedAt)}</td></tr>; })}
        </tbody></table> : <div className="empty">No task has resolved its configuration yet.</div>}
      </div>
    </>
  );
}
