# Eve: the Vercel ↔ AppBoundry boundary

> **Superseded in part (2026-11-25).** The deployment drawn below (Vercel rewriting `/api`, `/eve` and `/appport` to a
> separate Node `eve-runtime` server) was a consequence of the first implementation, not the target. The target is the
> FeltKit application on Vercel calling an executor on AppBoundry through [the execution contract](./EXECUTION-CONTRACT.md).
> The ownership table and the gaps found remain accurate.

Decision (2026-11-25): Eve is one application with a split deployment. **Vercel** serves the product; **AppBoundry's
Hetzner host** runs Eve's execution: the FeltKit application with the integrated eve agent (`feltkit({ eve })`). No new
agent runtime, no second database, no new authorization system.

This document is the contract. Every mechanism it names exists today unless marked **gap**, with its source.

## The two deployments

```
 browser ──HTTPS──▶ Vercel (eve.<domain>)                       AppBoundry Hetzner host
                    ├─ the Eve UI (static build)                ┌──────────────────────────────────────────────┐
                    └─ rewrites /api/*, /eve/*, /appport* ─────▶│ eve-runtime: a FeltKit application (Node 26)  │
                       (no secrets, no database)                 │  ├─ FeltDB (authoritative; on the service's   │
                                                                │  │   volume, backed up by every deploy)        │
                                                                │  ├─ identity: FeltKit accounts and sessions    │
                                                                │  ├─ authority: roles, AppPort, approvals       │
                                                                │  ├─ eve agent `engineer` (child process,       │
                                                                │  │   sessions/runs in FeltDB via the World)    │
                                                                │  └─ providers: GitHub, workspace, model        │
                                                                └──────────────────────────────────────────────┘
                                                                       │ Resolver (resolver.resolve over AppPort)
```

- **eve-runtime** is built with `feltkit deploy --target container` (which carries eve agents whose project is the
  application itself: `packages/sdk/src/cli/deploy.ts`) and shipped with `@appport/hetzner-deploy` (the same command
  as every service on the host; it backs up the service's writable mounts and rolls back an unhealthy deploy).
- **Vercel** serves the UI and forwards the application's API paths to eve-runtime with external rewrites. A person
  signs in to eve-runtime (FeltKit accounts); the session cookie is the application's; Vercel never holds a session
  secret, a service key, a model key or a GitHub token, and stores nothing.

## Who owns what

| Concern | Owner | Mechanism (existing) |
|---|---|---|
| User identity, sessions | eve-runtime | FeltKit accounts; HttpOnly `__Host-fk_session` cookie; CSRF token (`server/session-http.ts`) |
| Task creation and identity | eve-runtime | an application mutation (`tasks:create`), FeltDB record, idempotency key from the client |
| Agent identity | eve-runtime | the eve agent is a worker in the person's workspace (`server/eve.ts`) |
| Delegated authority | eve-runtime | the person's work grant to the agent's worker; AppPort checks every capability call |
| Run / session identity, durable state | eve-runtime | eve sessions and runs in FeltDB through `@appport/eve-world-feltdb` |
| Execution dispatch | eve-runtime | the person's request forwarded to `/eve/engineer/…` with FeltKit's signed assertion |
| Lifecycle, cancellation | eve-runtime | agent control (`AGENT-CONTROL.md`: pause, interrupt, stop) |
| Approval | eve-runtime | eve pauses; a person's approval issues an AppPort approval of exactly that call |
| Capability invocation | eve-runtime | FeltKit's bridge `/_feltkit/eve/engineer/…` → the app's capabilities, providers' effects recorded before and after |
| Resolver bindings | Resolver | references read by eve-runtime per run; recorded with the run |
| Events, activity, evidence | eve-runtime | FeltDB records; the Board is a read-only projection of them |
| Outcome reconciliation | eve-runtime | provider-call records (`succeeded` / `failed` / unknown), reconciled before any resend |
| Product UI | Vercel | static build; all data through the forwarded API, as the signed-in person |

Vercel is never an authority: it cannot dispatch, read or approve anything a person's session could not, because it
holds no credential of its own.

## Requirements → how they hold

| Requirement | How |
|---|---|
| Service-to-service authentication | none needed: there is no service credential on Vercel. The only caller of eve-runtime is the person's browser (through the rewrite) |
| Execution bound to the initiating user and application | the session identifies the person; FeltKit signs the assertion it forwards to eve; the work grant names the worker |
| No broad reusable user credential to the agent | eve receives a five-minute assertion; capability calls go through FeltKit's bridge with the agent's own key |
| AppPort / AuthBoundry semantics preserved | unchanged: they run where they run today |
| Approvals enforced on the authoritative side | AppPort approvals are issued and checked by eve-runtime |
| Unauthorized task/run access | FeltKit roles and workspace scoping on every function and session |
| No duplicate consequential execution | idempotency keys on mutations; providers' effect lifecycle; eve's in-band fence |
| Timeouts and unknown outcomes | provider calls recorded `started` before the effect; unknown is never replayed blindly |
| Durability, restart recovery | FeltDB on the service volume; eve's World re-delivers its queue; backups on every deploy |
| Secrets out of UI, logs, evidence | provider keys are host-side `env_file` secrets; FeltKit redacts credentials from records |

## Gaps found so far

1. **CSRF behind a trusted proxy (FeltKit).** `checkCookieRequest` compares `Origin` with the raw `Host` header. Behind
   Vercel's rewrite, `Host` is eve-runtime's and `Origin` is Vercel's, so every cookie-authenticated write would be
   refused. FeltKit already has `auth.session.trustProxy` and `publicHost()` (X-Forwarded-Host behind a trusted proxy);
   the check must use the public host when the proxy is trusted. Smallest correct fix, in FeltKit.
2. **Streaming through the rewrite (unverified).** Eve's session stream and `/api/events` are server-sent events. Vercel
   external rewrites must pass them through without buffering or cutting them off; this is checked on a real Vercel
   deployment before relying on it.
3. **Repository and agent-profile references (FeltKit).** FeltKit resolves only model references today
   (`docs/RESOLVER.md`, "Not yet"). Repository and profile references need the same typed declaration, resolution in
   the call path and receipt.
4. **A GitHub/workspace provider in FeltKit's provider form (`defineProvider`).** Eve2's GitHub provider is a standalone
   AppPort service; eve-runtime takes providers in-process (`feltkit({ providers })`).

## Not decided here

- The public hostnames (Vercel domain, eve-runtime's host name and its Caddy route on the Hetzner host).
- Where Resolver runs for production (a service on the same host is the obvious place).
