/**
 * Regression tests for syncSharedSession's session reuse decisions.
 */
import { describe, it, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { getSessionPath } from "cc-session-io";

const debugDir = mkdtempSync(join(tmpdir(), "sync-shared-session-debug-"));
const claudeDir = mkdtempSync(join(tmpdir(), "sync-claude-dir-"));
process.env.CLAUDE_BRIDGE_DEBUG_PATH = join(debugDir, "claude-bridge.log");
process.env.CLAUDE_CONFIG_DIR = claudeDir;

const { __test } = await import("../src/index.js");

describe("syncSharedSession", () => {
	after(() => {
		rmSync(debugDir, { recursive: true, force: true });
		rmSync(claudeDir, { recursive: true, force: true });
		delete process.env.CLAUDE_CONFIG_DIR;
	});

	afterEach(() => {
		__test.resetSharedSession();
	});

	it("treats Pi 0.86 transcript system messages as metadata, not resumable history", () => {
		const cwd = mkdtempSync(join(tmpdir(), "sync-shared-session-"));
		try {
			const result = __test.syncSharedSession([
				{
					role: "system",
					content: "system prompt",
					toolsAdded: [],
					timestamp: Date.now(),
				},
				{
					role: "user",
					content: "First turn",
					timestamp: Date.now(),
				},
			], cwd);

			assert.equal(result.sessionId, null, "a first turn must start clean instead of resuming a phantom session");
			assert.equal(__test.getSharedSession(), null, "system metadata must not create shared session state");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("does not reuse a cached main session for a shorter synthetic compact context", () => {
		const cwd = mkdtempSync(join(tmpdir(), "sync-shared-session-"));
		try {
			const mainSession = {
				sessionId: "11111111-1111-4111-8111-111111111111",
				cursor: 42,
				cwd,
			};
			__test.setSharedSession(mainSession);

			const result = __test.syncSharedSession([
				{
					role: "user",
					content: "Summarize this conversation.",
					timestamp: Date.now(),
				},
			], cwd);

			assert.equal(
				result.sessionId,
				null,
				"synthetic compact contexts have no prior messages and must start a fresh Claude Code session instead of resuming the main session",
			);
			assert.equal(
				result.preserveSharedSession,
				true,
				"the fresh synthetic Claude Code session must not replace the cached main session when it completes",
			);
			assert.deepEqual(__test.getSharedSession(), mainSession);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	const user = (content) => ({ role: "user", content, timestamp: Date.now() });
	const assistant = (text) => ({
		role: "assistant",
		content: [{ type: "text", text }],
		provider: "claude-bridge",
		timestamp: Date.now(),
	});

	it("advances the cursor past a single trailing assistant message and reuses the session", () => {
		const cwd = mkdtempSync(join(tmpdir(), "sync-shared-session-"));
		try {
			const sessionId = "22222222-2222-4222-8222-222222222222";
			__test.setSharedSession({ sessionId, cursor: 3, cwd });

			const result = __test.syncSharedSession([
				user("one"), assistant("a1"), user("two"), assistant("a2"), user("three"),
			], cwd);

			assert.deepEqual(result, { sessionId });
			assert.equal(__test.getSharedSession().cursor, 4);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("rebuilds in place with the same sessionId when needsRebuild is set", () => {
		const cwd = mkdtempSync(join(tmpdir(), "sync-shared-session-"));
		try {
			const messages = [user("one"), assistant("a1"), user("two")];
			const first = __test.syncSharedSession(messages, cwd);
			assert.ok(first.sessionId, "first sync should build a session");

			__test.setSharedSession({ ...__test.getSharedSession(), needsRebuild: true });
			const second = __test.syncSharedSession(messages, cwd);

			assert.equal(second.sessionId, first.sessionId);
			assert.ok(existsSync(getSessionPath(second.sessionId, cwd, claudeDir)));
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("rotates the sessionId when forceRotate is set", () => {
		const cwd = mkdtempSync(join(tmpdir(), "sync-shared-session-"));
		try {
			const messages = [user("one"), assistant("a1"), user("two")];
			const first = __test.syncSharedSession(messages, cwd);
			assert.ok(first.sessionId, "first sync should build a session");

			__test.setSharedSession({ ...__test.getSharedSession(), needsRebuild: true, forceRotate: true });
			const second = __test.syncSharedSession(messages, cwd);

			assert.ok(second.sessionId);
			assert.notEqual(second.sessionId, first.sessionId);
			assert.ok(existsSync(getSessionPath(second.sessionId, cwd, claudeDir)));
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("starts clean when prior history converts to no session records", () => {
		const cwd = mkdtempSync(join(tmpdir(), "sync-shared-session-"));
		try {
			const unconvertible = { role: "custom", content: "ignored", timestamp: Date.now() };

			const result = __test.syncSharedSession([unconvertible, user("next")], cwd);

			assert.deepEqual(result, { sessionId: null });
			assert.equal(__test.getSharedSession(), null);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});
