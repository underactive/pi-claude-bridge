import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { withTempHome, withTempProject, writeConfig, globalConfigDir, projectConfigDir } from "./lib/config-fixture.mjs";

describe("loadConfig", () => {
	it("loads project config from Pi's configured project directory", () => withTempHome(() => withTempProject((cwd) => {
		writeConfig(projectConfigDir(cwd), {
			provider: { maxTurns: 7 },
			askClaude: { enabled: false },
		});

		assert.deepEqual(loadConfig(cwd), {
			provider: { maxTurns: 7 },
			askClaude: {},
		});
	})));

	it("merges project config over global config", () => withTempHome((home) => withTempProject((cwd) => {
		writeConfig(globalConfigDir(home), {
			provider: { plan: "pro", strictMcpConfig: true },
			askClaude: { enabled: true, defaultMode: "read" },
		});
		writeConfig(projectConfigDir(cwd), {
			provider: { plan: "max" },
			askClaude: { enabled: false },
		});

		assert.deepEqual(loadConfig(cwd), {
			provider: { plan: "pro", strictMcpConfig: true },
			askClaude: { enabled: true, defaultMode: "read" },
		});
	})));

	it("ignores a malformed project config and keeps the global config", () => withTempHome((home) => withTempProject((cwd) => {
		const originalError = console.error;
		console.error = () => {};
		try {
			writeConfig(globalConfigDir(home), { provider: { maxTurns: 50 } });
			writeConfig(projectConfigDir(cwd), "{not json");

			assert.deepEqual(loadConfig(cwd), {
				provider: { maxTurns: 50 },
				askClaude: {},
			});
		} finally {
			console.error = originalError;
		}
	})));

	it("lets project config override non-pinned provider fields", () => withTempHome((home) => withTempProject((cwd) => {
		writeConfig(globalConfigDir(home), { provider: { maxTurns: 50 } });
		writeConfig(projectConfigDir(cwd), { provider: { maxTurns: 5 } });

		assert.equal(loadConfig(cwd).provider.maxTurns, 5);
	})));
});
