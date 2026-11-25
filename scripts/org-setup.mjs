// Set up an organization's Eve for Meetings, as its owner (Ada, development): workspace, Eve activated, the meeting
// delegation (exact capabilities), and the Meetings connection (prints the token Meetings keeps as credential `eve`).
import { createClient } from "@feltdb/feltkit/client";
const client = createClient({ url: process.env.EVE_URL ?? "http://localhost:3300", session: "bearer" });
await client.signInAsDevUser("ada");
const t = await client.createTenant(process.env.EVE_ORG ?? "Acme engineering");
const eve = client.eve("engineer");
await eve.activate();
const caps = (process.env.EVE_DELEGATE ?? "meeting.join,meeting.wait,meeting.say,meeting.context,meeting.observations,meeting.observation,meeting.leave,repo.issues.get,repo.issues.find,repo.changes.find,repo.changes.get,repo.workspace.open,repo.workspace.status,repo.workspace.list,repo.workspace.read,repo.workspace.search,eve.bindings.resolve").split(",");
const delegation = await client.action({ name: "meetingsession:delegate" }, { capabilities: caps });
const connected = await client.action({ name: "meetingsession:connect" }, {});
// Meetings joins the workspace with the workspace role meetingsapp: only what the connection may do, never Eve's role.
await client.addMember(connected.worker, "meetingsapp");
console.error(JSON.stringify({ workspace: t.id, delegation: { grant: delegation.grant, capabilities: delegation.capabilities, setBy: delegation.setByName }, meetingsWorker: connected.worker, meetingsGrant: connected.grant }));
process.stdout.write(connected.token);
