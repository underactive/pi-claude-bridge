import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatToolAction, buildActionSummary, shortPath } from "../src/askclaude-ui.js";

const cwd = "/work/proj";

describe("formatToolAction", () => {
	it("shows Read path relative to cwd", () => {
		const out = formatToolAction({ name: "Read", status: "", rawInput: { file_path: "/work/proj/src/a.ts" } }, cwd);
		assert.equal(out, "Read(src/a.ts)");
	});

	it("keeps the last two segments for deep absolute paths outside cwd", () => {
		assert.equal(shortPath("/other/a/b/c.ts", cwd), "b/c.ts");
	});

	it("truncates Bash commands at 80 chars", () => {
		const command = "x".repeat(120);
		const out = formatToolAction({ name: "Bash", status: "", rawInput: { command } }, cwd);
		assert.equal(out, `Bash(${"x".repeat(80)})`);
	});

	it("returns undefined for BashOutput", () => {
		assert.equal(formatToolAction({ name: "BashOutput", status: "", rawInput: {} }, cwd), undefined);
	});

	it("TodoWrite prefers in_progress over pending", () => {
		const todos = [
			{ content: "first", status: "pending" },
			{ content: "second", status: "in_progress" },
		];
		assert.equal(formatToolAction({ name: "TodoWrite", status: "", rawInput: { todos } }, cwd), "second");
	});

	it("TodoWrite with no todos returns undefined", () => {
		assert.equal(formatToolAction({ name: "TodoWrite", status: "", rawInput: {} }, cwd), undefined);
	});
});

describe("buildActionSummary", () => {
	it("collapses consecutive same-verb calls keeping the latest", () => {
		const calls = new Map([
			["1", { name: "Read", status: "", rawInput: { file_path: "/work/proj/a.ts" } }],
			["2", { name: "Read", status: "", rawInput: { file_path: "/work/proj/b.ts" } }],
			["3", { name: "Grep", status: "", rawInput: { pattern: "foo" } }],
			["4", { name: "Read", status: "", rawInput: { file_path: "/work/proj/c.ts" } }],
		]);
		const out = buildActionSummary(calls);
		assert.equal(out.split("; ").length, 3);
		assert.match(out, /^Read\(.*b\.ts\); Grep\(foo\); Read\(.*c\.ts\)$/);
	});

	it("omits AskClaude", () => {
		const calls = new Map([
			["1", { name: "AskClaude", status: "", rawInput: {} }],
			["2", { name: "Grep", status: "", rawInput: { pattern: "foo" } }],
		]);
		assert.equal(buildActionSummary(calls), "Grep(foo)");
	});
});
