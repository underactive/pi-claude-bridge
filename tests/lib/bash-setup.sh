#!/usr/bin/env bash
# Shared setup functions for bash-based integration tests.
# Source this file at the start of test scripts.

set -euo pipefail

# GNU coreutils' `timeout` is not available by default on macOS. All test
# callers pass integer seconds and only distinguish success from failure, so
# preserve the system binary when present and provide the needed subset when not.
if ! command -v timeout >/dev/null 2>&1; then
	timeout() {
		local duration="$1"
		shift
		local command_pid watcher_pid status=0

		"$@" &
		command_pid=$!
		# Detach the watcher from command-substitution pipes so successful commands
		# do not wait for the full timeout before the captured output reaches EOF.
		( sleep "$duration" && kill -TERM "$command_pid" 2>/dev/null ) </dev/null >/dev/null 2>&1 &
		watcher_pid=$!

		wait "$command_pid" 2>/dev/null || status=$?
		kill "$watcher_pid" 2>/dev/null || true
		wait "$watcher_pid" 2>/dev/null || true
		return "$status"
	}
fi

# Strip node_modules/.bin from PATH so we use the system pi, not the vendored one.
__clean_path() {
	echo "$PATH" | tr ':' '\n' | grep -v node_modules | tr '\n' ':'
}

# Setup standard test environment.
# Usage: setup_test_env "test-name"
# Sets: DIR, LOGDIR, LOGFILE (if specified), DEBUG_LOG, and exports CLAUDE_BRIDGE_DEBUG
setup_test_env() {
	local name="$1"
	local log_suffix="${2:-.log}"  # optional: suffix for logfile, or "none" for no logfile

	DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
	LOGDIR="$DIR/.test-output"
	mkdir -p "$LOGDIR"

	export CLAUDE_BRIDGE_DEBUG=1
	DEBUG_LOG="$LOGDIR/${name}-debug.log"
	export CLAUDE_BRIDGE_DEBUG_PATH="$DEBUG_LOG"

	if [[ "$log_suffix" != "none" ]]; then
		LOGFILE="$LOGDIR/${name}${log_suffix}"
	else
		LOGFILE=""
	fi

	# Clean PATH and run pi from the project root so project-local config is visible.
	PATH=$(__clean_path)
	cd "$DIR"

	# Export for use in tests
	export DIR LOGDIR DEBUG_LOG LOGFILE PATH
}

# Kill all descendant processes (children, grandchildren, etc.).
# Use as: trap kill_descendants EXIT
kill_descendants() {
	pkill -P $$ 2>/dev/null || true
	sleep 1
}

# Require an environment variable or exit with error.
# Usage: require_env VARNAME
require_env() {
	local var="$1"
	local val="${!var:-}"
	if [[ -z "$val" ]]; then
		echo "ERROR: $var not set (see .env.test)"
		exit 1
	fi
	echo "$val"
}

# Check for required commands or exit with error.
# Usage: require_command cmd1 cmd2 ...
require_command() {
	local cmd
	for cmd in "$@"; do
		if ! command -v "$cmd" >/dev/null 2>&1; then
			echo "ERROR: $cmd is required but not installed"
			exit 1
		fi
	done
}
