// A first real session, as a person would start it through the application: sign in, create a workspace, activate Eve,
// ask for read-only work on the real repository, follow the session until it settles, print what was recorded.
//   EVE_URL=http://localhost:3300 node scripts/first-session.mjs "<message>"
import { createClient } from "@feltdb/feltkit/client";

const url = process.env.EVE_URL ?? "http://localhost:3300";
const client = createClient({ url, session: "bearer" });
const who = await client.signInAsDevUser("ada");
const workspace = await client.createTenant(`eve-${Date.now()}`);
await client.switchTenant(workspace.id);
const eve = client.eve("engineer");
console.log("signed in", who.id, "workspace", workspace.id, "status", JSON.stringify(await eve.status()));
console.log("activate", JSON.stringify(await eve.activate()));
const message = process.argv[2] ?? "Open a working copy of rkendel1/appboundry (workspace name: first-look) and list its top-level directory and packages/. Say what the repository is, from what you read. Do not change anything.";
const started = await eve.start(message);
console.log("session", JSON.stringify(started));
const sessionId = started.sessionId ?? started.id;
console.log(`EVE_SESSION=${sessionId} EVE_WORKSPACE=${workspace.id}`);
