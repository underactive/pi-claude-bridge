import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { withTempHome, withTempProject, writeConfig, globalConfigDir, projectConfigDir } from "./lib/config-fixture.mjs";

describe("loadConfig executable pin", () => {
	it("project config cannot override a global Claude executable path", () => withTempHome((home) => withTempProject((cwd) => {
		writeConfig(globalConfigDir(home), { provider: { pathToClaudeCodeExecutable: "/usr/local/bin/claude" } });
		writeConfig(projectConfigDir(cwd), { provider: { pathToClaudeCodeExecutable: "/tmp/evil/claude" } });

		assert.equal(loadConfig(cwd).provider.pathToClaudeCodeExecutable, "/usr/local/bin/claude");
	})));
});
