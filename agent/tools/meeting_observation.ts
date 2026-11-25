import { toolOutput, toolOutputPart } from "eve/tools";
import { feltkitCapability } from "@feltdb/feltkit/eve";
import capabilities from "../lib/feltkit-capabilities.json" with { type: "json" };

/**
 * An observation, for whichever model Eve runs on: the original image as vision input, and xeet's text projection of
 * the same artifact (capture context, geometry, and any recognized text marked !inferred) for reading. The image is
 * passed as captured; the recorded tool output keeps everything, the model sees both forms.
 */
export default feltkitCapability(capabilities["meeting.observation"], {
  toModelOutput: (output) => {
    const o = output as { imageBase64?: string; mediaType?: string; projection?: string } & Record<string, unknown>;
    const { imageBase64, projection, ...meta } = o;
    const header = `Observation ${String(meta.id)} by ${String(meta.capturedBy)} at ${String(meta.capturedAt)}${meta.caption ? ` ("${String(meta.caption)}")` : ""}, ${String(meta.width)}x${String(meta.height)}, ${String(meta.sha256)}. The image is evidence of what was on screen; text marked !inferred was read by a machine and may be wrong.`;
    return toolOutput.content([
      toolOutputPart.text(`${header}\n\n${projection ?? "(no text projection)"}`),
      ...(imageBase64 ? [toolOutputPart.file(imageBase64, { mediaType: String(o.mediaType ?? "image/png") })] : []),
    ]);
  },
});
