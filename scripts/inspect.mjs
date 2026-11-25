// The full recorded evidence of one session: every tool call's input and output, and the approvals asked and answered.
//   EVE_SESSION=… EVE_WORKSPACE=… node scripts/inspect.mjs [tool-name-filter]
import { createClient } from "@feltdb/feltkit/client";
const client = createClient({ url: process.env.EVE_URL ?? "http://localhost:3300", session: "bearer" });
await client.signInAsDevUser(process.env.EVE_USER ?? "ada");
await client.switchTenant(process.env.EVE_WORKSPACE);
const e = await client.eve("engineer").evidence(process.env.EVE_SESSION);
const filter = process.argv[2];
for (const t of e.timeline) if (!filter || String(t.tool ?? t.kind).includes(filter)) console.log(JSON.stringify(t, null, 1).slice(0, 6000));
console.log("answers", JSON.stringify(e.answers), "state", e.state);
