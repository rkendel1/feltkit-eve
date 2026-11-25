import { defineDynamic } from "eve/tools";
import { feltkitCapability } from "@feltdb/feltkit/eve";
import capabilities from "../lib/feltkit-capabilities.json" with { type: "json" };
import { mayAct, sessionBindings } from "../lib/bindings";

// Offered only when the session's profile may act (Resolver's profile reference; "read-only" profiles may not).
const tool = feltkitCapability(capabilities["repo.issues.create"]);
export default defineDynamic(async (ctx) => (mayAct(await sessionBindings(ctx)) ? tool : null));
