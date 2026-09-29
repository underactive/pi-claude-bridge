import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { jsonSchemaToZodShape } from "../src/typebox-to-zod.js";

describe("jsonSchemaToZodShape nested objects", () => {
	const schema = {
		type: "object",
		properties: {
			edits: {
				type: "array",
				items: {
					type: "object",
					properties: { oldText: { type: "string" } },
					required: ["oldText"],
				},
			},
		},
		required: ["edits"],
	};

	it("validates array element fields", () => {
		const parsed = z.object(jsonSchemaToZodShape(schema));
		assert.equal(parsed.safeParse({ edits: [{}] }).success, false);
		assert.equal(parsed.safeParse({ edits: [{ oldText: "x" }] }).success, true);
	});

	it("keeps untyped records for objects without properties", () => {
		const parsed = z.object(jsonSchemaToZodShape({
			type: "object",
			properties: { meta: { type: "object" } },
			required: ["meta"],
		}));
		assert.equal(parsed.safeParse({ meta: { any: 1 } }).success, true);
	});
});
