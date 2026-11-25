import { feltkitCapability } from "@feltdb/feltkit/eve";
import capabilities from "../lib/feltkit-capabilities.json" with { type: "json" };

export default feltkitCapability(capabilities["repo.workspace.search"]);
