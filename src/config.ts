// User-facing extension config. Loaded once at extension registration from
// ~/.pi/agent/claude-bridge.json and the project Pi config directory, project
// overriding global. Missing or unparseable files are ignored (error to
// console.error, empty object returned) so the extension always starts.

import type { SettingSource } from "@anthropic-ai/claude-agent-sdk";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export interface Config {
	askClaude?: {
		enabled?: boolean;
		name?: string;
		label?: string;
		description?: string;
		defaultMode?: "full" | "read" | "none";
		defaultIsolated?: boolean;
		allowFullMode?: boolean;
		appendSkills?: boolean;
	};
	/** Low-level Claude Agent SDK plumbing. Most users won't need these. */
	provider?: {
		appendSystemPrompt?: boolean;
		settingSources?: SettingSource[];
		strictMcpConfig?: boolean;
		pathToClaudeCodeExecutable?: string;
		// Subscription plan tier. Setting to "max" enables Opus 4.6 at 1M context
		plan?: "pro" | "max";
		// Set to true to opt into metered 1M context usage ("extra usage" in
		// Anthropic billing). Enables Sonnet 4.6 [1m] on every plan and Opus 4.6
		// [1m] on Pro.
		longContextExtraUsage?: boolean;
		// Maximum turns per query. Defaults to 50 when not set. Prevents tool loops
		// from consuming subscription quota indefinitely.
		maxTurns?: number;
	};
}

export function tryParseJson(path: string): Partial<Config> {
	if (!existsSync(path)) return {};
	try {
		return JSON.parse(readFileSync(path, "utf-8"));
	} catch (e) {
		console.error(`claude-bridge: failed to parse ${path}: ${e}`);
		return {};
	}
}

export function loadConfig(cwd: string): Config {
	const global = tryParseJson(join(homedir(), ".pi", "agent", "claude-bridge.json"));
	const project = tryParseJson(join(cwd, CONFIG_DIR_NAME, "claude-bridge.json"));
	const provider = { ...global.provider, ...project.provider };
	// Security-sensitive fields: only from global config, never overridable by project
	if (global.provider?.pathToClaudeCodeExecutable !== undefined) {
		provider.pathToClaudeCodeExecutable = global.provider.pathToClaudeCodeExecutable;
	} else {
		delete provider.pathToClaudeCodeExecutable;
	}
	if (global.provider?.strictMcpConfig !== undefined) provider.strictMcpConfig = global.provider.strictMcpConfig;
	if (global.provider?.settingSources !== undefined) provider.settingSources = global.provider.settingSources;
	if (global.provider?.plan !== undefined) provider.plan = global.provider.plan;
	if (global.provider?.longContextExtraUsage !== undefined) provider.longContextExtraUsage = global.provider.longContextExtraUsage;
	return {
		askClaude: { ...global.askClaude, ...project.askClaude },
		provider,
	};
}
