import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PROVIDER_FORCE_MODE_ENV, providerDisallowedToolsFromEnv } from "../src/index.js";

describe("provider read-only handshake", () => {
	it("uses the documented env var name", () => {
		assert.equal(PROVIDER_FORCE_MODE_ENV, "PI_CLAUDE_BRIDGE_FORCE_MODE");
	});

	it("applies no restrictions when the env var is unset", () => {
		assert.equal(providerDisallowedToolsFromEnv({}), undefined);
	});

	it("blocks every mutation-capable CC tool when set to read", () => {
		const blocked = providerDisallowedToolsFromEnv({ [PROVIDER_FORCE_MODE_ENV]: "read" });
		assert.ok(Array.isArray(blocked));
		for (const tool of ["Write", "Edit", "Bash", "NotebookEdit", "EnterWorktree", "CronCreate", "TeamCreate"]) {
			assert.ok(blocked.includes(tool), `expected ${tool} to be blocked`);
		}
	});

	it("leaves exploration tools available in read mode", () => {
		const blocked = providerDisallowedToolsFromEnv({ [PROVIDER_FORCE_MODE_ENV]: "read" });
		for (const tool of ["Read", "Glob", "Grep", "WebFetch", "WebSearch", "Agent"]) {
			assert.ok(!blocked.includes(tool), `expected ${tool} to stay available`);
		}
	});

	it("stays inert for values other than read", () => {
		assert.equal(providerDisallowedToolsFromEnv({ [PROVIDER_FORCE_MODE_ENV]: "full" }), undefined);
		assert.equal(providerDisallowedToolsFromEnv({ [PROVIDER_FORCE_MODE_ENV]: "" }), undefined);
	});
});
