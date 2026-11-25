# Eve: the execution contract between the application (Vercel) and execution (AppBoundry)

Status: **proposed** (2026-11-25). Supersedes the "two deployments" section of [BOUNDARY.md](./BOUNDARY.md), which put
a separate Node `eve-runtime` server behind Vercel rewrites. That server was a property of the first implementation,
not of the architecture.

## Topology

```
 browser ──▶ Vercel: the Eve application (FeltKit)                     AppBoundry: Eve execution
             UI, Board, people, sessions, approvals, task lifecycle,     runs agent work; holds no authority
             Resolver configuration, evidence                          ┌───────────────────────────────┐
             ┌──────────────────────────────────────┐   dispatch,      │ executor for agent `engineer` │
             │ authority: roles, work grants,       │── control ─────▶│  model calls, workspace,      │
             │ AppPort approvals, provider-call     │   (server-to-    │  checks, GitHub effects       │
             │ records — all in FeltDB              │◀── events ───────│                               │
             │                                      │◀── capability ───│  every action asks first      │
             └──────────────────────────────────────┘    calls         └───────────────────────────────┘
                     shared platform: FeltDB · AppPort · AuthBoundry · Resolver
```

- The **browser talks only to the application.** No rewrite to an execution origin; no execution hostname in the UI.
- The **application calls the executor server-to-server**, as a service principal (AppPort credential), on behalf of a
  person whose delegation it signs. The executor never sees the person's session.
- The **executor calls back** into the application for every capability (the existing bridge), so authorization,
  approvals and effect records stay where the authority is. The executor holds no grant, approval or person
  credential, only what the application signs for one session.

## The six operations

Each is an operation FeltKit already performs against eve today, over loopback (`server/eve.ts`). The contract is the
same operation over an authenticated network boundary.

| # | Operation | Direction | Today (in FeltKit, loopback) | Contract |
|---|---|---|---|---|
| 1 | **Dispatch** a task | app → executor | `POST /eve/<agent>/eve/v1/session` with an idempotency key; task recorded in `_feltkit_eve_sessions` (eve.ts:619-629) | Same request; the key makes a retried dispatch return the same session, never a second one |
| 2 | **Person + delegation** | app → executor | HS256 assertion: person, roles, tenant, work grant (eve.ts:504-531) | Same claims, signed by the application's AppPort key (asymmetric, verifiable by the executor without a shared secret), five-minute lifetime, bound to the session |
| 3 | **Track and cancel** | app → executor | `ExternalReasoner`: `inFlight`, `interrupt`, `resume`, `stop`, `ended`, `observe` (agent.ts:2392-2407) mapped to eve cancel/resume/end (eve.ts:142-171) | The same six calls, remote. `stop` is recorded only once the executor confirms the session ended |
| 4 | **Events** | executor → app | eve's NDJSON session stream (eve.ts:819-845) | Same stream, resumable from a cursor, pulled by the application (no inbound connection to Vercel needed for events) |
| 5 | **Evidence and outcomes** | app (records) | timeline, control history, answers, stop (eve.ts:695-723); provider-call records | Recorded by the application from (3), (4) and (6). The executor's own run record is a source the application reconciles against, not a second authority |
| 6 | **Capability calls and unknown outcomes** | executor → app | bridge `/_feltkit/eve/<agent>/invoke` (loopback only, eve.ts:637-687); `_feltkit_provider_calls`: `started` before the effect, then `succeeded / failed / unknown`; `verify` / `settle`, never an automatic retry (providers.ts:10-25, 279-305) | Same bridge over the network, authenticated as the executor's service principal and bound to the session's delegation. An effect whose answer is lost is `unknown` on both sides; the application asks the provider's `verify` before anything is resent |

Invariants:

- **One authority.** Grants, approvals and effect records live in the application's FeltDB. The executor may cache
  nothing that decides authority.
- **No blind replay.** A dispatch, a capability call or a consequential effect carries an idempotency key; a
  transport failure leaves the outcome `unknown` and is resolved by `verify`, never by sending again.
- **Secrets stay in the trusted execution environment.** The model credential and the GitHub token are revealed
  where the call is made (Resolver `reveal` for the executor's key; the provider's credential for GitHub), never sent
  across the contract, never in evidence.

## Where each piece stands

| Piece | State |
|---|---|
| Application side of (1)-(6) | **Exists**, loopback only. Needs: a configurable executor endpoint instead of the spawned child (`eve.ts` hard-wires `127.0.0.1:<port>`), the asymmetric assertion, and the bridge accepting the executor's service principal |
| FeltKit on Vercel | **Exists**: `feltkit deploy --target vercel` (Vercel's container runtime; state in Managed FeltDB or a FeltDB server, never on the instance) |
| Executor on AppBoundry | **Does not exist.** See below |

### The executor is the open milestone

An AppBoundry artifact today is a Wasm guest with `network: "none"`, `filesystem: "none"`, no model access, no
subprocesses and a 15-minute action limit (`appboundry-host/src/manifest.ts`, `guest.ts`). FeltKit's AppBoundry build
refuses `ctx.agent`, `ctx.model` and integrations for that reason. Eve's work needs model calls, outbound HTTPS, a git
working copy and test runs measured in minutes. So "the Eve artifact executes using the host's capabilities" needs
AppBoundry to provide those capabilities, with the authority staying on the application side:

1. a **model** capability (the host calls the model with a Resolver-revealed credential);
2. **outbound calls** to the application's bridge and to declared hosts;
3. a **workspace** capability: a durable working copy and declared checks run by the host in a sandbox;
4. **run records** for (3)-(5): start, status, cancel, a resumable event stream, served over HTTP.

The other path is to run eve's existing Node build as a host-side component (components@1), which needs component
directories and durable component state. The earlier investigation ([INVESTIGATION-EVE-ON-APPBOUNDRY.md](./INVESTIGATION-EVE-ON-APPBOUNDRY.md))
records why neither exists yet. Which path to take is a decision for AppBoundry, not for this application. The
contract above does not change with that decision.

Until then, the local Node 26 run (eve as FeltKit's child process) is the contract's reference implementation and
its test bed. It is not a deployment target.
