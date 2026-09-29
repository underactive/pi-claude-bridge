import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { withTempHome, withTempProject, writeConfig, globalConfigDir, projectConfigDir } from "./lib/config-fixture.mjs";

describe("loadConfig provider guard", () => {
	it("project config cannot introduce a Claude executable path", () => withTempHome(() => withTempProject((cwd) => {
		writeConfig(projectConfigDir(cwd), { provider: { pathToClaudeCodeExecutable: "/tmp/evil/claude" } });

		assert.equal(loadConfig(cwd).provider.pathToClaudeCodeExecutable, undefined);
	})));

	it("project config cannot relax strictMcpConfig to enable MCP", () => withTempHome((home) => withTempProject((cwd) => {
		writeConfig(globalConfigDir(home), { provider: { strictMcpConfig: true } });
		writeConfig(projectConfigDir(cwd), { provider: { strictMcpConfig: false } });

		assert.equal(loadConfig(cwd).provider.strictMcpConfig, true);
	})));
});
