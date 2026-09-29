// Query state: QueryContext class + top-level context.
//
// All per-query and per-turn mutable state lives here. Reentrant queries
// (subagents) get a fresh QueryContext tracked in index.ts's activeQueryContexts;
// ctx() is the top-level context only.
// Adding a new field = one property on the class.
//
// Extracted from index.ts so tests can import without activating the extension.

import type { ContentBlockParam } from "@anthropic-ai/sdk/resources";
import type { AssistantMessage, AssistantMessageEventStream, Model } from "@earendil-works/pi-ai";
import type { McpResult } from "./extract-tool-results.js";

export interface PendingToolCall {
	toolName: string;
	resolve: (result: McpResult) => void;
}

export function emptyAssistantMessage(model: Model<any>): AssistantMessage {
	return {
		role: "assistant", content: [],
		api: model.api, provider: model.provider, model: model.id,
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
		stopReason: "stop", timestamp: Date.now(),
	};
}

export class QueryContext {
	// Query-scoped (fully isolated per query)
	activeQuery: object | null = null;
	currentPiStream: AssistantMessageEventStream | null = null;
	latestCursor = 0;
	pendingToolCalls = new Map<string, PendingToolCall>();
	pendingResults = new Map<string, McpResult>();
	turnToolCallIds: string[] = [];
	nextHandlerIdx = 0;
	deferredUserMessages: ContentBlockParam[][] = [];
	// Running sum of finalized turn costs (usage.cost.total). Debug-only: compared
	// against the SDK's own total_cost_usd in the result cross-check log.
	queryCostEstimate = 0;

	// Per-turn (reset together)
	turnOutput: AssistantMessage | null = null;
	turnStarted = false;
	turnSawStreamEvent = false;
	turnSawToolCall = false;

	get turnBlocks(): Array<any> {
		if (!this.turnOutput) throw new Error("turnBlocks accessed before resetTurnState");
		return this.turnOutput.content;
	}

	resetTurnState(model: Model<any>): void {
		this.turnOutput = emptyAssistantMessage(model);
		this.turnStarted = false;
		this.turnSawStreamEvent = false;
		this.turnSawToolCall = false;
		// turnToolCallIds and nextHandlerIdx are NOT reset — they persist across
		// tool-result delivery callbacks within the same assistant message.
	}
}

let _ctx = new QueryContext();

export function ctx(): QueryContext { return _ctx; }

// Test-only: drop all state so test files can start from a clean module.
// Not called from production.
export function resetStack(): void {
	_ctx = new QueryContext();
}
