/**
 * Tool sets that change while a provider query is running (issue: moa-fusion's
 * enter_plan_mode adds mf_plan_subagent mid-query). Drives the real provider
 * entry point with a scripted Agent SDK query(): a fake Claude Code CLI talks
 * MCP to the real createSdkMcpServer instance the bridge builds, re-lists tools
 * on tools/list_changed after a delay, and reports them via mcpServerStatus().
 * No API calls, no extension activation.
 */
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";

const debugDir = mkdtempSync(join(tmpdir(), "live-tools-debug-"));
process.env.CLAUDE_BRIDGE_DEBUG_PATH = join(debugDir, "claude-bridge.log");
if (!process.env.LIVE_TOOLS_TEST_DEBUG) delete process.env.CLAUDE_BRIDGE_DEBUG;

const { __test } = await import("../src/index.js");
const { replaceServerTools, toolDeclarationsKey, waitForCliTools } = await import("../src/live-mcp-tools.js");

const SERVER = "custom-tools";
const PREFIX = `mcp__${SERVER}__`;
const cwd = mkdtempSync(join(tmpdir(), "live-tools-cwd-"));
const model = {
	api: "claude-bridge", provider: "claude-bridge", id: "claude-haiku-4-5",
	contextWindow: 200000, cost: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
};

const tool = (name, properties = {}) => ({
	name,
	description: `${name} tool`,
	parameters: { type: "object", properties, required: [] },
});
const READ = tool("read", { path: { type: "string" } });
const BASH = tool("bash", { command: { type: "string" } });
const EDIT = tool("edit", { path: { type: "string" } });
const WRITE = tool("write", { path: { type: "string" } });
const SUBAGENT = tool("subagent", { agent: { type: "string" }, task: { type: "string" } });
const ENTER_PLAN_MODE = tool("enter_plan_mode", { plan_prompt: { type: "string" } });
const WRITE_PLAN = tool("write_plan", { content: { type: "string" } });
const EXIT_PLAN_MODE = tool("exit_plan_mode");
const MF_PLAN_SUBAGENT = tool("mf_plan_subagent", { agent: { type: "string" }, task: { type: "string" } });

const NORMAL_TOOLS = [READ, BASH, EDIT, WRITE, SUBAGENT, ENTER_PLAN_MODE];
const PLAN_TOOLS = [READ, WRITE_PLAN, EXIT_PLAN_MODE, MF_PLAN_SUBAGENT];

// The transcript deltas pi appends when moa-fusion calls setActiveTools().
const enterPlanMode = () => ({
	role: "system",
	content: "",
	toolsRemoved: [BASH, EDIT, WRITE, SUBAGENT, ENTER_PLAN_MODE].map(({ name }) => ({ name })),
	toolsAdded: [WRITE_PLAN, EXIT_PLAN_MODE, MF_PLAN_SUBAGENT],
	timestamp: 2,
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate, label, timeoutMs = 2000) {
	const start = Date.now();
	while (!predicate()) {
		if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${label}`);
		await sleep(2);
	}
}

/** Minimal Claude Code CLI stand-in on the MCP client side of an SDK server. */
class FakeCli {
	constructor({ relistDelayMs = 30 } = {}) {
		this.relistDelayMs = relistDelayMs;
		this.nextId = 1;
		this.pending = new Map();
		this.tools = [];
		this.log = [];
		this.transport = {
			start: async () => {},
			close: async () => {},
			send: async (message) => this.receive(message),
		};
	}

	async connect(instance) {
		await instance.connect(this.transport);
		await this.request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "fake-cli", version: "0" } });
		await this.listTools();
	}

	request(method, params) {
		const id = this.nextId++;
		return new Promise((resolve) => {
			this.pending.set(id, resolve);
			this.transport.onmessage({ jsonrpc: "2.0", id, method, params });
		});
	}

	receive(message) {
		if (message.id !== undefined && this.pending.has(message.id)) {
			const resolve = this.pending.get(message.id);
			this.pending.delete(message.id);
			resolve(message);
		} else if (message.method === "notifications/tools/list_changed") {
			this.log.push("list_changed");
			// The real CLI re-lists asynchronously; delay it so a result released
			// without waiting for confirmation would visibly beat the refresh.
			setTimeout(() => void this.listTools(), this.relistDelayMs);
		}
	}

	async listTools() {
		const response = await this.request("tools/list", {});
		this.tools = response.result.tools.map((t) => t.name);
		this.log.push(`listed:${this.tools.join(",")}`);
	}

	/** tools/call; resolves with the result text and the tools CC had when it arrived. */
	async callTool(name, args = {}) {
		const response = await this.request("tools/call", { name, arguments: args });
		this.log.push(`result:${name}`);
		return { text: response.result.content.map((block) => block.text).join(""), isError: response.result.isError, toolsAtResult: [...this.tools] };
	}
}

// Every fake query a test started, so a failed test cannot leave the provider's
// module-level query state busy for the next one.
const startedQueries = [];

/** Scripted stand-in for the Agent SDK's query(). */
function installFakeQuery(cliOptions) {
	const queries = [];
	__test.setQuery(({ options }) => {
		const cli = new FakeCli(cliOptions);
		const buffered = [];
		let waiting = null;
		let ended = false;
		const fake = {
			options,
			cli,
			statusCalls: 0,
			ready: cli.connect(options.mcpServers[SERVER].instance),
			push(message) {
				if (waiting) {
					const resolve = waiting;
					waiting = null;
					resolve({ value: message, done: false });
				} else buffered.push(message);
			},
			end() {
				ended = true;
				if (waiting) {
					waiting({ value: undefined, done: true });
					waiting = null;
				}
			},
			next() {
				if (buffered.length) return Promise.resolve({ value: buffered.shift(), done: false });
				if (ended) return Promise.resolve({ value: undefined, done: true });
				return new Promise((resolve) => { waiting = resolve; });
			},
			return() {
				fake.end();
				return Promise.resolve({ value: undefined, done: true });
			},
			[Symbol.asyncIterator]() { return fake; },
			async interrupt() {},
			close() { fake.end(); },
			async mcpServerStatus() {
				fake.statusCalls++;
				return [{ name: SERVER, status: "connected", tools: cli.tools.map((name) => ({ name: `${PREFIX}${name}` })) }];
			},
		};
		queries.push(fake);
		startedQueries.push(fake);
		return fake;
	});
	return queries;
}

const streamEvent = (event) => ({ type: "stream_event", event });

function toolUseTurn(calls) {
	const events = [streamEvent({ type: "message_start", message: { usage: { input_tokens: 1 } } })];
	calls.forEach(({ id, name, input }, index) => {
		events.push(streamEvent({ type: "content_block_start", index, content_block: { type: "tool_use", id, name: `${PREFIX}${name}`, input: {} } }));
		events.push(streamEvent({ type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: JSON.stringify(input) } }));
		events.push(streamEvent({ type: "content_block_stop", index }));
	});
	events.push(streamEvent({ type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 1 } }));
	events.push(streamEvent({ type: "message_stop" }));
	return events;
}

function textTurn(text) {
	return [
		streamEvent({ type: "message_start", message: { usage: { input_tokens: 1 } } }),
		streamEvent({ type: "content_block_start", index: 0, content_block: { type: "text" } }),
		streamEvent({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } }),
		streamEvent({ type: "content_block_stop", index: 0 }),
		streamEvent({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } }),
		streamEvent({ type: "message_stop" }),
		{ type: "result", subtype: "success", result: text },
	];
}

async function collect(stream) {
	const events = [];
	for await (const event of stream) events.push(event);
	return events;
}

function assistantToolCalls(calls) {
	return {
		role: "assistant",
		content: calls.map(({ id, name, input }) => ({ type: "toolCall", id, name, arguments: input })),
		api: model.api, provider: model.provider, model: model.id, stopReason: "toolUse", timestamp: 3,
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
	};
}

const toolResult = (id, toolName, text) => ({
	role: "toolResult", toolCallId: id, toolName, content: [{ type: "text", text }], isError: false, timestamp: 4,
});

const toolCallNames = (events) => events.filter((e) => e.type === "toolcall_end").map((e) => e.toolCall.name);

/** Starts a prompt on the normal loadout and plays back one tool-use turn. */
async function startPrompt(queries, calls) {
	const context = { messages: [
		{ role: "system", content: "system prompt", toolsAdded: NORMAL_TOOLS, timestamp: 0 },
		{ role: "user", content: "Enter plan mode, then explore.", timestamp: 1 },
	] };
	const stream = __test.streamClaudeAgentSdk(model, context, { cwd });
	assert.equal(queries.length, 1);
	const sdk = queries[0];
	await sdk.ready;
	for (const message of toolUseTurn(calls)) sdk.push(message);
	const events = await collect(stream);
	return { context, sdk, events };
}

async function finishPrompt(sdk, stream) {
	for (const message of textTurn("done")) sdk.push(message);
	// The provider finalizes the stream once the SDK generator is exhausted.
	sdk.end();
	const events = await collect(stream);
	assert.equal(events.at(-1).type, "done");
	assert.equal(events.at(-1).reason, "stop");
	// Let the provider's completion handlers run before the next test reuses state.
	await sleep(10);
}

afterEach(async () => {
	for (const fake of startedQueries.splice(0)) fake.end();
	await sleep(20);
	__test.setQuery();
	__test.resetSharedSession();
});

describe("tools added mid-query (enter_plan_mode → mf_plan_subagent)", () => {
	it("declares the plan-mode tools to the live query before the next model request", async () => {
		const queries = installFakeQuery();
		const call1 = { id: "call-1", name: "enter_plan_mode", input: { plan_prompt: "smoke test" } };
		const { context, sdk, events } = await startPrompt(queries, [call1]);

		assert.deepEqual(sdk.cli.tools, NORMAL_TOOLS.map((t) => t.name));
		assert.ok(!Object.hasOwn(sdk.options, "resume"), "first prompt starts a new session");
		assert.deepEqual(toolCallNames(events), ["enter_plan_mode"]);
		assert.equal(events.at(-1).reason, "toolUse");

		// CC calls the tool; the handler waits for pi's result.
		const call1Result = sdk.cli.callTool("enter_plan_mode", call1.input);

		// pi ran enter_plan_mode, which swapped the active tools, and delivers its result.
		const context2 = { messages: [...context.messages, assistantToolCalls([call1]), enterPlanMode(), toolResult("call-1", "enter_plan_mode", "Plan mode enabled")] };
		const stream2 = __test.streamClaudeAgentSdk(model, context2, { cwd });
		assert.equal(queries.length, 1, "tool results continue the running query instead of starting a new one");

		const delivered = await call1Result;
		assert.equal(delivered.text, "Plan mode enabled");
		assert.deepEqual(delivered.toolsAtResult, PLAN_TOOLS.map((t) => t.name), "CC had the plan-mode tools before it got the result back");
		assert.deepEqual(sdk.cli.log, [
			`listed:${NORMAL_TOOLS.map((t) => t.name).join(",")}`,
			"list_changed",
			`listed:${PLAN_TOOLS.map((t) => t.name).join(",")}`,
			"result:enter_plan_mode",
		]);

		// The model's next turn calls mf_plan_subagent: pi sees its own tool name...
		const call2 = { id: "call-2", name: "mf_plan_subagent", input: { agent: "moa-explore", task: "List agents/." } };
		for (const message of toolUseTurn([call2])) sdk.push(message);
		const events2 = await collect(stream2);
		assert.deepEqual(toolCallNames(events2), ["mf_plan_subagent"]);
		assert.deepEqual(events2.find((e) => e.type === "toolcall_end").toolCall.arguments, call2.input);

		// ...and CC can call it on the live server; the result pairs back by id.
		const call2Result = sdk.cli.callTool("mf_plan_subagent", call2.input);
		const context3 = { messages: [...context2.messages, assistantToolCalls([call2]), toolResult("call-2", "mf_plan_subagent", "alpha.md beta.md")] };
		const stream3 = __test.streamClaudeAgentSdk(model, context3, { cwd });
		const explored = await call2Result;
		assert.equal(explored.text, "alpha.md beta.md");
		assert.notEqual(explored.isError, true);
		assert.equal(queries.length, 1);

		await finishPrompt(sdk, stream3);
	});

	it("keeps a removed tool callable until CC has looked it up (result delivered before tools/call)", async () => {
		const queries = installFakeQuery();
		const call1 = { id: "call-1", name: "enter_plan_mode", input: { plan_prompt: "smoke test" } };
		const { context, sdk } = await startPrompt(queries, [call1]);

		// pi's result arrives before CC has issued tools/call, so it is queued.
		const context2 = { messages: [...context.messages, assistantToolCalls([call1]), enterPlanMode(), toolResult("call-1", "enter_plan_mode", "Plan mode enabled")] };
		const stream2 = __test.streamClaudeAgentSdk(model, context2, { cwd });
		await sleep(10);
		assert.equal(sdk.cli.log.includes("list_changed"), false, "the swap waits for CC's lookup of enter_plan_mode");

		// enter_plan_mode is not in the plan loadout, but this call must still find it.
		const delivered = await sdk.cli.callTool("enter_plan_mode", call1.input);
		assert.equal(delivered.text, "Plan mode enabled");
		assert.notEqual(delivered.isError, true);
		assert.deepEqual(delivered.toolsAtResult, PLAN_TOOLS.map((t) => t.name));

		await finishPrompt(sdk, stream2);
	});

	it("releases earlier results at once and holds only the turn's last one", async () => {
		const queries = installFakeQuery();
		const call1 = { id: "call-1", name: "enter_plan_mode", input: { plan_prompt: "smoke test" } };
		const call2 = { id: "call-2", name: "read", input: { path: "agents" } };
		const { context, sdk, events } = await startPrompt(queries, [call1, call2]);
		assert.deepEqual(toolCallNames(events), ["enter_plan_mode", "read"]);

		const results = [sdk.cli.callTool("enter_plan_mode", call1.input), sdk.cli.callTool("read", call2.input)];
		const context2 = { messages: [
			...context.messages, assistantToolCalls([call1, call2]), enterPlanMode(),
			toolResult("call-1", "enter_plan_mode", "Plan mode enabled"), toolResult("call-2", "read", "alpha.md"),
		] };
		const stream2 = __test.streamClaudeAgentSdk(model, context2, { cwd });
		const [first, last] = await Promise.all(results);
		assert.deepEqual([first.text, last.text], ["Plan mode enabled", "alpha.md"]);
		assert.deepEqual(first.toolsAtResult, NORMAL_TOOLS.map((t) => t.name), "the first result is not delayed");
		assert.deepEqual(last.toolsAtResult, PLAN_TOOLS.map((t) => t.name), "the last result waits for CC's refresh");

		await finishPrompt(sdk, stream2);
	});

	it("leaves an unchanged tool set alone", async () => {
		const queries = installFakeQuery();
		const call1 = { id: "call-1", name: "read", input: { path: "README.md" } };
		const { context, sdk } = await startPrompt(queries, [call1]);

		const result = sdk.cli.callTool("read", call1.input);
		const context2 = { messages: [...context.messages, assistantToolCalls([call1]), toolResult("call-1", "read", "# repro")] };
		const stream2 = __test.streamClaudeAgentSdk(model, context2, { cwd });
		assert.equal((await result).text, "# repro");
		assert.equal(sdk.statusCalls, 0);
		assert.equal(sdk.cli.log.includes("list_changed"), false);

		await finishPrompt(sdk, stream2);
	});
});

describe("live-mcp-tools", () => {
	const serverWith = (names, handler = async () => ({ content: [{ type: "text", text: "ok" }] })) =>
		createSdkMcpServer({ name: SERVER, version: "1.0.0", tools: names.map((name) => ({ name, description: name, inputSchema: {}, handler })) });

	it("swaps the tools of a connected SDK server and notifies the client", async () => {
		const live = serverWith(["read", "bash"]);
		const cli = new FakeCli({ relistDelayMs: 0 });
		await cli.connect(live.instance);
		const listed = replaceServerTools(live, serverWith(["read", "mf_plan_subagent"], async () => ({ content: [{ type: "text", text: "new handler" }] })));
		assert.deepEqual(listed, ["read", "mf_plan_subagent"]);
		await waitFor(() => cli.tools.includes("mf_plan_subagent"), "re-list");
		assert.deepEqual(cli.tools, ["read", "mf_plan_subagent"]);
		assert.equal((await cli.callTool("mf_plan_subagent")).text, "new handler");
		const removed = await cli.callTool("bash");
		assert.equal(removed.isError, true);
	});

	it("keys tool sets by their model-facing declarations", () => {
		assert.equal(toolDeclarationsKey([READ, BASH]), toolDeclarationsKey([{ ...READ, execute: () => {} }, { ...BASH }]));
		assert.notEqual(toolDeclarationsKey([READ, BASH]), toolDeclarationsKey([READ]));
		assert.notEqual(toolDeclarationsKey([READ]), toolDeclarationsKey([{ ...READ, description: "changed" }]));
	});

	it("confirms bare or prefixed names, and reports timeouts and failures", async () => {
		const status = (names) => ({ mcpServerStatus: async () => [{ name: SERVER, status: "connected", tools: names.map((name) => ({ name })) }] });
		assert.equal((await waitForCliTools(status(["read", "mf_plan_subagent"]), SERVER, ["mf_plan_subagent", "read"])).status, "confirmed");
		assert.equal((await waitForCliTools(status([`${PREFIX}read`]), SERVER, ["read"])).status, "confirmed");
		const timeout = await waitForCliTools(status(["read", "bash"]), SERVER, ["read"], { timeoutMs: 30, intervalMs: 5 });
		assert.equal(timeout.status, "timeout");
		assert.deepEqual(timeout.seen, ["read", "bash"]);
		const closed = await waitForCliTools({ mcpServerStatus: async () => { throw new Error("Query closed before response received"); } }, SERVER, ["read"]);
		assert.equal(closed.status, "unavailable");
		assert.equal((await waitForCliTools(null, SERVER, ["read"])).status, "unavailable");
	});
});
