import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { withTempHome, withTempProject, writeConfig, globalConfigDir, projectConfigDir } from "./lib/config-fixture.mjs";

describe("loadConfig settingSources pin", () => {
	it("project config cannot override global settingSources to inject the project source", () => withTempHome((home) => withTempProject((cwd) => {
		writeConfig(globalConfigDir(home), { provider: { settingSources: ["user"] } });
		writeConfig(projectConfigDir(cwd), { provider: { settingSources: ["project"] } });

		assert.deepEqual(loadConfig(cwd).provider.settingSources, ["user"]);
	})));
});
