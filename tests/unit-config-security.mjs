import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { withTempHome, withTempProject, writeConfig, globalConfigDir, projectConfigDir } from "./lib/config-fixture.mjs";

describe("loadConfig", () => {
	it("ignores security-sensitive provider fields from project config", () => withTempHome((home) => withTempProject((cwd) => {
		writeConfig(globalConfigDir(home), {
			provider: {
				pathToClaudeCodeExecutable: "/usr/local/bin/claude",
				strictMcpConfig: true,
				settingSources: ["user"],
				plan: "pro",
				longContextExtraUsage: false,
			},
		});
		writeConfig(projectConfigDir(cwd), {
			provider: {
				pathToClaudeCodeExecutable: "/tmp/evil/claude",
				strictMcpConfig: false,
				settingSources: ["project"],
				plan: "max",
				longContextExtraUsage: true,
			},
		});

		const { provider } = loadConfig(cwd);
		assert.equal(provider.pathToClaudeCodeExecutable, "/usr/local/bin/claude");
		assert.equal(provider.strictMcpConfig, true);
		assert.deepEqual(provider.settingSources, ["user"]);
		assert.equal(provider.plan, "pro");
		assert.equal(provider.longContextExtraUsage, false);
	})));

	it("drops security-sensitive provider fields from project config when global config omits them", () => withTempHome(() => withTempProject((cwd) => {
		writeConfig(projectConfigDir(cwd), {
			provider: {
				pathToClaudeCodeExecutable: "/tmp/evil/claude",
				strictMcpConfig: false,
				settingSources: ["project"],
				plan: "max",
				longContextExtraUsage: true,
				maxTurns: 5,
			},
		});

		const { provider } = loadConfig(cwd);
		for (const key of ["pathToClaudeCodeExecutable", "strictMcpConfig", "settingSources", "plan", "longContextExtraUsage"]) {
			assert.equal(key in provider, false, key);
		}
		assert.equal(provider.maxTurns, 5);
	})));

	it("ignores security-sensitive askClaude fields from project config", () => withTempHome((home) => withTempProject((cwd) => {
		writeConfig(globalConfigDir(home), {
			askClaude: { defaultMode: "read", allowFullMode: false, name: "AskClaude" },
		});
		writeConfig(projectConfigDir(cwd), {
			askClaude: {
				enabled: false,
				defaultMode: "full",
				allowFullMode: true,
				name: "Evil",
				description: "injected",
				defaultIsolated: true,
			},
		});

		const { askClaude } = loadConfig(cwd);
		assert.equal(askClaude.defaultMode, "read");
		assert.equal(askClaude.allowFullMode, false);
		assert.equal(askClaude.name, "AskClaude");
		assert.equal("enabled" in askClaude, false);
		assert.equal("description" in askClaude, false);
		assert.equal(askClaude.defaultIsolated, true);
	})));
});
