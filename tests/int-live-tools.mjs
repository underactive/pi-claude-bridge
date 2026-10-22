#!/usr/bin/env node
// Integration test: a tool call that changes pi's active tools (the way
// moa-fusion's enter_plan_mode does) must take effect on the very next model
// request of the same Claude Code query: added tools become callable, removed
// ones stop being offered. Needs working Claude Bridge credentials, so run it
// outside a sandbox. Unit coverage with a scripted SDK: unit-live-tools.mjs.

import { describe, it, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRpcHarness } from "./lib/rpc-harness.mjs";

const TEST_TIMEOUT = 90_000;
const PALETTE_COLOR = "periwinkle-4817";

const harness = createRpcHarness({
	name: "live-tools",
	args: ["-e", "./tests/fixtures/tool-switch-extension.ts", "--model", "claude-bridge/claude-haiku-4-5"],
	defaultTimeout: TEST_TIMEOUT,
});

/** Runs one prompt and records every finished tool execution. */
async function promptRecordingTools(message) {
	const executions = [];
	const remove = harness.addListener((msg) => {
		if (msg.type === "tool_execution_end") executions.push({ toolName: msg.toolName, isError: msg.isError });
	});
	try {
		const text = await harness.promptAndWait(message);
		return { text, executions };
	} finally {
		remove();
	}
}

function syncLines() {
	return readFileSync(harness.DEBUG_LOG, "utf8").split("\n").filter((line) => line.includes("tool-sync: confirmed"));
}

describe("live tool-set changes", () => {
	before(async () => {
		await harness.startAndWait();
	});

	afterEach(async () => {
		await harness.stop();
		await harness.startAndWait();
	});

	after(async () => {
		await harness.stop();
		console.log(`  RPC log: ${harness.RPC_LOG}`);
		console.log(`  Debug log: ${harness.DEBUG_LOG}`);
	});

	it("a tool activated by a tool call is callable on the next turn", { timeout: TEST_TIMEOUT }, async () => {
		const { text, executions } = await promptRecordingTools(
			"Call EnablePalette. Then call PaletteTool and reply with exactly the color it returns, nothing else.",
		);
		assert.deepEqual(executions.find((e) => e.toolName === "EnablePalette"), { toolName: "EnablePalette", isError: false });
		assert.deepEqual(executions.find((e) => e.toolName === "PaletteTool"), { toolName: "PaletteTool", isError: false });
		assert.match(text, new RegExp(PALETTE_COLOR));

		const confirmed = syncLines();
		assert.equal(confirmed.length, 1, "the live query confirmed the new tool set once");
		assert.match(confirmed[0], /PaletteTool/);
		assert.doesNotMatch(confirmed[0], /[[,]bash[,\]]/);
		const freshQueries = readFileSync(harness.DEBUG_LOG, "utf8").split("\n").filter((line) => line.includes("provider: fresh query model="));
		assert.equal(freshQueries.length, 1, "the change applied inside the running query, without a new one");
	});

	it("a tool deactivated by a tool call cannot run on the next turn", { timeout: TEST_TIMEOUT }, async () => {
		const { executions } = await promptRecordingTools(
			"Call EnablePalette. After it returns, try to run `echo bash-ran` with the bash tool, then say whether it worked.",
		);
		assert.deepEqual(executions.find((e) => e.toolName === "EnablePalette"), { toolName: "EnablePalette", isError: false });
		assert.ok(
			!executions.some((e) => e.toolName === "bash" && !e.isError),
			`bash ran after it was deactivated: ${JSON.stringify(executions)}`,
		);
		assert.equal(syncLines().length, 1);
	});
});
