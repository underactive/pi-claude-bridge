/**
 * Tests for the SDK-message → pi-stream state machine (consumeQuery,
 * processStreamEvent, processAssistantMessage, updateUsage) driven by
 * scripted SDK messages. No API calls, no extension activation.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const debugDir = mkdtempSync(join(tmpdir(), "stream-events-debug-"));
process.env.CLAUDE_BRIDGE_DEBUG_PATH = join(debugDir, "claude-bridge.log");

const { __test } = await import("../src/index.js");
const { QueryContext } = await import("../src/query-state.js");

const model = {
	api: "anthropic", provider: "anthropic", id: "test-model",
	contextWindow: 200000,
	cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
};

function makeContext() {
	const events = [];
	let ended = false;
	const c = new QueryContext();
	c.currentPiStream = { push: (e) => events.push(e), end: () => { ended = true; } };
	c.resetTurnState(model);
	return { c, events, isEnded: () => ended };
}

async function* scripted(messages) {
	for (const m of messages) yield m;
}

const streamEvent = (event) => ({ type: "stream_event", event });

const run = (messages, c) =>
	__test.consumeQuery(scripted(messages), new Map(), model, () => false, c);

describe("consumeQuery tool_use turn", () => {
	const messages = [
		streamEvent({ type: "message_start", message: { usage: { input_tokens: 10, cache_read_input_tokens: 4 } } }),
		streamEvent({ type: "content_block_start", index: 0, content_block: { type: "thinking" } }),
		streamEvent({ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "hmm" } }),
		streamEvent({ type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig-" } }),
		streamEvent({ type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "nature" } }),
		streamEvent({ type: "content_block_stop", index: 0 }),
		streamEvent({ type: "content_block_start", index: 1, content_block: { type: "text" } }),
		streamEvent({ type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "hello" } }),
		streamEvent({ type: "content_block_stop", index: 1 }),
		streamEvent({ type: "content_block_start", index: 2, content_block: { type: "tool_use", id: "tool-1", name: "custom_tool", input: {} } }),
		streamEvent({ type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: "{\"a\":" } }),
		streamEvent({ type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: "1}" } }),
		streamEvent({ type: "content_block_stop", index: 2 }),
		streamEvent({
			type: "message_delta",
			delta: { stop_reason: "tool_use" },
			usage: { output_tokens: 5, cache_creation_input_tokens: 100, cache_creation: { ephemeral_1h_input_tokens: 500 } },
		}),
		streamEvent({ type: "message_stop" }),
		{ type: "result", subtype: "success", result: "ignored" },
	];

	it("emits the expected pi events and ends the stream on tool_use", async () => {
		const { c, events, isEnded } = makeContext();
		await run(messages, c);

		assert.deepStrictEqual(events.map((e) => e.type), [
			"start",
			"thinking_start", "thinking_delta", "thinking_end",
			"text_start", "text_delta", "text_end",
			"toolcall_start", "toolcall_delta", "toolcall_delta", "toolcall_end",
			"done",
		]);
		assert.strictEqual(events.at(-1).reason, "toolUse");
		assert.strictEqual(c.turnOutput.stopReason, "toolUse");
		assert.ok(isEnded());
		assert.strictEqual(c.currentPiStream, null);
		assert.deepStrictEqual(c.turnToolCallIds, ["tool-1"]);
	});

	it("accumulates thinking signature and finalizes tool call arguments", async () => {
		const { c } = makeContext();
		await run(messages, c);

		const [thinking, text, toolCall] = c.turnOutput.content;
		assert.strictEqual(thinking.thinking, "hmm");
		assert.strictEqual(thinking.thinkingSignature, "sig-nature");
		assert.strictEqual(text.text, "hello");
		assert.strictEqual(toolCall.name, "custom_tool");
		assert.deepStrictEqual(toolCall.arguments, { a: 1 });
		assert.ok(!("partialJson" in toolCall));
	});

	it("maps usage from message_start and message_delta, clamping cacheWrite1h", async () => {
		const { c } = makeContext();
		await run(messages, c);

		const usage = c.turnOutput.usage;
		assert.strictEqual(usage.input, 10);
		assert.strictEqual(usage.output, 5);
		assert.strictEqual(usage.cacheRead, 4);
		assert.strictEqual(usage.cacheWrite, 100);
		assert.strictEqual(usage.cacheWrite1h, 100);
		assert.strictEqual(usage.totalTokens, 119);
	});
});

describe("consumeQuery result handling", () => {
	it("sets errorMessage and stopReason for a non-success result subtype", async () => {
		const { c } = makeContext();
		await run([
			streamEvent({ type: "message_start", message: { usage: { input_tokens: 1 } } }),
			{ type: "result", subtype: "error_max_turns", errors: ["too many turns"] },
		], c);

		assert.strictEqual(c.turnOutput.stopReason, "error");
		assert.strictEqual(c.turnOutput.errorMessage, "too many turns");
	});

	it("emits the result text when no stream events were seen", async () => {
		const { c, events } = makeContext();
		await run([{ type: "result", subtype: "success", result: "final answer" }], c);

		assert.deepStrictEqual(events.map((e) => e.type), ["start", "text_start", "text_delta", "text_end"]);
		assert.strictEqual(c.turnOutput.content[0].text, "final answer");
		assert.strictEqual(c.turnOutput.errorMessage, undefined);
	});

	it("captures the session id from the init system message", async () => {
		const { c } = makeContext();
		const { capturedSessionId } = await run([{ type: "system", subtype: "init", session_id: "abc-123" }], c);
		assert.strictEqual(capturedSessionId, "abc-123");
	});
});

describe("stop reason mapping", () => {
	it("maps max_tokens to length", () => {
		const { c } = makeContext();
		__test.processStreamEvent(
			streamEvent({ type: "message_delta", delta: { stop_reason: "max_tokens" } }),
			new Map(), model, c,
		);
		assert.strictEqual(c.turnOutput.stopReason, "length");
	});

	it("maps end_turn to stop", () => {
		const { c } = makeContext();
		__test.processStreamEvent(
			streamEvent({ type: "message_delta", delta: { stop_reason: "end_turn" } }),
			new Map(), model, c,
		);
		assert.strictEqual(c.turnOutput.stopReason, "stop");
	});
});

describe("processAssistantMessage fallback", () => {
	it("emits blocks and ends the stream on tool_use when no stream events arrived", () => {
		const { c, events, isEnded } = makeContext();
		__test.processAssistantMessage({
			type: "assistant",
			message: {
				content: [
					{ type: "text", text: "hi" },
					{ type: "tool_use", id: "tool-2", name: "custom_tool", input: { b: 2 } },
				],
				usage: { input_tokens: 3, output_tokens: 2 },
			},
		}, model, new Map(), c);

		assert.deepStrictEqual(events.map((e) => e.type), [
			"start", "text_start", "text_delta", "text_end",
			"toolcall_start", "toolcall_end", "done",
		]);
		assert.strictEqual(events.at(-1).reason, "toolUse");
		assert.strictEqual(c.turnOutput.usage.input, 3);
		assert.deepStrictEqual(c.turnOutput.content[1].arguments, { b: 2 });
		assert.ok(isEnded());
	});

	it("is a no-op after stream events were seen", () => {
		const { c, events } = makeContext();
		c.turnSawStreamEvent = true;
		__test.processAssistantMessage({
			type: "assistant",
			message: { content: [{ type: "text", text: "dup" }] },
		}, model, new Map(), c);
		assert.strictEqual(events.length, 0);
	});
});

describe("updateUsage", () => {
	it("clamps cacheWrite1h to cacheWrite", () => {
		const { c } = makeContext();
		__test.updateUsage(c.turnOutput, {
			cache_creation_input_tokens: 50,
			cache_creation: { ephemeral_1h_input_tokens: 80 },
		}, model);
		assert.strictEqual(c.turnOutput.usage.cacheWrite1h, 50);
	});

	it("leaves cacheWrite1h unset when the split is absent", () => {
		const { c } = makeContext();
		__test.updateUsage(c.turnOutput, { input_tokens: 1 }, model);
		assert.strictEqual(c.turnOutput.usage.cacheWrite1h, undefined);
	});
});

after(() => {
	rmSync(debugDir, { recursive: true, force: true });
});
