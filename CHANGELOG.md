# Changelog

## UNRELEASED

- **Fix: integration test reliability** — Bash-based integration tests now provide a portable fallback for GNU coreutils' `timeout`, which is not installed by default on macOS. RPC tests wait for child-process streams before closing logs, and live integration files run serially to avoid shared session-state contention. The strict RPIV subagent regression still requires `../pi-subagents` checked out at 0.6.3 with its dependencies installed.

- **Add: claude-sonnet-5-5 model** — Anthropic's Claude Sonnet 5.5 is now selectable via `/model`, and the `sonnet` shortcut resolves to it (use the explicit `claude-sonnet-5` ID to pin Sonnet 5). Registers at 1M and requests `claude-sonnet-5-5[1m]`; a direct SDK probe measured bare at 200K and `[1m]` at 1M. Falls back to Sonnet 5's `xhigh→max` thinking map when the catalog entry carries none. Metadata is filled from pi's remote-catalog overlay cache (`agentDir/models-store.json`) since pi-ai's bundled catalog doesn't carry it yet.

- **Add: claude-opus-5-5 model** — Anthropic's Claude Opus 5.5 is now selectable via `/model`, and the `opus` shortcut resolves to it (use the explicit `claude-opus-5` ID to pin Opus 5). Registers at 1M and requests `claude-opus-5-5[1m]`, same `[1m]` policy as Opus 5/4.8 (inferred, pending a diag probe run). Metadata is filled from pi's remote-catalog overlay cache (`agentDir/models-store.json`) since pi-ai's bundled catalog doesn't carry it yet.

- **Fix: AGENTS.md discovery follows request cwd** — `resolveAgentsMdPath` and `extractAgentsAppend` walk from the dispatch `cwd` instead of the bridge owner's `process.cwd()`, so adopted bridge sessions pick up the requesting project's AGENTS.md.

- **Fix: Pi 0.86 normalized transcript compatibility** — provider streams now read the system prompt and tool declarations from transcript system messages, exclude those metadata records from Claude Code session history and cursor accounting, and start clean instead of resuming a nonexistent session when conversion produces no records. Pi peer and development dependencies now require 0.86+.

- **Add: non-zero cost display (reverses the 0.4.0 zeroing)** — `buildModels` now forwards Anthropic API list pricing from the pi-ai catalog (and remote-catalog overlay) through the provider projection, so pi's footer and `/session` stats show an API-equivalent estimate computed from real token counts. Billing is still subscription-based; the figure is for usage-intensity comparison (see README). Rates are normalized per field, so malformed or partial catalog entries yield `0` instead of a `NaN` footer. 1h-retention cache writes (`cache_creation.ephemeral_1h_input_tokens`) are now mapped to pi's `cacheWrite1h` and priced at 2x base input like the real API. With `CLAUDE_BRIDGE_DEBUG=1`, each query's `result` logs the SDK's own `total_cost_usd` beside the bridge's running tally so divergence between list-price math and Claude Code's estimate is observable.

- **Bump: Claude Agent SDK to 0.3.280** — required for Fable 5.1 and Opus 5.5 support; this pins Claude Code 2.1.280. The SDK ships its own pinned Claude Code build (`manifest.json`) rather than using a `claude` on `PATH`, so a locally updated CLI does not lift this floor — on 0.3.258 every `claude-opus-5-5` request failed with `400 … Claude Code 2.1.258 does not support this model; version 2.1.280 or newer is required`. The direct `@anthropic-ai/sdk` dependency is also bumped to 0.93+ to satisfy the SDK peer dependency.

- **Add: claude-fable-5-1 model** — Anthropic's Claude Fable 5.1 is now selectable via `/model`, and the `fable` shortcut resolves to it. It uses the same `[1m]` Agent SDK request policy as Fable 5 and registers with 1M context.

- **Fix: third-party Claude Code settings could make every bridge model unusable** — the bridge loaded CC's `user`/`project` filesystem settings, so an unrelated integration writing gateway-routing keys (`CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY`, `ANTHROPIC_DEFAULT_*_MODEL`) into `~/.claude/settings.json` replaced the model catalog for bridge queries too. Every Anthropic id then failed with "issue with the selected model… may not exist or you may not have access to it", regardless of the `[1m]` suffix. `settingSources` now defaults to `[]`; set `provider.settingSources` to `["user", "project"]` to opt back in.

- **Fix: models unusable through pi-ai's global dispatch** — the provider was registered only via `pi.registerProvider`, which populates the coding-agent's provider composer. Callers that use pi-ai's global dispatch instead (`completeSimple`/`stream`) resolve against pi-ai's own api registry, which never learns about extension providers, so claude-bridge models failed there with `No API provider registered for api: claude-bridge` — e.g. `/btw` from `@juicesharp/rpiv-btw`. The provider is now also registered with pi-ai's `registerApiProvider`, so both dispatch paths reach the Agent SDK.
- **Add: claude-opus-5 model** — Anthropic's Claude Opus 5 is now selectable via `/model`, and the `opus` shortcut resolves to it. Measured Agent SDK context: bare 200K, `[1m]` 1M (same as Opus 4.8), so it registers at 1M. pi-ai's bundled catalog doesn't carry opus-5 yet, so its metadata is filled from pi's remote-catalog overlay cache (`agentDir/models-store.json`) — the same source pi's own model picker uses. It appears once pi has fetched that overlay; if the cache lacks it, the model is skipped rather than registered with wrong metadata.

## 0.6.2 — 2026-07-06

- **Fix: Sonnet 5 and Fable 5 with 1M context** — bare model IDs (`claude-sonnet-5`, `claude-fable-5`) are 200K context. Must pass `[1m]` suffix for both, similar to Opus 4.8.
- **Fix: xhigh thinking level hidden for Sonnet 5 and Sonnet 4.6 (issue #32)** — pi-ai ships no `thinkingLevelMap` for these models, and pi's `getSupportedThinkingLevels` requires an explicit mapping to show `xhigh` in the picker. This is a workaround for https://github.com/earendil-works/pi/issues/6371

## 0.6.1 — 2026-07-01

- **Add: claude-fable-5 and claude-sonnet-5 models** — Anthropic's Claude Fable 5 (released 2026-06-09) and Sonnet 5 (released 2026-06-30) are now selectable via `/model`. Both force adaptive thinking. The `fable` and `sonnet` shortcuts resolve to these new models.
- **Bump: pi-ai >=0.80.3** — required for claude-fable-5 and claude-sonnet-5 model catalog entries.

## 0.6.0 — 2026-06-29

- **Fix: `/compact` hang (issue #18)** — the bridge now owns compaction for claude-bridge models, running split-turn summaries as isolated Claude Code subprocesses instead of routing them through the live provider stream. File ops (`<read-files>`/`<modified-files>`) carry forward across compactions. If compaction fails it is cancelled with a notification rather than falling back to the buggy native path.
- **Fix: subagent routing (issue #19)** — provider calls from subagents while a parent query is active now start a nested query instead of being mistaken for empty tool-result delivery.
- **Fix: session preservation across `/compact` and tree nav (issue #25)** — the main Claude Code session is no longer clobbered by shorter synthetic contexts (compact summaries) or stale post-rewrite history.
- **Add: plan-aware 1M context (issue #24)** — new `provider.plan` (default `"pro"`) and `provider.longContextExtraUsage` config. See README for which models get 1M on which plan.
- **Add: reasoning token tracking** — Claude Code `reasoning_tokens`/`thinking_tokens` are preserved on pi usage objects and in debug logs.
- **Bump: pi 0.80 APIs** — compat catalog import, `CONFIG_DIR_NAME`, compaction metadata. Claude Agent SDK 0.2.x, TypeBox 1.3, tsx 4.22.

## 0.5.0 — 2026-06-05

- **Add: claude-opus-4-8 model** — migrated pi imports/dev peers from deprecated `@mariozechner/*` packages to `@earendil-works/*` 0.78.x so the official pi-ai registry supplies Opus 4.8. The `opus` shortcut now resolves to 4.8; 4.7/4.6 remain available for explicit pinning.
- **Docs: Agent SDK quota warning** — note Anthropic's announced June 15, 2026 Agent SDK billing/quota change.
- **Tests: isolate AskClaude config** — AskClaude integration tests now use project-local test config so they are unaffected by a user's global `askClaude.enabled` setting.
- **Tests: harden shell integration tests** — use explicit alternate provider/model settings and pre-increment counters under `set -e`.

## 0.4.0 — 2026-05-04

- **Fix: Opus 4.7 + xhigh sent wrong effort to SDK** — pi-ai 0.72 ships per-model `thinkingLevelMap` overrides (e.g. `claude-opus-4-7` declares `xhigh→xhigh`, not `xhigh→max`), but our hardcoded `REASONING_TO_EFFORT` table ignored them. Effort lookup now consults `model.thinkingLevelMap` first, falls back to the table for older pi-ai or unmapped levels. Forwarded `thinkingLevelMap` through `buildModels` projection.
- **Fix: zero out model cost in `buildModels`** — per-token pricing in the footer was wrong because models inherited pi-ai's non-zero cost fields, which pi then multiplied by the huge token counts from the SDK. Now explicitly zeroed so pi's footer shows no cost.
- **Use `tools: []` instead of `disallowedTools` blocklist** — switch from blocking specific tools to explicitly passing an empty tools list, preventing any new default tools from silently leaking into bridge sessions.
- **Disable CC-side autocompact (`DISABLE_AUTO_COMPACT=1`)** — pi already owns context management and propagates its own `/compact` to CC. Letting CC autocompact too double-flushed the prompt cache and raced pi's threshold; manual `/compact` in CC is unaffected.
- **Fix: pi `/compact` no longer triggers CC autocompact-thrashing (issue #8)** — pi's compaction shrinks its messages array, but `syncSharedSession`'s REUSE check (`slice(cursor)`) silently returned `[]`, so the bridge kept `--resume`ing the pre-compact CC session JSONL. Over long sessions CC's own autocompact then refilled within 3 turns and tripped its anti-thrashing guard. Now subscribes to pi's `session_compact` event and forces the next sync down the REBUILD path so CC sees the post-compact history. Also subscribes to `session_tree` (branch nav has the same shape).
- **Refactor: split `needsRebuild` into `needsRebuild` + `forceRotate`** — only the abort case needs UUID rotation (to dodge late writes from the dying CC subprocess). Compact/tree now rebuild in place, preserving the sessionId and not leaking orphan JSONL files into `~/.claude/projects/`.
- **Block user-installed MCP servers from leaking into bridge sessions** — pass `--strict-mcp-config` unconditionally and set `ENABLE_CLAUDEAI_MCP_SERVERS=0` in the spawned CC env, suppressing both filesystem (`~/.claude.json`, `.mcp.json`) and claude.ai cloud MCP servers. Override with `provider.strictMcpConfig: false`.
- **Consolidate config** — SDK plumbing (`appendSystemPrompt`, `settingSources`, `strictMcpConfig`) moved from `~/.pi/agent/settings.json` (`claudeAgentSdkProvider` block) to a `provider` block in `~/.pi/agent/claude-bridge.json`. Old location no longer read. Drop deprecated, unsafe `maxHistoryMessages`.
- **Bump deps** — `@anthropic-ai/claude-agent-sdk` → ^0.2.126; migrate to TypeBox 1.x (new import paths per pi-mono 0.69); pi devDeps → ^0.72.1. Extract `registerTool` schemas to const with explicit `<typeof params>` generic to avoid TS2589 deep-instantiation under TypeBox 1.x.
- **Internal: move sources into `src/`** — `index.ts` and the extracted modules now live under `src/`; screenshots under `assets/`. `pi.extensions` and published `files` updated accordingly.

## 0.3.1 — 2026-04-18

- **Fix: empty thinking blocks on Opus 4.7** — Opus 4.7 silently changed default `thinking.display` from `"summarized"` to `"omitted"`, so streams emitted `thinking_start` + `signature_delta` with zero `thinking_delta` events, leaving `ThinkingBlock.thinking == ""`. Now pass `--thinking-display=summarized` via `extraArgs` whenever `effort` is set (both provider and AskClaude paths). Bump `@anthropic-ai/claude-agent-sdk` to ^0.2.111 (required for Opus 4.7 + `--thinking-display` CLI flag). See [anthropics/claude-agent-sdk-python#830](https://github.com/anthropics/claude-agent-sdk-python/pull/830).
- **Fix: `cachePct` debug metric misleading** — denominator was `input + cacheRead`, so once a conversation warmed up (tiny `input`, huge `cacheRead`) every turn rounded to 100% — even turns that rebuilt the cache from scratch. Now `cacheRead / (input + cacheRead + cacheWrite)`, so cache-rebuild turns show a low percentage.
- **Internal: extract pure modules from `index.ts`** — split `models`, `skills`, `session-verify`, `extract-tool-results`, and `query-state` into their own TS files with real unit tests (no more `.js`+`.d.ts` mirror drift). Add `typecheck` script, `typescript` + `tsx` devDeps; test scripts run via `--import tsx`.

## 0.3.0 — 2026-04-17

- **Add: claude-opus-4-7 model** — Added `claude-opus-4-7` as a selectable model. The `opus` shortcut now resolves to 4.7 by default; 4.6 remains available for explicit pinning. Bumped `@mariozechner/pi-ai` to ^0.67.6 to include official model definitions (removed fallback).
- **Refactor: QueryContext class replaces module-level state** — 12 mutable `let` variables + manual `SavedQueryState` push/pop replaced with a `QueryContext` class and context stack. Adding new per-query state is now 1 property instead of 6 edit sites. Fixes `deferredUserMessages` not being isolated across reentrant queries (subagent could consume parent's deferred steers). MCP handlers now close over captured context, abort handler captures context at the correct point after push.
- **Fix: MODELS baseUrl leak** — the MODELS array exported to pi's provider registration now projects only the fields pi needs (id/name/reasoning/input/cost/contextWindow/maxTokens), stripping pi-ai's `baseUrl`/`api`/`provider`/`headers` so they can't shadow the values `registerProvider` supplies.
- **Internal: `repairToolPairing` moved to cc-session-io 0.3.0**; convert logic extracted to `convert.js` with `convert.d.ts` types; various dead-code / type-safety cleanup.

## 0.2.0 — 2026-04-15

- **Fix: stale cursor after tool-using first turn (issue #4)** — after the first turn used tools, the session cursor pointed at the wrong message, causing Claude to re-process stale context. Now correctly advances past all tool_result blocks.
- **Fix: session resume on symlinked paths / CLAUDE_CONFIG_DIR** — cc-session-io now resolves symlinks (realpathSync + NFC) and honors `CLAUDE_CONFIG_DIR`, matching how Claude Code resolves session paths. Fixes "No conversation found" on macOS symlinked dirs. Bump cc-session-io → 0.2.0.
- **Verify-after-write for session files** — warns with diagnostic context if the written session file doesn't round-trip correctly, instead of letting Claude silently resume a corrupt session.
- **Session rebuild preserves sessionId** — provider switches no longer churn UUIDs.
- **CC CLI debug capture** — `CLAUDE_BRIDGE_DEBUG=1` now also writes Claude Code's own debug stream to `~/.pi/agent/cc-cli-logs/`, one file per query.
- **Fix: debug() logged Error objects as `{}`** — now formats with message and stack.
- **Repair orphan tool_use/tool_result pairs before import** — prevents potential API 400s when history starts mid-turn after a provider switch.

## 0.1.6 — 2026-04-10

- **Fix: steer messages during tool execution now reach Claude** — when a user sends a steer while a tool is executing, pi injects it into context alongside the tool result. The bridge previously only processed tool results in this path, silently dropping the steer. Now detected and replayed as a continuation query after the current query completes.
- **Fix: "No conversation found with session ID" in dirs with dots/underscores/spaces** — bump `cc-session-io` to 0.1.2; `projectPathToHash` now matches the CLI's sanitization (`/[^a-zA-Z0-9]/g` → `-`) instead of only replacing slashes
- **Fix: steer/followUp during tool execution no longer hangs** — `extractAllToolResults` now walks past injected user messages instead of stopping at them
- **ID-based tool result matching** — tool results are matched to MCP handlers by `toolCallId` instead of FIFO position; eliminates silent wrong-result delivery if order diverges
- Add integration tests for tool execution scenarios (normal, followUp, steer, parallel+steer, abort) with auto-restart on failure
- Add `defaultIsolated` config option for AskClaude
- Remove skill path aliasing (`.pi/` → `.claude/` round-trip); pass through real paths instead
- Rewrite skills block to reference MCP-bridged read tool (`mcp__custom-tools__read`)
- **Fix: AskClaude action summary showed raw SDK tool names** — normalize `mcp__custom-tools__*` and SDK names at creation; hide redundant `BashOutput` and recursive `AskClaude`; collapse only consecutive same-tool calls
