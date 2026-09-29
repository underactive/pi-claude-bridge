import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";

export function withTempHome(fn) {
	const oldHome = process.env.HOME;
	const home = mkdtempSync(join(tmpdir(), "claude-bridge-home-"));
	try {
		process.env.HOME = home;
		return fn(home);
	} finally {
		if (oldHome === undefined) delete process.env.HOME;
		else process.env.HOME = oldHome;
		rmSync(home, { recursive: true, force: true });
	}
}

export function withTempProject(fn) {
	const cwd = mkdtempSync(join(tmpdir(), "claude-bridge-project-"));
	try {
		return fn(cwd);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
}

export function writeConfig(dir, contents) {
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "claude-bridge.json"), typeof contents === "string" ? contents : JSON.stringify(contents));
}

export const globalConfigDir = (home) => join(home, ".pi", "agent");
export const projectConfigDir = (cwd) => join(cwd, CONFIG_DIR_NAME);
