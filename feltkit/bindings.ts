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

let client: Promise<ResolverClient> | null = null;
function resolver(): Promise<ResolverClient> {
  const url = process.env.RESOLVER_URL;
  const apiKey = process.env.RESOLVER_API_KEY;
  if (!url || !apiKey) fail("CONFIGURATION", "Resolver is not configured: set RESOLVER_URL and RESOLVER_API_KEY (a key that may read Eve's references).");
  client ??= ResolverClient.connect({ url, apiKey, live: true }).catch((error) => { client = null; throw error; });
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
    const existing = await ctx.runQuery({ name: "bindings:forSession" } as never, { sessionId } as never);
    if (existing) return existing;
    const refs = [];
    for (const [name, ref] of Object.entries(REFERENCES)) {
      try {
        const r = (await (await resolver()).resolve(ref, { key: sessionId })) as { kind?: string; revision: number; selected?: { value?: unknown } & Record<string, unknown> };
        const target = r.selected ?? {};
        refs.push({ name, ref, kind: r.kind ?? "value", revision: r.revision, value: "value" in target ? target.value : target });
      } catch (error) {
        if (error instanceof ResolverClientError) fail(error.authoritative ? "FAILED_PRECONDITION" : "UNAVAILABLE", `${ref} did not resolve: ${error.message}`, { details: { ref, code: error.code } });
        throw error;
      }
    }
    return ctx.runMutation({ name: "bindings:record" } as never, { sessionId, refs } as never);
  },
});

const KINDS: Record<keyof typeof REFERENCES, string> = { model: "model", repository: "value", profile: "value" };

/** What each reference resolves to now (nothing recorded): the Resolver page's current bindings. */
export const current = app.action({
  access: "eve.read",
  returns: s.unknown(),
  handler: async () => {
    const out = [];
    for (const [name, ref] of Object.entries(REFERENCES)) {
      try {
        const r = (await (await resolver()).resolve(ref)) as { kind?: string; revision: number; ttlSeconds?: number; updatedAt?: string; selected?: { value?: unknown } & Record<string, unknown> };
        const target = r.selected ?? {};
        out.push({ name, ref, kind: r.kind ?? KINDS[name as keyof typeof REFERENCES], revision: r.revision, ttlSeconds: r.ttlSeconds ?? null, updatedAt: r.updatedAt ?? null, value: "value" in target ? target.value : target });
      } catch (error) {
        out.push({ name, ref, kind: KINDS[name as keyof typeof REFERENCES], error: error instanceof ResolverClientError ? `${error.code}: ${error.message}` : String(error) });
      }
    }
    return out;
  },
});

let writer: ResolverClient | null = null;
/**
 * Change one of Eve's bindings in Resolver, as the operator's change: the next session uses it; running sessions keep
 * theirs. Resolver authorizes it with this deployment's write key (RESOLVER_WRITE_KEY, granted write on Eve's references
 * only) and records who asked in its history; a stale expectedRevision is refused, never overwritten.
 */
export const set = app.action({
  access: "eve.configure",
  args: { name: s.enum(["model", "repository", "profile"]), value: s.unknown(), expectedRevision: s.number(), reason: s.string({ minLength: 1, maxLength: 300 }) },
  returns: s.unknown(),
  handler: async (ctx, { name, value, expectedRevision, reason }) => {
    const url = process.env.RESOLVER_URL;
    const apiKey = process.env.RESOLVER_WRITE_KEY;
    if (!url || !apiKey) fail("CONFIGURATION", "Changing bindings from Eve needs RESOLVER_WRITE_KEY (write on Eve's references). Without it, change them in Resolver itself.");
    writer ??= new ResolverClient({ url, apiKey, live: false });
    const ref = REFERENCES[name];
    try {
      return await writer.put({ ref, binding: { value }, expectedRevision, reason: `${reason} (by ${ctx.auth.principal?.id ?? "unknown"} in Eve)` } as never);
    } catch (error) {
      if (error instanceof ResolverClientError) fail(error.code === "CONFLICT" ? "CONFLICT" : "FAILED_PRECONDITION", `Resolver refused the change to ${ref}: ${error.message}`, { details: { ref, code: error.code } });
      throw error;
    }
  },
});
