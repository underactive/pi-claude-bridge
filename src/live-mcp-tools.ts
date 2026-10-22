// Live tool-set updates for an in-flight Claude Code query.
//
// The provider runs one Agent SDK query() per pi prompt and feeds tool results
// back into it, so the MCP server built when the query started is what CC
// declares to the model for the rest of the prompt. A tool can change pi's
// active tools while it runs (moa-fusion's enter_plan_mode narrows the loadout
// to read-only + plan tools), and the very next model request has to see that.
//
// setMcpServers() cannot do this: given the same server name it keeps the
// existing instance, and replacing the server would disconnect the in-flight
// tools/call that is about to return the tool result. Instead the live server's
// tool registry is swapped for one built by createSdkMcpServer (so schemas get
// exactly the same treatment as at query start) and tools/list_changed is
// sent; CC re-lists the server's tools. waitForCliTools confirms CC's view
// through mcpServerStatus() before the caller releases the tool result.
//
// Extracted from index.ts so tests can import without activating the extension.

import type { McpSdkServerConfigWithInstance, McpServerStatus } from "@anthropic-ai/claude-agent-sdk";
import { toToolDeclaration, type Tool } from "@earendil-works/pi-ai";

/** Stable key for a tool set's model-facing declarations, in pi's own terms. */
export function toolDeclarationsKey(tools: readonly Tool[]): string {
	return JSON.stringify(tools.map(toToolDeclaration));
}

// McpServer keeps its tools in `_registeredTools`, and its tools/list and
// tools/call handlers read that record on every request. It is not public API,
// so check the shape and let the caller fall back if a future SDK changes it.
interface ToolRegistryHost {
	_registeredTools?: Record<string, { enabled?: boolean }>;
	sendToolListChanged?: () => void;
}

function registryOf(server: McpSdkServerConfigWithInstance): ToolRegistryHost | undefined {
	const host = server.instance as unknown as ToolRegistryHost;
	const registry = host._registeredTools;
	return registry && typeof registry === "object" ? host : undefined;
}

/**
 * Point `live` at the tools of `next` and notify the connected client.
 * Returns the tool names `live` now lists, or undefined if the SDK's server
 * does not have the expected shape (nothing is changed in that case).
 */
export function replaceServerTools(live: McpSdkServerConfigWithInstance, next: McpSdkServerConfigWithInstance): string[] | undefined {
	const liveHost = registryOf(live);
	const nextHost = registryOf(next);
	if (!liveHost || !nextHost || typeof liveHost.sendToolListChanged !== "function") return undefined;
	liveHost._registeredTools = nextHost._registeredTools;
	liveHost.sendToolListChanged();
	return Object.entries(liveHost._registeredTools!)
		.filter(([, tool]) => tool.enabled !== false)
		.map(([name]) => name);
}

export type CliToolsResult =
	| { status: "confirmed"; elapsedMs: number }
	| { status: "timeout"; elapsedMs: number; seen?: string[] }
	| { status: "unavailable"; elapsedMs: number; error: string };

interface McpStatusSource {
	mcpServerStatus?: () => Promise<McpServerStatus[]>;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Poll the query's mcpServerStatus() until CC lists exactly `expected` for
 * `serverName`. Tool names may come back bare or as `mcp__<server>__<name>`.
 */
export async function waitForCliTools(
	sdkQuery: McpStatusSource | null | undefined,
	serverName: string,
	expected: readonly string[],
	{ timeoutMs = 5000, intervalMs = 20 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<CliToolsResult> {
	const start = Date.now();
	const elapsed = () => Date.now() - start;
	if (typeof sdkQuery?.mcpServerStatus !== "function") {
		return { status: "unavailable", elapsedMs: 0, error: "query has no mcpServerStatus()" };
	}
	const prefix = `mcp__${serverName}__`;
	const want = [...expected].sort().join("\n");
	let seen: string[] | undefined;
	while (true) {
		const remaining = timeoutMs - elapsed();
		if (remaining <= 0) return { status: "timeout", elapsedMs: elapsed(), seen };
		let statuses: McpServerStatus[] | undefined;
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			statuses = await Promise.race([
				sdkQuery.mcpServerStatus(),
				new Promise<undefined>((resolve) => { timer = setTimeout(() => resolve(undefined), remaining); }),
			]);
		} catch (error) {
			return { status: "unavailable", elapsedMs: elapsed(), error: error instanceof Error ? error.message : String(error) };
		} finally {
			clearTimeout(timer);
		}
		const tools = statuses?.find((status) => status.name === serverName)?.tools;
		if (tools) {
			seen = tools.map((tool) => tool.name.startsWith(prefix) ? tool.name.slice(prefix.length) : tool.name);
			if ([...seen].sort().join("\n") === want) return { status: "confirmed", elapsedMs: elapsed() };
		}
		await sleep(Math.min(intervalMs, Math.max(0, timeoutMs - elapsed())));
	}
}
