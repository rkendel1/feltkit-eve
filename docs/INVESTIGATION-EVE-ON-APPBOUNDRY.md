# Can AppBoundry's components run the FeltKit-integrated eve?

Investigation, 2026-11-25. No implementation. Question: can AppBoundry's existing component architecture (`components@1`)
execute the eve runtime FeltKit already integrates, without a second agent implementation or a separate infrastructure
stack? Every answer cites code, a test, or a measurement taken here (Node 26.13.1; `@appport/eve` 1.1.2,
`@appport/eve-world-feltdb` latest, `@appport/appboundry` 1.15 sources, FeltKit `main`).

## What FeltKit's integration is today

`packages/sdk/src/server/eve.ts` (`feltkit({ eve })`):

- **Process.** Each agent is its eve project's production server (`eve start`, `.output/server/index.mjs`) on a loopback
  port, a child process FeltKit builds, supervises and restarts.
- **State.** eve's sessions and runs are in FeltDB through the FeltDB World, in **their own embedded store**
  (`EVE_FELTDB_PATH = <environment runtime dir>/eve/<agent>`), beside the application's FeltDB, not in its collections.
- **Identity.** A person's traffic is forwarded to the agent only with a short-lived HS256 assertion FeltKit signs (the
  person, their workspace, roles and work grant); `@feltdb/feltkit/eve` `feltkitAuth()` verifies it in the agent.
- **Authority.** Tools are the application's capabilities, executed by FeltKit at its bridge (`/_feltkit/eve/<name>/…`,
  loopback, a key only the agent holds) as the agent's worker under the person's work grant; AppPort checks each call.
- **Approval.** eve holds the pause; a person's approval in FeltKit issues an AppPort approval of exactly that call.

## Findings

### 1. Can an AppBoundry application declare a Node companion with `components@1`? Yes, but not eve as built.

The contract (AppBoundry `docs/contracts/feltkit-deploy/COMPONENTS.md` §1–2) requires each component to be **one
self-contained ESM file, Node builtins only**, imported by the companion host from its verified bytes as a `data:` URL.
FeltKit already builds its own `feltkit({ components })` that way.

eve's production build is not one file. Measured (`eve build`, a minimal agent with the FeltDB World): `.output` is
**15 MB in 195 files**. `server/index.mjs` is a 219-byte entry that imports `_chunks/`, `_libs/` and `_runtime.mjs`, and
the FeltDB engine is a separate 3.55 MB Wasm asset (`feltdb_wasm_bg-*.wasm`) read from disk. Relative imports and
asset reads do not resolve from a `data:` URL.

FeltKit's AppBoundry build does nothing with `feltkit({ eve })` (no reference in `src/appboundry/build.ts`): an
application's eve agents are not carried into its artifact today.

### 2. Does the component reach the application-scoped FeltDB? No. Only through the guest's own functions.

A companion container gets read-only mounts only: the artifact, its guest token, the derivation key, its declared
credentials (`packages/appboundry-agent/src/reconciler.ts` `COMPANION_MOUNTS`, `#startCompanion`). Its root is read-only
with a 128 MB `/tmp` tmpfs (`driver.ts`: `--read-only --tmpfs /tmp`). The application's FeltDB belongs to the runtime
container. The component's one path to application state is `ctx.call(name, args)`: the guest's `/api/query|mutation`,
as the component's declared service principal.

Consequence for eve: the FeltDB World needs a durable, writable directory it locks exclusively (measured: it creates
`state/owner.lock`, `state.1.journal`, `state.json`, `queue-auth-key`). In a companion, the only writable place is the
tmpfs, which does not survive a restart, so eve's sessions and runs, its durable execution, would be lost on every
restart. eve's World has no backend that stores through the application's functions.

### 3. Can it use FeltKit's existing eve integration and bridge? Not as it stands.

The integration's host side lives in FeltKit's server: the identity signer, the capability bridge
(`/_feltkit/eve/<name>/…`), the approval issuance and the session records (`_feltkit_eve_sessions`). None of it exists
on an AppBoundry host. The agent side (`@feltdb/feltkit/eve`: `feltkitAuth()`, `feltkitCapability()`) expects those
endpoints and keys (`FELTKIT_URL`, `FELTKIT_EVE_ASSERTION_KEY`, `FELTKIT_EVE_SERVICE_KEY`).

### 4. Lifecycle, restarts, jobs, identity, authority, sessions

| | AppBoundry today | eve needs |
|---|---|---|
| Lifecycle | the agent starts one hardened container per component and restarts it after it exits; health on `/_component/health`; a required component gates readiness; the whole deployment rolls back together (COMPONENTS.md §5, §7) | the same: this part fits |
| Durable sessions | no durable storage for a component (finding 2) | a durable FeltDB World |
| Identity | a component acts **only as its own service principal** toward the guest; there is no per-person identity forwarding to a component | the person, their workspace and work grant on every request (`feltkitAuth()`) |
| Authority | the guest's role checks for the component's principal | FeltKit's bridge, executing as the agent's worker under the person's grant |
| Approvals | an artifact runs no approval lifecycle (`approval: "required"` refuses non-persons) | AppPort approvals issued by FeltKit for exactly the paused call |
| Jobs | eve's queue is in its own World, in-process | — |
| Model | `ctx.model()` is `null`; credentials are operator-placed files | eve calls the model with the provider credential |

### 5. Cardinality

One container per component per application deployment (`#startCompanion`), from one pinned companion image. There is
no shared, multi-application companion. eve is also one process per agent under FeltKit. So: one eve process per agent
per application.

### 6. Resource cost (measured, Node 26)

| | Resident memory, idle |
|---|---|
| AppBoundry runtime (the outreach artifact from the actions work; guest instances included) | ~164 MB |
| eve agent server (`.output/server/index.mjs`, minimal agent, FeltDB World), 6 to 26 s after start | ~134 MB (steady), 11 threads |
| Companion container limit (default) | 256 MB, 0.5 CPU, 128 PIDs |

An idle eve fits the default limit. Under load (model calls with large contexts) it was not measured. Per application,
an eve companion roughly doubles the idle memory, and it is a second always-on process per agent.

### 7. Does it preserve "deploy an application, not operate an agent service"?

Partly. Deployment is one artifact, one deployment and one rollback, runtime and companions together. The operator does
not provision a separate agent service. But:

- Companion execution is **off by default** (`APPBOUNDRY_COMPANION_EXECUTION=1` on the execution host).
- The companion image (`packages/appboundry-companion/Dockerfile`) is defined but **not built or published**.
- Routing for component prefixes is rendered but not deployed (COMPONENTS.md §8).

And by findings 2 to 4, an eve companion today would be a per-application process with no durable state, acting as one
service principal: it would not be the integrated eve, durable, under the person's authority.

## What would have to change for components to run the integrated eve

None of these is a second agent implementation; each extends an existing contract:

1. **Component packaging (AppBoundry + FeltKit).** Either components@1 accepts a component *directory* (every file
   listed with its digest, verified, mounted read-only, imported from disk), or FeltKit re-bundles eve's server into one
   file. The first is the smaller, more general change; eve's Nitro output is designed to be a directory.
2. **Durable component state (AppBoundry).** A declared, durable, per-application state volume for a component
   (`state: true`), mounted read-write, backed up and restored with the application, lost with nothing. eve's FeltDB
   World then works unchanged.
3. **The integration's host side on AppBoundry (FeltKit + AppBoundry).** The identity assertion for a person's
   forwarded traffic, the capability bridge as the agent's worker under the person's grant, and the approval issuance.
   Today these are FeltKit server code. On AppBoundry they would be host features (the host already authenticates
   people, issues component tokens and executes functions as principals); there is no approval lifecycle yet.
4. **Model credential.** eve's provider key as a declared component credential, or the model behind a capability.
5. **Operations.** Build and publish the companion image, enable companion execution on the Hetzner host, deploy
   component routing.

## Open, not measured here

- eve's memory and CPU under real sessions (model calls, tools, long contexts).
- Cold start of an eve component (build to ready) on the Hetzner host.
- Whether one eve server can serve several applications (it is built per agent directory; nothing found suggests it).
