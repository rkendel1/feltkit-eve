// A person's answer to one approval request of a session: EVE_SESSION=… EVE_WORKSPACE=… node scripts/answer.mjs <interactionId> approve|deny
import { createClient } from "@feltdb/feltkit/client";
const client = createClient({ url: process.env.EVE_URL ?? "http://localhost:3300", session: "bearer" });
await client.signInAsDevUser(process.env.EVE_USER ?? "ada");
await client.switchTenant(process.env.EVE_WORKSPACE);
console.log(JSON.stringify(await client.eve("engineer").answer(process.env.EVE_SESSION, process.argv[2], process.argv[3])));
