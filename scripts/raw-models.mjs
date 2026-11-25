// Which models eve recorded running in a session (its raw stream, through the application): EVE_SESSION=… EVE_WORKSPACE=…
import { createClient } from "@feltdb/feltkit/client";
const url = process.env.EVE_URL ?? "http://localhost:3300";
let token = null;
const client = createClient({ url, session: "bearer", tokens: { get: () => token, set: (t) => { token = t; }, clear: () => { token = null; } } });
await client.signInAsDevUser("ada");
await client.switchTenant(process.env.EVE_WORKSPACE);
const r = await fetch(`${url}/eve/engineer/eve/v1/session/${process.env.EVE_SESSION}/stream?startIndex=0&follow=false`, { headers: { authorization: `Bearer ${token}`, accept: "application/x-ndjson" } });
const text = await r.text();
const models = [...text.matchAll(/"(?:modelId|model)":\s*"([^"]+)"/g)].map((m) => m[1]);
console.log(r.status, [...new Set(models)].join(", ") || text.slice(0, 300));
