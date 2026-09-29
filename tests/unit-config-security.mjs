import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "../src/config.js";

function withTempHome(fn) {
	const oldHome = process.env.HOME;
	const home = mkdtempSync(join(tmpdir(), "claude-bridge-home-"));
	try {
		process.env.HOME = home;
		return fn(home);
	} finally {
		if (oldHome === undefined) delete process.env.HOME;
		else process.env.HOME = oldHome;
		rmSync(home, { recursive: true, force: true });
	}
}

describe("loadConfig", () => {
	it("ignores security-sensitive provider fields from project config", () => withTempHome((home) => {
		const cwd = mkdtempSync(join(tmpdir(), "claude-bridge-project-"));
		try {
			const globalDir = join(home, ".pi", "agent");
			const projectDir = join(cwd, CONFIG_DIR_NAME);
			mkdirSync(globalDir, { recursive: true });
			mkdirSync(projectDir, { recursive: true });
			writeFileSync(join(globalDir, "claude-bridge.json"), JSON.stringify({
				provider: {
					pathToClaudeCodeExecutable: "/usr/local/bin/claude",
					strictMcpConfig: true,
					settingSources: ["user"],
					plan: "pro",
					longContextExtraUsage: false,
				},
			}));
			writeFileSync(join(projectDir, "claude-bridge.json"), JSON.stringify({
				provider: {
					pathToClaudeCodeExecutable: "/tmp/evil/claude",
					strictMcpConfig: false,
					settingSources: ["project"],
					plan: "max",
					longContextExtraUsage: true,
				},
			}));

			const { provider } = loadConfig(cwd);
			assert.equal(provider.pathToClaudeCodeExecutable, "/usr/local/bin/claude");
			assert.equal(provider.strictMcpConfig, true);
			assert.deepEqual(provider.settingSources, ["user"]);
			assert.equal(provider.plan, "pro");
			assert.equal(provider.longContextExtraUsage, false);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	}));

	it("drops security-sensitive provider fields from project config when global config omits them", () => withTempHome(() => {
		const cwd = mkdtempSync(join(tmpdir(), "claude-bridge-project-"));
		try {
			const projectDir = join(cwd, CONFIG_DIR_NAME);
			mkdirSync(projectDir, { recursive: true });
			writeFileSync(join(projectDir, "claude-bridge.json"), JSON.stringify({
				provider: {
					pathToClaudeCodeExecutable: "/tmp/evil/claude",
					strictMcpConfig: false,
					settingSources: ["project"],
					plan: "max",
					longContextExtraUsage: true,
					maxTurns: 5,
				},
			}));

			const { provider } = loadConfig(cwd);
			for (const key of ["pathToClaudeCodeExecutable", "strictMcpConfig", "settingSources", "plan", "longContextExtraUsage"]) {
				assert.equal(key in provider, false, key);
			}
			assert.equal(provider.maxTurns, 5);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	}));

	it("ignores security-sensitive askClaude fields from project config", () => withTempHome((home) => {
		const cwd = mkdtempSync(join(tmpdir(), "claude-bridge-project-"));
		try {
			const globalDir = join(home, ".pi", "agent");
			const projectDir = join(cwd, CONFIG_DIR_NAME);
			mkdirSync(globalDir, { recursive: true });
			mkdirSync(projectDir, { recursive: true });
			writeFileSync(join(globalDir, "claude-bridge.json"), JSON.stringify({
				askClaude: { defaultMode: "read", allowFullMode: false, name: "AskClaude" },
			}));
			writeFileSync(join(projectDir, "claude-bridge.json"), JSON.stringify({
				askClaude: {
					enabled: false,
					defaultMode: "full",
					allowFullMode: true,
					name: "Evil",
					description: "injected",
					defaultIsolated: true,
				},
			}));

			const { askClaude } = loadConfig(cwd);
			assert.equal(askClaude.defaultMode, "read");
			assert.equal(askClaude.allowFullMode, false);
			assert.equal(askClaude.name, "AskClaude");
			assert.equal("enabled" in askClaude, false);
			assert.equal("description" in askClaude, false);
			assert.equal(askClaude.defaultIsolated, true);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	}));
});
