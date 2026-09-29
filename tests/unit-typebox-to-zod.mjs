import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { Type } from "typebox";
import { jsonSchemaToZodShape } from "../src/typebox-to-zod.js";

describe("jsonSchemaToZodShape TypeBox schemas", () => {
	it("rejects a missing required string", () => {
		const parsed = z.object(jsonSchemaToZodShape(Type.Object({ path: Type.String() })));
		assert.equal(parsed.safeParse({}).success, false);
		assert.equal(parsed.safeParse({ path: "a" }).success, true);
	});

	it("accepts a missing optional number", () => {
		const parsed = z.object(jsonSchemaToZodShape(Type.Object({ n: Type.Optional(Type.Number()) })));
		assert.equal(parsed.safeParse({}).success, true);
		assert.equal(parsed.safeParse({ n: "x" }).success, false);
	});

	it("rejects values outside an enum", () => {
		const parsed = z.object(jsonSchemaToZodShape({
			type: "object",
			properties: { mode: { enum: ["a", "b"] } },
			required: ["mode"],
		}));
		assert.equal(parsed.safeParse({ mode: "a" }).success, true);
		assert.equal(parsed.safeParse({ mode: "c" }).success, false);
	});

	it("rejects strings in an array of numbers", () => {
		const parsed = z.object(jsonSchemaToZodShape(Type.Object({ xs: Type.Array(Type.Number()) })));
		assert.equal(parsed.safeParse({ xs: [1, 2] }).success, true);
		assert.equal(parsed.safeParse({ xs: ["a"] }).success, false);
	});

	it("preserves descriptions", () => {
		const shape = jsonSchemaToZodShape(Type.Object({ path: Type.String({ description: "File path" }) }));
		assert.equal(shape.path.description, "File path");
	});

	it("returns an empty shape for non-object or property-less schemas", () => {
		assert.deepEqual(jsonSchemaToZodShape(Type.String()), {});
		assert.deepEqual(jsonSchemaToZodShape({ type: "object" }), {});
		assert.deepEqual(jsonSchemaToZodShape(undefined), {});
	});
});

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
