/**
 * Eve: an engineering agent application.
 *
 *   The product           this application's UI (src/), deployed to Vercel; Vercel forwards the API paths here.
 *   The authority         this application (FeltKit): accounts, workspaces, roles, the agent's work grants, approvals.
 *   The agent             an eve agent (agent/), run and supervised by FeltKit, its sessions in FeltDB; it acts only
 *                         through the capabilities below, as a workspace member, under the person's work grant.
 *   External work         the GitHub provider (providers/github.ts): workspaces, checks, issues, branches and pull
 *                         requests, every external effect recorded before and after it happens.
 *   Configuration         Resolver references (model, repository, agent profile), resolved once per session.
 *
 * Everything durable is in this application's FeltDB instance (.feltkit/<environment>/state; the agent's sessions
 * under .feltkit/<environment>/eve).
 */
import { feltkit } from "@feltdb/feltkit";

export const app = feltkit({
  name: "eve",
  description: "An engineering agent: give it a task on a repository; inspect what it did, decided, ran, verified and changed.",
  roles: {
    // Every account: create a workspace or accept an invitation. What else a person may do comes with a workspace role.
    person: [],
    // The application's operators: configuration and credentials for the whole environment.
    operator: ["configuration.*", "credential.*", "jobs.*", "feltkit.operations.*"],
    // Workspace roles, highest first.
    owner: ["eve.*", "repo.*", "tenant.*", "feltkit.agent.read", "feltkit.agent.write", "feltkit.workers.write", "configuration.read", "jobs.create", "jobs.execute"],
    member: ["eve.*", "repo.*", "feltkit.agent.read", "feltkit.agent.write", "configuration.read", "jobs.create", "jobs.execute"],
    viewer: ["eve.read", "repo.read", "feltkit.agent.read", "configuration.read"],
    // The agent: reads repositories, works in workspaces, runs declared checks; publishing and filing need a person's
    // approval of the exact call (the provider's consequential capabilities).
    agent: ["eve.read", "eve.bind", "repo.read", "repo.work", "repo.publish", "feltkit.agent.write"],
  },
  auth: {
    accounts: { roles: ["person"] },
    tenant: { name: "workspace", roles: ["owner", "member", "viewer", "agent"], create: "anyone" },
    // Vercel forwards /api, /eve and /appport here: one trusted proxy, whose X-Forwarded-Host is the page's host.
    session: { trustProxy: 1 },
  },
  dev: {
    users: [
      { id: "ada", name: "Ada Lovelace", roles: ["person", "operator"] },
      { id: "lin", name: "Lin Chen", roles: ["person"] },
    ],
  },
  services: { configuration: true },
  // GitHub (providers/github.mjs): the repositories Eve may work on, and the checks it may run in each. The token is the
  // application's credential `github-token` (FELTKIT_CREDENTIAL_GITHUB_TOKEN in production), never the agent's.
  providers: {
    github: {
      module: "./providers/github.mjs",
      export: "githubProvider",
      config: {
        repositories: (process.env.EVE_REPOSITORIES ?? "rkendel1/appboundry").split(",").map((r) => r.trim()).filter(Boolean),
        ...(process.env.EVE_WORKDIR ? { workdir: process.env.EVE_WORKDIR } : {}),
        footer: "\n\n---\n_Opened by Eve._",
        checks: {
          "rkendel1/appboundry": {
            prepare: { argv: ["sh", "-c", "pnpm install --frozen-lockfile && pnpm build"], timeoutMs: 900_000 },
            build: { argv: ["pnpm", "build"], timeoutMs: 600_000 },
            test: { argv: ["npx", "vitest", "run"], target: "path", timeoutMs: 600_000 },
          },
        },
      },
      credentials: { "github-token": "github-token" },
    },
  },
  eve: {
    engineer: {
      displayName: "Eve",
      roles: ["agent"],
      tenantRole: "agent",
      // Its tools, and all a person's grant names: the provider capabilities these functions call are their
      // implementation (FeltKit authorizes them by the agent's role under the grant that covered the function).
      capabilities: ["repo.*", "eve.bindings.resolve"],
    },
  },
});
