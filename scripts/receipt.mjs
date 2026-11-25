// The Resolver receipt the application recorded for a session: EVE_SESSION=… EVE_WORKSPACE=… node scripts/receipt.mjs
import { createClient } from "@feltdb/feltkit/client";
const client = createClient({ url: process.env.EVE_URL ?? "http://localhost:3300", session: "bearer" });
await client.signInAsDevUser(process.env.EVE_USER ?? "ada");
await client.switchTenant(process.env.EVE_WORKSPACE);
const r = await client.query({ name: "bindings:forSession" }, { sessionId: process.env.EVE_SESSION });
console.log(JSON.stringify(r && { sessionId: r.sessionId, resolvedAt: r.resolvedAt, refs: r.refs.map((x) => ({ name: x.name, ref: x.ref, revision: x.revision, value: x.value })) }));
