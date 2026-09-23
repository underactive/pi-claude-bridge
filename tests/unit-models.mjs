/**
 * Tests for MODELS construction + resolveModel.
 * Pins: opus shortcut resolves to whichever opus is first in MODEL_IDS_IN_ORDER,
 * projection strips pi-ai's baseUrl/api/provider/headers, and ordering is preserved.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { calculateCost } from "@earendil-works/pi-ai";
import { MODEL_IDS_IN_ORDER, applyLongContext, buildModels, claudeCodeModelId, mergeOverlayModels, resolveClaudeCodeRuntimeModel, resolveModel } from "../src/models.js";

const PRO = { plan: "pro", longContextExtraUsage: false };
const MAX = { plan: "max", longContextExtraUsage: false };
const EXTRA = { plan: "pro", longContextExtraUsage: true };

// Simulated pi-ai registry entry — extra fields mimic the ones pi-ai exposes
// that must not leak into the provider-registered MODELS array.
const mockPiAiModel = (id) => ({
	id, name: id, reasoning: true, input: ["text"],
	// Realistic Haiku-class rates ($/MTok) — calculateCost math in the
	// "cost calculation" suite below is hand-computed against these.
	cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
	contextWindow: 200000, maxTokens: 8000,
	// Leaky fields that should be stripped by the projection:
	baseUrl: "https://api.anthropic.com", api: "anthropic", provider: "anthropic",
	headers: { "x-api-key": "LEAK" },
});

const oneM = (id) => ({ ...mockPiAiModel(id), contextWindow: 1000000 });

const find = (models, id) => models.find((m) => m.id === id);

describe("MODELS projection", () => {
	it("strips baseUrl/api/provider/headers", () => {
		const models = buildModels(MODEL_IDS_IN_ORDER.map(mockPiAiModel));
		for (const m of models) {
			assert.equal(m.baseUrl, undefined);
			assert.equal(m.api, undefined);
			assert.equal(m.provider, undefined);
			assert.equal(m.headers, undefined);
		}
	});

	it("preserves MODEL_IDS_IN_ORDER ordering", () => {
		const models = buildModels(MODEL_IDS_IN_ORDER.map(mockPiAiModel));
		assert.deepEqual(models.map((m) => m.id), MODEL_IDS_IN_ORDER);
	});

	it("silently drops IDs missing from pi-ai (no fallback)", () => {
		// Only haiku present — opus/sonnet vanish from picker.
		const models = buildModels([mockPiAiModel("claude-haiku-4-5")]);
		assert.deepEqual(models.map((m) => m.id), ["claude-haiku-4-5"]);
	});

	it("forwards pi-ai list pricing", () => {
		const models = buildModels(MODEL_IDS_IN_ORDER.map(mockPiAiModel));
		for (const m of models) {
			assert.deepEqual(m.cost, { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 });
		}
	});

	it("normalizes a partial cost to all four fields (calculateCost dereferences unguarded)", () => {
		const models = buildModels([{ ...mockPiAiModel("claude-haiku-4-5"), cost: { input: 5 } }]);
		assert.deepEqual(models[0].cost, { input: 5, output: 0, cacheRead: 0, cacheWrite: 0 });
	});

	it("normalizes a missing cost key to all four zeros", () => {
		const { cost, ...noCost } = mockPiAiModel("claude-haiku-4-5");
		const models = buildModels([noCost]);
		assert.deepEqual(models[0].cost, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
	});

	it("normalizes non-numeric and non-finite rates to 0 (malformed overlay JSON)", () => {
		const models = buildModels([
			{ ...mockPiAiModel("claude-haiku-4-5"), cost: { input: "3", output: NaN, cacheRead: Infinity, cacheWrite: null } },
		]);
		assert.deepEqual(models[0].cost, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
	});

	it("overlay-only models keep their pricing through mergeOverlayModels", () => {
		const staticCatalog = [mockPiAiModel("claude-haiku-4-5")];
		const overlay = { ...mockPiAiModel("claude-opus-5"), cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 } };
		const merged = mergeOverlayModels(staticCatalog, [overlay]);
		const models = buildModels(merged);
		assert.deepEqual(find(models, "claude-opus-5").cost, { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 });
	});

	it("leaves display names bare before plan-specific context is applied", () => {
		const models = buildModels(MODEL_IDS_IN_ORDER.map(oneM));
		assert.deepEqual(models.map((m) => m.id), MODEL_IDS_IN_ORDER);
		assert.ok(models.every((m) => !m.name.includes("1M")));
	});

	it("fills default thinkingLevelMap for sonnet-5 and sonnet-4-6 when pi-ai omits it", () => {
		const models = buildModels(MODEL_IDS_IN_ORDER.map(mockPiAiModel));
		assert.deepEqual(find(models, "claude-sonnet-5")?.thinkingLevelMap, { xhigh: "max" });
		assert.deepEqual(find(models, "claude-sonnet-4-6")?.thinkingLevelMap, { xhigh: "max" });
	});

	it("preserves pi-ai's thinkingLevelMap when present", () => {
		const withMap = (id) => ({ ...mockPiAiModel(id), thinkingLevelMap: { xhigh: "xhigh" } });
		const models = buildModels([withMap("claude-sonnet-5")]);
		assert.deepEqual(find(models, "claude-sonnet-5")?.thinkingLevelMap, { xhigh: "xhigh" });
	});

	it("haiku gets no default thinkingLevelMap (no effort support)", () => {
		const models = buildModels(MODEL_IDS_IN_ORDER.map(mockPiAiModel));
		assert.equal(find(models, "claude-haiku-4-5")?.thinkingLevelMap, undefined);
	});
	describe("cost calculation", () => {
		// Real pi-ai calculateCost against a buildModels output, so the registered
		// pricing shape is what actually feeds pi's footer math.
		const model = buildModels(MODEL_IDS_IN_ORDER.map(mockPiAiModel))[0];

		const makeUsage = () => ({
			input: 1_000_000, output: 100_000, cacheRead: 2_000_000, cacheWrite: 10_000,
			totalTokens: 3_110_000,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		});
		// Hand-computed at rates { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }:
		// in=1M → $3, out=100K → $1.5, cacheRead=2M → $0.6, cacheWrite=10K → $0.0375
		const EXPECTED = { input: 3, output: 1.5, cacheRead: 0.6, cacheWrite: 0.0375, total: 5.1375 };

		it("computes each component and the total per-million-token", () => {
			const usage = makeUsage();
			calculateCost(model, usage);
			assert.equal(usage.cost.input, EXPECTED.input);
			assert.equal(usage.cost.output, EXPECTED.output);
			assert.equal(usage.cost.cacheRead, EXPECTED.cacheRead);
			assert.equal(usage.cost.cacheWrite, EXPECTED.cacheWrite);
			assert.ok(Math.abs(usage.cost.total - EXPECTED.total) < 1e-9);
		});

		it("replaces (not accumulates) on a repeat call for the same usage object", () => {
			const usage = makeUsage();
			calculateCost(model, usage);
			usage.input = 500_000;
			usage.output = 10_000;
			usage.cacheRead = 0;
			usage.cacheWrite = 0;
			calculateCost(model, usage);
			assert.deepEqual(usage.cost, { input: 1.5, output: 0.15, cacheRead: 0, cacheWrite: 0, total: 1.65 });
		});

		it("zero usage yields zero cost", () => {
			const usage = makeUsage();
			usage.input = 0; usage.output = 0; usage.cacheRead = 0; usage.cacheWrite = 0; usage.totalTokens = 0;
			calculateCost(model, usage);
			assert.deepEqual(usage.cost, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 });
		});

		it("prices the 1h cache-write subset at 2x base input", () => {
			const usage = makeUsage();
			usage.cacheWrite1h = 4_000;
			calculateCost(model, usage);
			// shortWrite = 10K-4K = 6K @ 3.75 + 4K @ 2x input rate (3*2=6):
			// (3.75*6000 + 6*4000)/1e6 = (22500 + 24000)/1e6 = 0.0465
			assert.equal(usage.cost.cacheWrite, 0.0465);
			assert.ok(Math.abs(usage.cost.total - (3 + 1.5 + 0.6 + 0.0465)) < 1e-9);
		});
	});
});

describe("Claude Code runtime model policy", () => {
	it("uses measured Pro defaults", () => {
		assert.deepEqual(resolveClaudeCodeRuntimeModel("claude-fable-5-1", PRO), { cliModelId: "claude-fable-5-1[1m]", contextWindow: 1000000 });
		assert.deepEqual(resolveClaudeCodeRuntimeModel("claude-opus-5-5", PRO), { cliModelId: "claude-opus-5-5[1m]", contextWindow: 1000000 });
		assert.deepEqual(resolveClaudeCodeRuntimeModel("claude-opus-5", PRO), { cliModelId: "claude-opus-5[1m]", contextWindow: 1000000 });
		assert.deepEqual(resolveClaudeCodeRuntimeModel("claude-opus-4-8", PRO), { cliModelId: "claude-opus-4-8[1m]", contextWindow: 1000000 });
		assert.deepEqual(resolveClaudeCodeRuntimeModel("claude-opus-4-7", PRO), { cliModelId: "claude-opus-4-7", contextWindow: 1000000 });
		assert.deepEqual(resolveClaudeCodeRuntimeModel("claude-opus-4-6", PRO), { cliModelId: "claude-opus-4-6", contextWindow: 200000 });
		assert.deepEqual(resolveClaudeCodeRuntimeModel("claude-sonnet-4-6", PRO), { cliModelId: "claude-sonnet-4-6", contextWindow: 200000 });
		assert.deepEqual(resolveClaudeCodeRuntimeModel("claude-haiku-4-5", PRO), { cliModelId: "claude-haiku-4-5", contextWindow: 200000 });
	});

	it("plan max only changes Opus 4.6", () => {
		assert.deepEqual(resolveClaudeCodeRuntimeModel("claude-opus-5-5", MAX), { cliModelId: "claude-opus-5-5[1m]", contextWindow: 1000000 });
		assert.deepEqual(resolveClaudeCodeRuntimeModel("claude-opus-4-8", MAX), { cliModelId: "claude-opus-4-8[1m]", contextWindow: 1000000 });
		assert.deepEqual(resolveClaudeCodeRuntimeModel("claude-opus-4-7", MAX), { cliModelId: "claude-opus-4-7", contextWindow: 1000000 });
		assert.deepEqual(resolveClaudeCodeRuntimeModel("claude-opus-4-6", MAX), { cliModelId: "claude-opus-4-6[1m]", contextWindow: 1000000 });
		assert.deepEqual(resolveClaudeCodeRuntimeModel("claude-sonnet-4-6", MAX), { cliModelId: "claude-sonnet-4-6", contextWindow: 200000 });
	});

	it("longContextExtraUsage enables metered variants but not Haiku", () => {
		assert.deepEqual(resolveClaudeCodeRuntimeModel("claude-opus-4-6", EXTRA), { cliModelId: "claude-opus-4-6[1m]", contextWindow: 1000000 });
		assert.deepEqual(resolveClaudeCodeRuntimeModel("claude-sonnet-4-6", EXTRA), { cliModelId: "claude-sonnet-4-6[1m]", contextWindow: 1000000 });
		assert.deepEqual(resolveClaudeCodeRuntimeModel("claude-haiku-4-5", EXTRA), { cliModelId: "claude-haiku-4-5", contextWindow: 200000 });
	});

	it("unknown model falls back to bare id at 200K", () => {
		assert.deepEqual(resolveClaudeCodeRuntimeModel("claude-future-9-9", PRO), { cliModelId: "claude-future-9-9", contextWindow: 200000 });
	});
});

describe("claudeCodeModelId", () => {
	const models = buildModels(MODEL_IDS_IN_ORDER.map(oneM));

	it("returns the measured SDK request id", () => {
		assert.equal(claudeCodeModelId(find(models, "claude-fable-5-1"), PRO), "claude-fable-5-1[1m]");
		assert.equal(claudeCodeModelId(find(models, "claude-opus-5-5"), PRO), "claude-opus-5-5[1m]");
		assert.equal(claudeCodeModelId(find(models, "claude-opus-4-8"), PRO), "claude-opus-4-8[1m]");
		assert.equal(claudeCodeModelId(find(models, "claude-opus-4-7"), PRO), "claude-opus-4-7");
		assert.equal(claudeCodeModelId(find(models, "claude-opus-4-6"), PRO), "claude-opus-4-6");
		assert.equal(claudeCodeModelId(find(models, "claude-opus-4-6"), MAX), "claude-opus-4-6[1m]");
		assert.equal(claudeCodeModelId(find(models, "claude-sonnet-4-6"), EXTRA), "claude-sonnet-4-6[1m]");
		assert.equal(claudeCodeModelId(find(models, "claude-haiku-4-5"), EXTRA), "claude-haiku-4-5");
	});

});

describe("applyLongContext", () => {
	const models = buildModels(MODEL_IDS_IN_ORDER.map(oneM));

	it("registers measured Pro defaults", () => {
		const registered = applyLongContext(models, PRO);
		assert.equal(find(registered, "claude-opus-5-5").contextWindow, 1000000);
		assert.equal(find(registered, "claude-opus-4-8").contextWindow, 1000000);
		assert.equal(find(registered, "claude-opus-4-7").contextWindow, 1000000);
		assert.equal(find(registered, "claude-opus-4-6").contextWindow, 200000);
		assert.equal(find(registered, "claude-sonnet-4-6").contextWindow, 200000);
		assert.equal(find(registered, "claude-haiku-4-5").contextWindow, 200000);
		// Does not mutate the source table used for id resolution.
		assert.equal(find(models, "claude-opus-4-6").contextWindow, 1000000);
	});

	it("registers Max-plan Opus 4.6 at 1M but leaves Sonnet at 200K", () => {
		const registered = applyLongContext(models, MAX);
		assert.equal(find(registered, "claude-opus-4-6").contextWindow, 1000000);
		assert.equal(find(registered, "claude-sonnet-4-6").contextWindow, 200000);
	});

	it("registers extra-usage Opus 4.6 and Sonnet at 1M", () => {
		const registered = applyLongContext(models, EXTRA);
		assert.equal(find(registered, "claude-opus-4-6").contextWindow, 1000000);
		assert.equal(find(registered, "claude-sonnet-4-6").contextWindow, 1000000);
		assert.equal(find(registered, "claude-haiku-4-5").contextWindow, 200000);
	});

	it("labels exactly the registered 1M models", () => {
		const pro = applyLongContext(models, PRO);
		assert.equal(find(pro, "claude-opus-5-5").name, "claude-opus-5-5 1M");
		assert.equal(find(pro, "claude-opus-4-8").name, "claude-opus-4-8 1M");
		assert.equal(find(pro, "claude-opus-4-7").name, "claude-opus-4-7 1M");
		assert.equal(find(pro, "claude-opus-4-6").name, "claude-opus-4-6");
		assert.equal(find(pro, "claude-sonnet-4-6").name, "claude-sonnet-4-6");

		const extra = applyLongContext(models, EXTRA);
		assert.equal(find(extra, "claude-opus-4-6").name, "claude-opus-4-6 1M");
		assert.equal(find(extra, "claude-sonnet-4-6").name, "claude-sonnet-4-6 1M");
	});

	it("leaves cost untouched on re-labeled and pass-through models", () => {
		const registered = applyLongContext(models, PRO);
		// Re-labeled (contextWindow/name rewritten):
		assert.deepEqual(find(registered, "claude-opus-4-8").cost, mockPiAiModel("x").cost);
		// Pass-through (same object reference returned): haiku already at its
		// resolved 200K window with a bare name.
		const base = buildModels([mockPiAiModel("claude-haiku-4-5")]);
		const passthrough = applyLongContext(base, PRO);
		assert.equal(passthrough[0], base[0]);
		assert.deepEqual(passthrough[0].cost, mockPiAiModel("x").cost);
	});
});

describe("resolveModel", () => {
	const models = buildModels(MODEL_IDS_IN_ORDER.map(mockPiAiModel));

	it("fable shortcut resolves to claude-fable-5-1 (latest Fable in order)", () => {
		assert.equal(resolveModel(models, "fable")?.id, "claude-fable-5-1");
	});

	it("opus shortcut resolves to claude-opus-5-5 (latest Opus in order)", () => {
		assert.equal(resolveModel(models, "opus")?.id, "claude-opus-5-5");
	});

	it("full Fable 5 ID resolves exactly despite the shared prefix", () => {
		assert.equal(resolveModel(models, "claude-fable-5")?.id, "claude-fable-5");
	});

	it("full Opus 5 ID resolves exactly despite the shared prefix", () => {
		assert.equal(resolveModel(models, "claude-opus-5")?.id, "claude-opus-5");
	});

	it("haiku shortcut resolves to claude-haiku-4-5", () => {
		assert.equal(resolveModel(models, "haiku")?.id, "claude-haiku-4-5");
	});

	it("full ID resolves to itself", () => {
		assert.equal(resolveModel(models, "claude-opus-4-6")?.id, "claude-opus-4-6");
	});

	it("returns undefined when no match", () => {
		assert.equal(resolveModel(models, "gpt-9"), undefined);
	});

	it("returns the matched model object for CLI-arg conversion", () => {
		const oneMModels = buildModels(MODEL_IDS_IN_ORDER.map(oneM));
		const model = resolveModel(oneMModels, "opus");
		assert.equal(model.id, "claude-opus-5-5");
		assert.equal(claudeCodeModelId(model, PRO), "claude-opus-5-5[1m]");
	});
});

describe("mergeOverlayModels", () => {
	const staticCatalog = ["claude-opus-4-8", "claude-haiku-4-5"].map(mockPiAiModel);

	it("adds bridge models missing from the static catalog", () => {
		const merged = mergeOverlayModels(staticCatalog, [mockPiAiModel("claude-fable-5-1"), mockPiAiModel("claude-opus-5-5"), mockPiAiModel("claude-opus-5")]);
		assert.ok(find(merged, "claude-fable-5-1"), "fable-5-1 should be filled from overlay");
		assert.ok(find(merged, "claude-opus-5-5"), "opus-5-5 should be filled from overlay");
		assert.ok(find(merged, "claude-opus-5"), "opus-5 should be filled from overlay");
		// buildModels then projects them into MODEL_IDS_IN_ORDER positions.
		assert.ok(find(buildModels(merged), "claude-fable-5-1"));
		assert.ok(find(buildModels(merged), "claude-opus-5-5"));
		assert.ok(find(buildModels(merged), "claude-opus-5"));
	});

	it("ignores overlay ids that are not bridge models", () => {
		const merged = mergeOverlayModels(staticCatalog, [mockPiAiModel("claude-opus-4-1")]);
		assert.equal(find(merged, "claude-opus-4-1"), undefined);
	});

	it("never overrides a static entry with the overlay copy", () => {
		const overlayOpus48 = { ...mockPiAiModel("claude-opus-4-8"), name: "OVERLAY" };
		const merged = mergeOverlayModels(staticCatalog, [overlayOpus48]);
		assert.equal(find(merged, "claude-opus-4-8").name, "claude-opus-4-8");
	});

	it("returns the same array reference when nothing is added", () => {
		assert.equal(mergeOverlayModels(staticCatalog, []), staticCatalog);
	});
});
