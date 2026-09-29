import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { withTempHome, withTempProject, writeConfig, globalConfigDir, projectConfigDir } from "./lib/config-fixture.mjs";

describe("loadConfig plan pin", () => {
	it("project config cannot downgrade a global subscription plan", () => withTempHome((home) => withTempProject((cwd) => {
		writeConfig(globalConfigDir(home), { provider: { plan: "max" } });
		writeConfig(projectConfigDir(cwd), { provider: { plan: "pro" } });

		assert.equal(loadConfig(cwd).provider.plan, "max");
	})));
});
