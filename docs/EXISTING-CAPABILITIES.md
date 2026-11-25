# Existing capabilities: what Eve reuses, and what is missing

Inventory taken 2026-11-25 from the published packages, the repositories' current `main` branches, and probes run
against the published software. Nothing here is taken from a README alone: each row names the source, the test, or
the probe that shows it.

## Published versions (npm, 2026-11-25)

| Package | Version | Role for Eve |
|---|---|---|
| `@feltdb/feltkit` | 0.5.0 | the application framework, its AppBoundry target (`feltkit build/deploy --target appboundry`), `ctx.capabilities`, Boards, the agent and its Resolver model references |
| `@appport/appboundry` | 1.13.2 | the host that runs the `.app` (Wasm guest, FeltDB state, `capabilities@1`) |
| `appport` | 1.4.3 | the AppPort host binary AppBoundry pins |
| `@appport/resolver` | 0.4.1 | Resolver: typed, revisioned references on FeltDB, published as AppPort capabilities |
| `@appport/eve` | 1.1.2 | the eve agent framework (Nitro host, World-based durable execution), Node ≥ 24 |
| `@authboundry/core` | 1.20.0 | AuthBoundry |
| `@feltdb/core` | 0.25.0 | FeltDB |
| `@appport/hetzner-deploy` | 0.1.0 | the Hetzner deploy command |

## Capability inventory

| Capability | Existing implementation | Package / API | Reusable in an AppBoundry artifact? | Evidence / tests | Remaining work |
|---|---|---|---|---|---|
| Application model, durable state | FeltKit `feltkit({…})`, `app.collection/query/mutation`, `ctx.db` | `@feltdb/feltkit` 0.5.0 | **Yes** | FeltKit `packages/sdk/test/appboundry.test.ts`, `appboundry-runtime.test.ts` | — |
| Build to `.app` (manifest + Wasm, no imports) | `feltkit build --target appboundry` | FeltKit CLI | **Yes** | probe `probe-resolver.app` built and run by 1.13.2 (this session) | — |
| Deploy to an AppBoundry portal | `feltkit deploy --target appboundry` → portal → agent → runtime | FeltKit CLI, `docs/APPBOUNDRY-DEPLOY-CONTRACT.md`; AppBoundry `docs/contracts/feltkit-deploy/` | Implemented, tested end to end locally; **not deployed** (FeltKit's own status line) | FeltKit `test/appboundry-contract.test.ts`, `deploy-appboundry.test.ts`; AppBoundry `packages/appboundry-agent/test/feltkit-deploy-e2e.test.ts` | a real portal URL and deploy token (operator) |
| Guest → other applications' capabilities | `ctx.capabilities.list/invoke` → host `capabilities@1` (operator bindings, grants, outbound ledger, `unknown` outcomes, restart recovery) | FeltKit 0.5.0 `requires`; AppBoundry 1.13.2 `--capabilities` | **Yes, on `appboundry run`** | FeltKit `test/capabilities-appboundry.test.ts`; AppBoundry `packages/appboundry-host/test/capabilities.test.ts`; Eve2 live runs | **Gap G6**: the managed runtime (portal/agent) passes no bindings |
| Resolver references | Resolver service; FeltKit resolves **model** references only (`agent.model`, `ModelHost` via `@appport/resolver-client`) | `@appport/resolver` 0.4.1; FeltKit `docs/RESOLVER.md` | FeltKit's integration: **No** (it runs in the agent, refused in an artifact). Resolver itself: **Yes**, as an AppPort provider | FeltKit `test/resolver-model.test.ts`, `tests/e2e/resolver-switch.test.mjs`; **probe below** | **Gap G2**: typed references of every kind, resolved inside an artifact, with receipts |
| Agent (decisions, model calls, approvals, budgets) | FeltKit agent (`ctx.agent`, `app.agent`, playbook `decide`) | `@feltdb/feltkit/agent` | **No**: refused at build (`docs/APPBOUNDRY.md`, "What the build refuses") | FeltKit portability audit rows 3, 4 | **Gap G1**: the agent on the AppBoundry target |
| eve agent framework, **integrated in FeltKit** | `feltkit({ eve })` (`packages/sdk/src/server/eve.ts`): FeltKit builds and supervises each agent as its own `eve start` process; sessions and runs in FeltDB through `@appport/eve-world-feltdb` (an embedded store per agent); tools are the app's capabilities through FeltKit's bridge under the person's work grant; approvals issued by FeltKit through AppPort. (Correction: an earlier version of this row cited `docs/EVE-COMPOSITION.md`, "Phase 0", which is out of date; the code shows the integration is implemented.) | `@appport/eve` 1.1.2, `@feltdb/feltkit/eve` | On FeltKit's server: **yes**. On AppBoundry: **not today**, see `INVESTIGATION-EVE-ON-APPBOUNDRY.md` | FeltKit `test/eve-execution.test.ts`, `test/project-agents.test.ts` | **G5**: the integrated eve on AppBoundry; investigated, decision pending |
| Boards (threads, claims, history, grants) | `defineBoards(app)` | `@feltdb/feltkit/boards`, `/boards/react` | **No**: the build refuses it (probe below) | FeltKit `test/boards.test.ts` | **Gap G3**: presence leases and internal functions on AppBoundry |
| Engineering workflow (assess → issue → resolve → PR) | Eve2: durable tasks, checkpoints in FeltDB, proof gates (fails on base, passes with fix), reconcile-before-resend, operator resume | `rkendel1/eve2` `experiments/eve2-on-appboundry/eve2/feltkit/*.ts` (application code, not a package) | **Yes** (it is an AppBoundry artifact today) | `test/fault/faults.test.mjs` 10/10 (`evidence/fault-suite/2026-11-25-reconcile.tap`); live: rkendel1/appboundry#99 → #100 (merged by a person), #101 (verified) | becomes FeltKit's agent capability (G1), not a second runtime in Eve |
| GitHub provider | `tracker.items.*`, `code.workspace.*`, `code.changes.*`: workspace restore, declared checks, markers, lag-safe reconcile | `rkendel1/eve2` `experiments/eve2-on-appboundry/providers/github.mjs` | Yes, as an AppPort provider (infrastructure, not part of the app) | the fault suite; live runs | packaging as a provider |
| Claude provider | `reasoning.interpret`, `reasoning.decide` (structured output, prompt caching, refusal mapping) | `providers/reasoning.mjs` | Yes, as an AppPort provider | live runs | model choice from Resolver (G2), not an environment variable |
| Authorization | AppBoundry roles → `access`; `capabilities@1` operator grants; Resolver's own grants; AuthBoundry | FeltKit roles; `@authboundry/core` 1.20.0 | Roles and grants: **Yes**. `ctx.authority` (AuthBoundry in the guest): **No** (refused, portability row 6) | probe below (Resolver refuses an ungranted reference) | AuthBoundry in the guest is not needed for the demonstration; listed, not built |
| Deployment hosting | AppBoundry agent, Docker driver, Caddy routing, Hetzner runner | `@appport/appboundry` 1.13.2, `@appport/hetzner-deploy` 0.1.0 | — | AppBoundry agent tests | operator: runner pin and Hetzner deploy (the user, 2026-11-25) |

## Probes run for this inventory

All with the published packages (`@feltdb/feltkit` 0.5.0, `@appport/appboundry` 1.13.2, `@appport/resolver` 0.4.1).

1. **Boards on AppBoundry.** `defineBoards(app)` in an empty app, `feltkit build --target appboundry`:
   refused. Reasons, as FeltKit prints them: `boards:runFollowup (internal)` (the host knows no internal functions)
   and `app.presence("boards_claims")` (the host has no lease timer or session ends).
2. **Resolver from inside an artifact.** A FeltKit app requiring `resolver.resolve@1`, built for AppBoundry, run by
   `appboundry run --capabilities` bound to a real Resolver with a key granted `read:ref://dev/*`:
   - `ref://dev/github/repository` → `rkendel1/appboundry`, revision 1;
   - `ref://prod/github/repository` → `FORBIDDEN`, refused by Resolver's grants (the host's grant to call
     `resolver.resolve` gives no authority over references);
   - binding changed to revision 3 with the artifact untouched (module `82d147667c947f67…`): a new execution
     resolved the new value, fresh; an execution that had resolved before got its original answer (replayed
     from the host's outbound ledger by its idempotency key). Keyed by execution, a run keeps the resolution
     it started with, and the next run sees the change.
3. **Managed deployment and capabilities.** AppBoundry's agent starts the runtime container
   (`packages/appboundry-agent/src/driver.ts`) with no capability bindings: an app deployed through the portal
   cannot reach any provider.

## Gaps to close upstream

Each is closed in the repository that owns it, tested there, and consumed by Eve through the released API.

| | Gap | Owner | Smallest change |
|---|---|---|---|
| G1 | The agent is refused on the AppBoundry target | FeltKit | the agent's decision loop runs in the guest: model calls and tools through `capabilities@1`, state in FeltDB collections, steps as jobs. Eve2's durable machinery (checkpoints, proof gates, reconcile before resend) becomes FeltKit's, once |
| G2 | Resolver: only model references, and only on FeltKit's server | FeltKit | typed reference declarations (`model`, `value`, `agent`) resolved in the guest through `resolver.resolve`, keyed per execution, the receipt (`ref`, `revision`, value) recorded with the execution |
| G3 | Boards cannot be built for AppBoundry | AppBoundry + FeltKit | host: internal functions in the manifest (callable only from the app's own jobs) and expiring leases on the host clock; FeltKit: map `visibility` and `app.presence` onto them |
| G5 | eve cannot run inside an artifact | eve + FeltKit | per `docs/EVE-COMPOSITION.md`: a FeltDB World, a host-supplied model resolver, host tools. Large; see `ARCHITECTURE.md` for how Eve stands without it |
| G7 | No function kind that can wait on other systems (FeltKit's reasoner loop is an `app.action`; AppBoundry ran only queries and mutations, 30 s, one transaction) | AppBoundry + FeltKit | **Closed.** AppBoundry `actions@1` (1.14.0, published); jobs run actions with a renewed lease (rkendel1/appboundry#107, 1.15.0 prepared). FeltKit builds `app.action` for AppBoundry (`runQuery`/`runMutation`/`ctx.capabilities`), verified on published 1.14.0 with a real AppPort provider (FeltKit PR pending). Open: streaming; `ctx.model`/`ctx.effect` in an artifact (G1) |
| G8 | Background work that waits: a job could not run an action (fixed 30 s job lease) | AppPort Services, then AppBoundry | **Closed.** `renewLease()` in `@appport/services` 0.22.0 (published); AppBoundry jobs run actions renewing it, worker holds no gate across a job (rkendel1/appboundry#107) |
| G6 | Managed deployments get no capability bindings | AppBoundry | bindings as operator configuration of an application on the portal, passed to the runtime (credentials from the host's secret store, never the artifact), with egress allowed only to bound providers |
