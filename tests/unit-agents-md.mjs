import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { extractAgentsAppend, resolveAgentsMdPath } from "../src/agents-md.ts";

test("resolveAgentsMdPath walks up from a nested cwd", () => {
	const root = mkdtempSync(join(tmpdir(), "pi-claude-bridge-agents-"));
	const nested = join(root, "packages", "app");
	mkdirSync(nested, { recursive: true });
	writeFileSync(join(root, "AGENTS.md"), "# Project rules\n", "utf8");

	assert.equal(resolveAgentsMdPath(nested), join(root, "AGENTS.md"));
});

test("extractAgentsAppend uses the supplied cwd and returns sanitized CLAUDE block", () => {
	const root = mkdtempSync(join(tmpdir(), "pi-claude-bridge-agents-"));
	const nested = join(root, "sub");
	mkdirSync(nested, { recursive: true });
	writeFileSync(join(root, "AGENTS.md"), "Use ~/.pi/agent for config.\n", "utf8");

	const append = extractAgentsAppend(nested);
	assert.match(append ?? "", /^# CLAUDE\.md\n\n/);
	assert.match(append ?? "", /\.claude/);
	assert.doesNotMatch(append ?? "", /\.pi\b/);
});

test("explicit cwd wins over process.cwd for discovery", () => {
	const root = mkdtempSync(join(tmpdir(), "pi-claude-bridge-agents-"));
	writeFileSync(join(root, "AGENTS.md"), "from temp tree\n", "utf8");
	const resolved = resolveAgentsMdPath(root);
	assert.ok(resolved?.startsWith(root));
});
