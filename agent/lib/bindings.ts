/**
 * The session's configuration: the application resolves the model, repository and profile references once per session
 * (eve.bindings.resolve, recorded in its FeltDB) and this memo keeps the answer for every model call of the session.
 */
export interface Binding { name: string; ref: string; kind: string; revision: number; value: any }
export interface SessionBindings { sessionId: string; refs: Binding[] }

const env = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set: this agent runs under FeltKit, which sets it.`);
  return value;
};

/** The same bridge call the agent's tools make (FeltKit's eve bridge), as the person whose turn this is. */
async function resolveOnce(sessionId: string, grant: unknown): Promise<SessionBindings> {
  if (typeof grant !== "string" || !grant) throw new Error("This turn carries no work grant: only a signed-in person's turn can resolve the session's configuration.");
  const response = await fetch(`${env("FELTKIT_URL")}/_feltkit/eve/${env("FELTKIT_EVE_AGENT")}/invoke`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${env("FELTKIT_EVE_SERVICE_KEY")}` },
    body: JSON.stringify({ capability: "eve.bindings.resolve", input: { sessionId }, grant, sessionId }),
  });
  const body = (await response.json().catch(() => null)) as { ok?: boolean; value?: SessionBindings; error?: { code?: string; message?: string } } | null;
  if (!body?.ok || !body.value) throw new Error(`The session's configuration did not resolve: ${body?.error?.code ?? response.status} ${body?.error?.message ?? ""}`);
  return { sessionId: body.value.sessionId, refs: body.value.refs };
}

export function sessionBindings(ctx: { session: { id: string; auth: { current?: { attributes: Record<string, unknown> } | null } }; memo: <T>(key: unknown, fn: () => Promise<T>) => Promise<T> }): Promise<SessionBindings> {
  return ctx.memo(["eve-bindings", ctx.session.id], () => resolveOnce(ctx.session.id, ctx.session.auth.current?.attributes.grant));
}

export const binding = (b: SessionBindings, name: string): Binding => {
  const found = b.refs.find((r) => r.name === name);
  if (!found) throw new Error(`The session has no ${name} binding.`);
  return found;
};

/** A profile's tool set: "engineer" works and publishes; "reviewer" reads and reports only. */
export const mayAct = (b: SessionBindings) => (binding(b, "profile").value?.tools ?? "engineer") !== "read-only";

import { ResolverClient } from "@appport/resolver-client";
let resolver: Promise<ResolverClient> | null = null;
/** A model binding's credential (a Resolver secret reference): revealed into memory for the call, never recorded. */
export async function credential(ref: string): Promise<string> {
  resolver ??= ResolverClient.connect({ url: env("RESOLVER_URL"), apiKey: env("RESOLVER_API_KEY"), live: true }).catch((error) => { resolver = null; throw error; });
  return (await resolver).secret(ref);
}
