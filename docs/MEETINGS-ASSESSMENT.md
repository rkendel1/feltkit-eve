# Eve in Meetings: architecture assessment

Date: 2026-11-25. Inputs: the code of `rkendel1/meetings` (branch `claude/gallant-cannon-k8j6e9`), `rkendel1/feltkit`
(`packages/sdk`), `rkendel1/feltkit-eve`, `rkendel1/appboundry` and `rkendel1/xeet`. The AppBoundry side is in
[appboundry docs/architecture/agent-execution-host-capabilities.md](https://github.com/rkendel1/appboundry/blob/claude/trusting-faraday-j5o0md/docs/architecture/agent-execution-host-capabilities.md).

**Meetings invites Eve. Meetings does not host Eve. AppBoundry executes Eve.**

## 1. What already exists and is reused

| Need | Existing mechanism |
|---|---|
| An agent as a participant | Meetings treats any non-user principal as an agent (`_meeting.ts` `kindOf`) with role `agent` (`app.ts`). An agent joins through MCP/AppPort: it calls `meetings.join`, repeating it within 45 s as a heartbeat (`calls.ts`, `_presence.ts`), and leaves with `meetings.leave`. It appears in presence (`peers`, kind `agent`) |
| Invitation and access | `meetings.invited` holds principal ids, so an agent id is valid. Invite-only meetings answer NOT_FOUND to anyone not invited (`_meeting.ts` `mayAttend`). Revoking an invitation removes a live participant at once |
| Chat and captions | One timeline, `entries` (`kind: chat | caption | note | system`, per-meeting `seq`). An agent reads it with `meetings.feed` using a cursor and posts with `chat.send`, both authorized by presence |
| Prior decisions, action items | `decisions` and `actionItems` (`_records.ts`) carry `source` (person, agent, scribe or model), `sourceEntryId` and the meeting. Actions have `open`, `done` or `cancelled`. Summaries are versioned, and model-written ones carry `model` and `taskId` |
| Eve's engineering work | feltkit-eve: the GitHub provider, 16 `repo.*` functions, approvals of exact calls, provider-call records, Resolver receipts per session, and evidence |
| Execution seam | FeltKit's `ExternalReasoner` and `EveHost`, which speak eve's session protocol, plus the bridge back for capability calls |
| Image as evidence | Xeet's screenshot artifact (`xeet-capture/src/image.rs`): original bytes, sha256, a capture context (method, region, display scale, window, app, permissions) and digest verification. Its gateway hands a vision model the original bytes |

## 2. Missing interfaces

1. **AppBoundry execution.** The guest has no model, workspace, check, run or checkpoint capability. The contract above proposes them; nothing is implemented.
2. **FeltKit remote executor.** eve is always a local child process and the bridge accepts loopback only. → Being implemented now: a remote executor through the same seam (see §4).
3. **Cross-application identity.** A Meetings participant is not an Eve principal. Nothing links a person's Meetings identity to their Eve account.
4. **A meeting-side delivery path to Eve.** Meetings has no push to external agents; an agent polls `meetings.feed`.
5. **Record lifecycle in Meetings.**
   - Decisions have no status, so a proposal looks the same as a decision.
   - There is no commitment type apart from an action item.
   - There is no link to a previous meeting or series.
   - Evidence is only `sourceEntryId` and `taskId`.
6. **Files in Meetings.** Chat is text only (≤4000 characters) and the `files` service is not enabled.
7. **Xeet in the browser.**
   - The screenshot artifact builder is Rust-only; the WASM package exports rendering, not capture.
   - The macOS capture app has never been compiled or run.

## 3. Required changes in Meetings

The smallest set that keeps Meetings authoritative and adds no agent loop:

- **FeltKit 0.3.37 → current, Node 26.**
  - Required for the files service and current MCP idempotency.
  - The current FeltKit carries fixes Meetings' own docs list as unpublished: G1, MCP replay idempotency.
- **`observations` collection and capture tool.**
  - A participant captures a region in the browser: `getDisplayMedia` (the browser's own picker, visible to the person), then a selection, then the PNG bytes.
  - Xeet builds the artifact in the browser (once its WASM exports `capture`).
  - The image goes to Meetings' file store. The record links the meeting, call, timeline entry, capturer, `capturedAt`, sha256, region, method and the artifact id.
  - A timeline entry `kind: observation` makes it visible to everyone present.
- **`observations.get` capability.** It returns the metadata and the original bytes, gated exactly like the timeline: an invited participant who is present.
- **Decision status.**
  - `proposed | decided | superseded`, plus `decidedBy`. A model or agent may propose; only a person decides.
  - A `kind` for commitments.
  - `previousMeetingId` on meetings, so "the previous meeting" is a record, not a guess.
  - Existing records read as `decided` with source as recorded. Nothing an AI wrote becomes a decision without a person.
- **Agent invitations.** An agent id joins `invited` with the inviter and time recorded. The UI shows Eve as an agent participant.

## 4. Required changes in FeltKit and Eve

**FeltKit:**
- A remote executor on the existing seam.
  - Same session protocol and `ExternalReasoner`.
  - The person's assertion is signed ES256, so the executor holds the public key only.
  - The bridge accepts a non-loopback caller only with the remote executor's service key.
  - The capability list is served over the bridge.
- The local child process stays as the development executor.
- Server-side dispatch for a linked person, so an application can start a session on behalf of a person it has authenticated, not only from that person's browser.

**feltkit-eve:**
- A `meetings` provider. It calls Meetings' AppPort/MCP capabilities with **Eve's own Meetings credential**, an agent identity issued by Meetings.
- A watcher, deterministic and not a model. It heartbeats `meetings.join` for meetings Eve is invited to, follows `meetings.feed` with a durable cursor, and dispatches a session when a linked person addresses Eve.
- An account link between a Meetings participant and an Eve person. Without one, Eve answers from meeting records only and does no repository work.

## 5. Required AppBoundry changes

`runs@1`, `model@1`, `workspace@1` and `checks@1`, with the publish effect authorization, per the contract. The
Eve `.app` must serve eve's session protocol on top of `runs@1`.

The agent loop itself is the largest piece. `@appport/eve` is a Node runtime (195 files, a FeltDB WASM World) and
does not compile into the guest. The `.app` needs a guest-side step loop: plan, call the model, call tools, checkpoint.

## 6. Security and authorization boundaries

- **Meeting membership ≠ execution authority.**
  - An invitation lets Eve read and post in that meeting only, with Eve's Meetings identity.
  - Repository work needs a work grant from a person **in Eve**, issued under Eve's roles. A meeting participant cannot raise it.
- **Eve's Meetings key grants only the `agent` role in Meetings:**
  - no hosting;
  - no captions authored as anyone else;
  - no reading meetings it was not invited to.
- **Every consequential call** (publish, issue, comment) needs a person's approval of that exact call, through Eve's approval path. A meeting message saying "approve" is not an approval.
- **Credentials.**
  - Meetings holds no Eve or GitHub credential.
  - Vercel (the application) holds no model or GitHub credential once execution moves to AppBoundry.
  - The executor holds no key that can mint a person's assertion.
- **Observations** are captured only by an explicit act of a present participant, are visible to all participants, and are readable only by those who may read the meeting. Eve's reading of an image is recorded as Eve's statement, never written into the observation.
- **Refusals** are posted to the meeting as refusals. Nothing retries around them. An `unknown` effect is reported and reconciled, never resent.
