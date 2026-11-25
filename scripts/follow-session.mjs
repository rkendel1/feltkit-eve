// Follow one session's recorded evidence until its turn has settled: EVE_SESSION=<id> EVE_WORKSPACE=<tenant> node scripts/follow-session.mjs
import { createClient } from "@feltdb/feltkit/client";
const client = createClient({ url: process.env.EVE_URL ?? "http://localhost:3300", session: "bearer" });
await client.signInAsDevUser(process.env.EVE_USER ?? "ada");
await client.switchTenant(process.env.EVE_WORKSPACE);
const eve = client.eve("engineer");
const deadline = Date.now() + Number(process.env.EVE_WAIT_MS ?? 600_000);
let last = "";
for (;;) {
  const e = await eve.evidence(process.env.EVE_SESSION);
  const kinds = e.timeline.map((t) => t.kind ?? t.type).join(",");
  const line = `state=${e.state} control=${e.control?.phase} timeline=${e.timeline.length} [${kinds.slice(-200)}]`;
  if (line !== last) { console.log(new Date().toISOString(), line); last = line; }
  const settled = e.timeline.some((t) => /turn\.(settled|completed)|turn-settled/.test(String(t.kind ?? t.type)));
  if ((settled && e.state === "idle") || e.state === "waiting" || Date.now() > deadline) { console.log(JSON.stringify(e.timeline, null, 1).slice(0, 15000)); break; }
  await new Promise((r) => setTimeout(r, 5_000));
}
