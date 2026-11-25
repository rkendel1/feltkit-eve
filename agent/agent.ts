import { defineAgent } from "eve";
import { defineDynamic } from "eve/models";
import { anthropic } from "eve/models/anthropic";
import { openai } from "eve/models/openai";
import { feltkitControl } from "@feltdb/feltkit/agent";
import { binding, credential, sessionBindings } from "./lib/bindings";

// Eve's engineering agent. Its sessions are stored in FeltDB through the FeltDB World, under this application's state
// (FeltKit sets EVE_FELTDB_PATH). It works on repositories only through the application's capabilities
// (agent/tools/repo_*.ts), which FeltKit authorizes as the agent's worker under the person's grant.
//
// Its model is whatever Resolver's model reference named when the session began (lib/bindings.ts): the receipt is
// recorded once per session in the application's FeltDB, and the provider key is revealed into memory per call.
export default defineAgent({
  model: defineDynamic(async (ctx) => {
    const target = binding(await sessionBindings(ctx), "model").value as { provider: string; model: string; credential?: string };
    const apiKey = target.credential ? await credential(target.credential) : undefined;
    if (target.provider === "anthropic") return { model: anthropic(target.model, apiKey ? { apiKey } : {}), modelContextWindowTokens: 200_000 };
    if (target.provider === "openai") return { model: openai(target.model, apiKey ? { apiKey } : {}), modelContextWindowTokens: 200_000 };
    throw new Error(`The model reference names provider ${target.provider}, which this agent does not call.`);
  }),
  defaultTools: false,
  control: feltkitControl(),
  experimental: { workflow: { world: "@appport/eve-world-feltdb", retention: "default" } },
});
