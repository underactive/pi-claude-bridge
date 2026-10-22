// Test extension: a tool that changes pi's active tools while it runs, the way
// moa-fusion's enter_plan_mode narrows to plan-only tools. EnablePalette drops
// bash and itself and activates PaletteTool, which every prompt starts without.
import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	pi.on("before_agent_start", () => {
		const active = pi.getActiveTools();
		if (active.includes("PaletteTool")) pi.setActiveTools(active.filter((name) => name !== "PaletteTool"));
	});

	const none = Type.Object({});
	pi.registerTool<typeof none>({
		name: "EnablePalette",
		label: "Enable the palette",
		description: "Switches to palette mode: makes PaletteTool available and disables bash. Use this when asked to call EnablePalette.",
		parameters: none,
		async execute() {
			pi.setActiveTools([...pi.getActiveTools().filter((name) => name !== "bash" && name !== "EnablePalette"), "PaletteTool"]);
			return { content: [{ type: "text" as const, text: "Palette mode on. PaletteTool is now available; bash is disabled." }], details: {} };
		},
	});
	pi.registerTool<typeof none>({
		name: "PaletteTool",
		label: "Pick a palette color",
		description: "Returns today's palette color. Only available in palette mode.",
		parameters: none,
		async execute() {
			return { content: [{ type: "text" as const, text: "Today's palette color is periwinkle-4817" }], details: {} };
		},
	});
}
