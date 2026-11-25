import { defineAgent } from "eve";
import { defineDynamic } from "eve/models";
import { anthropic } from "eve/models/anthropic";
import { feltkitControl } from "@feltdb/feltkit/agent";

// Eve's engineering agent. Its sessions are stored in FeltDB through the FeltDB World, under this application's state
// (FeltKit sets EVE_FELTDB_PATH). It has no shell of its own: it works on repositories only through the application's
// capabilities (agent/tools/repo_*.ts), which FeltKit authorizes as the agent's worker under the person's grant.
export default defineAgent({
  model: defineDynamic(async () => ({ model: anthropic("claude-opus-5-5"), modelContextWindowTokens: 200_000 })),
  defaultTools: false,
  control: feltkitControl(),
  experimental: { workflow: { world: "@appport/eve-world-feltdb", retention: "default" } },
});
