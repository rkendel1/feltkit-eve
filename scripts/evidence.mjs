// Print one session's recorded timeline once: EVE_SESSION=… EVE_WORKSPACE=… node scripts/evidence.mjs
import { createClient } from "@feltdb/feltkit/client";
const client = createClient({ url: process.env.EVE_URL ?? "http://localhost:3300", session: "bearer" });
await client.signInAsDevUser(process.env.EVE_USER ?? "ada");
await client.switchTenant(process.env.EVE_WORKSPACE);
const e = await client.eve("engineer").evidence(process.env.EVE_SESSION);
console.log(`state=${e.state} control=${e.control?.phase} answers=${e.answers.length}`);
for (const t of e.timeline) console.log(t.at?.slice(11, 19), t.kind, t.tool ?? "", t.outcome ?? "", (t.output ?? t.text ?? (t.input ? JSON.stringify(t.input) : "")).toString().replace(/\s+/g, " ").slice(0, 300));
