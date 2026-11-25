import { eveChannel } from "eve/channels/eve";
import { feltkitAuth } from "@feltdb/feltkit/eve";

// Only people the application signed in reach the agent (/eve/engineer/…), each with their workspace and a work grant.
export default eveChannel({ auth: [feltkitAuth()] });
