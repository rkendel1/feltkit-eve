# Architecture

Eve is one FeltKit application, built once into an `appboundry.app/1` artifact (a Wasm module and its manifest) and
run by AppBoundry. Everything outside the artifact is a platform service it reaches through a contract it already
has. Eve adds no server, worker, queue or database of its own.

```
                         ┌──────────────────────── AppBoundry host ────────────────────────┐
  browser ── /api, /  ──▶│  eve.app (Wasm guest, no imports)                                │
                         │    collections (FeltDB): tasks · executions · resolutions ·      │
                         │      decisions · invocations · checkpoints · evidence · outcomes  │
                         │    functions: queries, mutations, jobs (steps)                    │
                         │  host interfaces: collections · identity · services(jobs) ·       │
                         │    transactions · capabilities@1 (bindings, grants, ledger)       │
                         └───────────────┬──────────────────────────────────────────────────┘
                                         │ AppPort, one binding and grant per capability
              ┌──────────────────────────┼───────────────────────────┐
         Resolver                  model provider               GitHub provider
   resolver.resolve/history     reasoning.decide (Claude,     tracker.*, code.workspace.*,
   (its own grants decide       or whichever provider a       code.changes.* (workspace,
    which references)           model reference names)        checks, branches, PRs)
```

## Who owns what

| | Owns | Never |
|---|---|---|
| **Eve (the artifact)** | tasks, executions, decisions, evidence, the Board's records; which references an execution needs | credentials, network, a copy of a binding beyond the execution that used it |
| **FeltDB** | all of Eve's state, transactionally | — |
| **AppBoundry** | running the guest, identity and roles, jobs, the outbound ledger, which providers are bound and granted | deciding what a reference means |
| **Resolver** | what `ref://…` means now, revisions, history, rollback, its own read grants | granting Eve any capability |
| **AppPort providers** | the external effect, idempotent where they declare it | Eve's state |

Authority is checked twice and independently: the host's operator grant decides whether Eve may call a capability at
all; the provider (Resolver, GitHub) decides whether that call may touch that resource. A new Resolver binding cannot
widen either: probe 2 in `EXISTING-CAPABILITIES.md` shows Resolver refusing a reference the key was not granted.

## Runtime resolution

- Eve names stable references (`ref://<env>/chat/model`, `ref://<env>/github/repository`, `ref://<env>/agent/…`).
- Each execution resolves the references it needs once, at its start, through `resolver.resolve`, keyed
  `<execution>:resolve:<ref>`. The answer (reference, revision, value) is recorded with the execution.
- A retry of that execution replays the same answer (the host's ledger); the next execution resolves afresh.
  Measured, not assumed: probe 2.
- The Board shows, per execution, each reference with the revision and value it used; Resolver's history shows
  how bindings changed between executions.

## Execution lifecycle

The proven Eve2 lifecycle, unchanged in substance: a task is assigned; each step is a job that does one external
step and commits its record; files are checkpointed into FeltDB (a provider's working copy is disposable);
proof gates require a test that fails on the base and passes with the change; an effect whose outcome is unknown is
reconciled with the system before anything is sent again; a person merges.

## Where the platform does not reach yet

These are closed upstream before Eve depends on them (`EXISTING-CAPABILITIES.md`, Gaps):

- **G1, G2** (FeltKit): the agent loop and typed Resolver references on the AppBoundry target. Until then, Eve has
  no agent to compose and no reference to resolve through FeltKit.
- **G3** (AppBoundry + FeltKit): Boards on AppBoundry. The Board view in Eve reads Eve's execution records; it does
  not need Boards' coordination (claims, threads) to show what happened.
- **G6** (AppBoundry): capability bindings for managed deployments. Without it, Eve on Hetzner cannot reach any
  provider.

### Open decision: `@appport/eve` inside the artifact (G5)

`@appport/eve` is a Node framework (Nitro, rolldown, undici, the AI SDK) hosted as an HTTP server, with durable runs
in a Workflow World. An AppBoundry guest is a JavaScript engine in Wasm with no imports, no Node APIs and no network.
eve cannot run inside the artifact as published, and FeltKit's composition plan (`docs/EVE-COMPOSITION.md`) is at
"Phase 0, nothing implemented"; its first open question is still how eve is hosted at all.

Two honest shapes:

1. **Eve's agent is FeltKit's agent on AppBoundry (G1).** One runtime: FeltKit's, in the guest. `@appport/eve` is not
   in the artifact; its concepts (durable runs, tools, approvals) are provided by FeltKit's agent, as
   `EVE-COMPOSITION.md`'s boundary table already assigns them to the host.
2. **Compose eve first (G5).** A FeltDB World, a headless eve host, and a way to run eve's compiled agent inside the
   guest engine. This is a research project in eve and the guest engine, not a gap fix.

Shape 1 is what the platform can support; shape 2 needs a decision by the owners of eve and AppBoundry.
