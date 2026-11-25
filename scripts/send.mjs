// Send a follow-up message into an existing session: EVE_SESSION=… EVE_WORKSPACE=… node scripts/send.mjs "<message>"
import { createClient } from "@feltdb/feltkit/client";
const client = createClient({ url: process.env.EVE_URL ?? "http://localhost:3300", session: "bearer" });
await client.signInAsDevUser(process.env.EVE_USER ?? "ada");
await client.switchTenant(process.env.EVE_WORKSPACE);
console.log(JSON.stringify(await client.eve("engineer").send(process.env.EVE_SESSION, process.argv[2])));
