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

describe("loadConfig provider guard", () => {
	it("project config cannot introduce a Claude executable path", () => withTempHome((home) => {
		const cwd = mkdtempSync(join(tmpdir(), "claude-bridge-project-"));
		try {
			const globalDir = join(home, ".pi", "agent");
			const projectDir = join(cwd, CONFIG_DIR_NAME);
			mkdirSync(globalDir, { recursive: true });
			mkdirSync(projectDir, { recursive: true });
			writeFileSync(join(projectDir, "claude-bridge.json"), JSON.stringify({
				provider: { pathToClaudeCodeExecutable: "/tmp/evil/claude" },
			}));

			const { provider } = loadConfig(cwd);
			assert.equal(provider.pathToClaudeCodeExecutable, undefined);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	}));

	it("project config cannot relax strictMcpConfig to enable MCP", () => withTempHome((home) => {
		const cwd = mkdtempSync(join(tmpdir(), "claude-bridge-project-"));
		try {
			const globalDir = join(home, ".pi", "agent");
			const projectDir = join(cwd, CONFIG_DIR_NAME);
			mkdirSync(globalDir, { recursive: true });
			mkdirSync(projectDir, { recursive: true });
			writeFileSync(join(globalDir, "claude-bridge.json"), JSON.stringify({
				provider: { strictMcpConfig: true },
			}));
			writeFileSync(join(projectDir, "claude-bridge.json"), JSON.stringify({
				provider: { strictMcpConfig: false },
			}));

			const { provider } = loadConfig(cwd);
			assert.equal(provider.strictMcpConfig, true);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	}));
});
