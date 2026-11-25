import { defineDynamic, defineInstructions } from "eve/instructions";
import { binding, sessionBindings } from "../lib/bindings";

// The repository and the profile this session works with, as Resolver bound them when the session began.
export default defineDynamic(async (ctx) => {
  const b = await sessionBindings(ctx);
  const repository = binding(b, "repository");
  const profile = binding(b, "profile");
  return defineInstructions({
    role: "system",
    content: [
      `Repository: ${repository.value.repository} (from ${repository.ref}, revision ${repository.revision}). Work on this repository unless the person names another one the application allows.`,
      `Profile: ${profile.value.name} (from ${profile.ref}, revision ${profile.revision}). ${profile.value.instructions ?? ""}`,
      profile.value.tools === "read-only" ? "In this profile you read and report only: you have no tools that change a working copy, run checks, file issues or publish." : "",
    ].filter(Boolean).join("\n"),
  });
});
