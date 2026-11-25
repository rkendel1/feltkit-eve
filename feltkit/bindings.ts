/**
 * Live configuration through Resolver: the model, the repository and the agent profile an agent session uses are
 * stable references, resolved once per session and recorded here (the receipt: reference, kind, revision, value).
 * The session keeps that receipt for its whole life, across restarts; the next session resolves again, so a changed
 * binding reaches new work without a rebuild or redeploy and never changes work already running.
 *
 * Resolver decides configuration, never authority: the provider's repository allowlist and the person's work grant
 * still decide what the agent may do.
 */
import { ResolverClient, ResolverClientError } from "@appport/resolver-client";
import { fail, s } from "@feltdb/feltkit";
import { app } from "./app.js";

/** The references Eve depends on (configurable per environment, e.g. ref://prod/… in production). */
export const REFERENCES = {
  model: process.env.EVE_REF_MODEL ?? "ref://dev/eve/model",
  repository: process.env.EVE_REF_REPOSITORY ?? "ref://dev/eve/repository",
  profile: process.env.EVE_REF_PROFILE ?? "ref://dev/eve/profile",
} as const;

export const bindings = app.collection(
  "bindings",
  {
    sessionId: s.string(),
    resolvedAt: s.string(),
    resolvedFor: s.string(),
    refs: s.array(s.object({ name: s.string(), ref: s.string(), kind: s.string(), revision: s.number(), value: s.unknown() })),
  },
  { tenant: true },
);

let client: ResolverClient | null = null;
function resolver(): ResolverClient {
  const url = process.env.RESOLVER_URL;
  const apiKey = process.env.RESOLVER_API_KEY;
  if (!url || !apiKey) fail("CONFIGURATION", "Resolver is not configured: set RESOLVER_URL and RESOLVER_API_KEY (a key that may read Eve's references).");
  client ??= new ResolverClient({ url, apiKey, live: true });
  return client;
}

/** The receipt recorded for a session, or null. */
export const forSession = app.query({
  access: "eve.read",
  args: { sessionId: s.string() },
  handler: async (ctx, { sessionId }) => (await ctx.db.find(bindings, { sessionId }, { limit: 1 }))[0] ?? null,
});

/** The receipts of the workspace's sessions, newest first (the Board's Resolver history). */
export const history = app.query({
  access: "eve.read",
  args: { limit: s.optional(s.number()) },
  handler: async (ctx, { limit }) => (await ctx.db.find(bindings, {}, { limit: Math.min(limit ?? 50, 200) })).sort((a, b) => (a.resolvedAt < b.resolvedAt ? 1 : -1)),
});

/** Record a receipt once per session: a concurrent second one finds the first. */
export const record = app.mutation({
  access: "eve.bind",
  visibility: "internal",
  args: { sessionId: s.string(), refs: s.array(s.object({ name: s.string(), ref: s.string(), kind: s.string(), revision: s.number(), value: s.unknown() })) },
  handler: async (ctx, { sessionId, refs }) => {
    const [existing] = await ctx.db.find(bindings, { sessionId }, { limit: 1 });
    if (existing) return existing;
    const id = await ctx.db.insert(bindings, { sessionId, refs, resolvedAt: new Date().toISOString(), resolvedFor: ctx.auth.principal?.id ?? "unknown" });
    return ctx.db.get(bindings, id);
  },
});

/** What the agent's session runs on: resolved now if this is its first call, else the receipt it already has. */
export const resolve = app.action({
  access: "eve.bind",
  args: { sessionId: s.string() },
  returns: s.unknown(),
  capability: { name: "eve.bindings.resolve", description: "The model, repository and profile this session uses, resolved once per session through Resolver." },
  handler: async (ctx, { sessionId }) => {
    const existing = await ctx.runQuery({ name: "bindings:forSession" } as never, { sessionId });
    if (existing) return existing;
    const refs = [];
    for (const [name, ref] of Object.entries(REFERENCES)) {
      try {
        const r = (await resolver().resolve(ref, { key: sessionId })) as { kind?: string; revision: number; selected?: { value?: unknown } & Record<string, unknown> };
        const target = r.selected ?? {};
        refs.push({ name, ref, kind: r.kind ?? "value", revision: r.revision, value: "value" in target ? target.value : target });
      } catch (error) {
        if (error instanceof ResolverClientError) fail(error.authoritative ? "FAILED_PRECONDITION" : "UNAVAILABLE", `${ref} did not resolve: ${error.message}`, { details: { ref, code: error.code } });
        throw error;
      }
    }
    return ctx.runMutation({ name: "bindings:record" } as never, { sessionId, refs });
  },
});
