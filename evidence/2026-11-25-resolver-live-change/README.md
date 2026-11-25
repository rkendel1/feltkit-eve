# Resolver live change, 2026-11-25 (local eve-runtime, Node 26, real Claude, real rkendel1/appboundry)

One running eve-runtime (no rebuild, no restart between sessions). Resolver held Eve's references.

| | Model | Repository | Profile | Model eve recorded running |
|---|---|---|---|---|
| Session A (`wrun_01M89QJAPR44W8KG23N25A44X6`), started at revision 1 | `claude-opus-5-5` (r1) | `rkendel1/appboundry` (r1) | `engineer` (r1) | `anthropic/claude-opus-5.5` |
| bindings changed in Resolver: model → `claude-sonnet-5-5` (r2), profile → `reviewer`, read-only (r2) | | | | |
| Session B (`wrun_01M89QKFY5ZH5XS0DP2CNKSM0A`), started after the change | `claude-sonnet-5-5` (r2) | `rkendel1/appboundry` (r1) | `reviewer` (r2) | `anthropic/claude-sonnet-5.5` |
| Session A, asked again after the change | unchanged (r1) | unchanged | `engineer` (r1): wrote NOTES.md in its working copy | `anthropic/claude-opus-5.5` |

Session B, asked to write a file, had no write tool (the reviewer profile offers none) and said so. The receipts
(`*-receipt.json`) are the application's FeltDB records (`bindings`); they name the credential's reference, never the
key. eve-runtime ran without ANTHROPIC_API_KEY: the key was revealed from Resolver's vault into memory per call.
