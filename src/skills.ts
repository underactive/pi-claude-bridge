// Skills block extraction + MCP naming constants.
// Extracted from index.ts so tests can import without activating the extension.

export const MCP_SERVER_NAME = "custom-tools";
export const MCP_TOOL_PREFIX = `mcp__${MCP_SERVER_NAME}__`;

// Extract skills block from pi's system prompt for forwarding to Claude Code.
export function extractSkillsBlock(systemPrompt?: string, rewriteReadTool = true): string | undefined {
	if (!systemPrompt) return undefined;
	const startTag = "<available_skills>";
	const endMarker = "</available_skills>";
	const tagIdx = systemPrompt.indexOf(startTag);
	if (tagIdx === -1) return undefined;
	const end = systemPrompt.indexOf(endMarker, tagIdx);
	if (end === -1) return undefined;
	const leadInEnd = systemPrompt.slice(0, tagIdx).trimEnd().length;
	const paragraphBreak = systemPrompt.lastIndexOf("\n\n", leadInEnd - 1);
	const start = paragraphBreak === -1 ? 0 : paragraphBreak + 2;
	const block = systemPrompt.slice(start, end + endMarker.length).trim();
	return rewriteReadTool ? rewriteSkillsBlock(block) : block;
}

export function rewriteSkillsBlock(skillsBlock: string): string {
	return skillsBlock.replace(
		"Use the read tool to load a skill's file",
		`Use the read tool (mcp__${MCP_SERVER_NAME}__read) to load a skill's file`,
	);
}
