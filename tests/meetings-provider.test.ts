/**
 * Eve's Meetings connection keeps Meetings' own refusal. AppPort turns a plain Error thrown by a provider into
 * "Internal error", so Eve once saw only that when she tried to speak in a meeting with no running call.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { AppPortError } from "@appport/protocol";
import { meetingsProvider } from "../providers/meetings.mjs";

async function meetingsAnswering(status: number, body: unknown) {
  const server = createServer((_req, res) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body)));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as { port: number };
  return { url: `http://127.0.0.1:${port}`, close: () => server.close() };
}

const capability = (name: string) => (meetingsProvider.capabilities as any[]).find((c) => c.options.name === name).options.handler;

test("a refusal from Meetings reaches Eve with its code and reason", async () => {
  const meetings = await meetingsAnswering(400, { ok: false, error: { code: "FAILED_PRECONDITION", message: "No call is running in this meeting." } });
  try {
    await meetingsProvider.start({ config: { url: meetings.url }, credential: async () => "agent-key" } as any);
    await assert.rejects(capability("meetings.attend.say")({ code: "abc-defg-hij", text: "hello" }), (e: unknown) =>
      e instanceof AppPortError && e.code === "meetings.FAILED_PRECONDITION" && /No call is running/.test(e.message));
  } finally {
    meetings.close();
  }
});

test("standard refusals keep their AppPort code", async () => {
  const meetings = await meetingsAnswering(403, { ok: false, error: { code: "FORBIDDEN", message: "This agent is not one of this organization's active agents." } });
  try {
    await meetingsProvider.start({ config: { url: meetings.url }, credential: async () => "agent-key" } as any);
    await assert.rejects(capability("meetings.attend.join")({ code: "abc-defg-hij" }), (e: unknown) => e instanceof AppPortError && e.code === "FORBIDDEN" && /active agents/.test(e.message));
  } finally {
    meetings.close();
  }
});

test("without a Meetings key Eve is told so, not given an internal error", async () => {
  await meetingsProvider.start({ config: { url: "http://127.0.0.1:9" }, credential: async () => null } as any);
  await assert.rejects(capability("meetings.attend.join")({ code: "abc-defg-hij" }), (e: unknown) => e instanceof AppPortError && /no Meetings credential/.test(e.message));
});
