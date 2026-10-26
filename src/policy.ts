import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface BackgroundWorkPolicy {
	/** Minutes a `bg_wait` may block before giving up. */
	maxBackgroundWait: number;
	/** Crash-recovery wakes per item before the agent must ask the user. */
	maxCrashRecoveries: number;
}

const DEFAULT_POLICY: BackgroundWorkPolicy = { maxBackgroundWait: 30, maxCrashRecoveries: 1 };

export interface BackgroundWorkPolicyResult {
	policy: BackgroundWorkPolicy;
	warnings: string[];
}

export interface CrashRecoveryDecision {
	triggerTurn: boolean;
	note?: string;
}

interface PolicyFile {
	path: string;
	values: Record<string, unknown>;
}

const POLICY_FILE = "background-work.json";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function agentDirectory(): string {
	const envDir = process.env.PI_CODING_AGENT_DIR;
	if (!envDir) return join(homedir(), ".pi", "agent");
	return envDir === "~" || envDir.startsWith("~/") ? join(homedir(), envDir.slice(1)) : envDir;
}

function readPolicyFile(path: string, warnings: string[]): Record<string, unknown> {
	if (!existsSync(path)) return {};
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(path, "utf-8"));
	} catch (error) {
		warnings.push(`Ignoring ${path}: ${error instanceof Error ? error.message : String(error)}`);
		return {};
	}
	if (!isRecord(parsed)) {
		warnings.push(`Ignoring ${path}: expected a JSON object.`);
		return {};
	}
	return parsed;
}

function isBackgroundWait(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isCrashRecoveries(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/** First valid value in precedence order (project, then user), else the default. */
function resolveKey(
	key: keyof BackgroundWorkPolicy,
	files: PolicyFile[],
	rule: string,
	isValid: (value: unknown) => value is number,
	warnings: string[],
): number {
	let resolved: number | undefined;
	for (const file of files) {
		const value = file.values[key];
		if (value === undefined) continue;
		if (isValid(value)) resolved ??= value;
		else warnings.push(`Ignoring ${key} in ${file.path}: must be ${rule}.`);
	}
	return resolved ?? DEFAULT_POLICY[key];
}

/** Read on every call so edits apply without a restart. Never throws. */
export function readBackgroundWorkPolicy(options: { cwd: string; agentDir?: string }): BackgroundWorkPolicyResult {
	const warnings: string[] = [];
	const files = [join(options.cwd, ".pi", POLICY_FILE), join(options.agentDir ?? agentDirectory(), POLICY_FILE)].map(
		(path): PolicyFile => ({ path, values: readPolicyFile(path, warnings) }),
	);
	return {
		policy: {
			maxBackgroundWait: resolveKey("maxBackgroundWait", files, "a finite number greater than 0", isBackgroundWait, warnings),
			maxCrashRecoveries: resolveKey("maxCrashRecoveries", files, "an integer 0 or greater", isCrashRecoveries, warnings),
		},
		warnings,
	};
}

/** Trigger a recovery wake while the item has been interrupted at most `maxCrashRecoveries` times in a row. */
export function crashRecoveryDecision(consecutiveInterruptions: number, policy: BackgroundWorkPolicy): CrashRecoveryDecision {
	if (consecutiveInterruptions <= policy.maxCrashRecoveries) return { triggerTurn: true };
	const times = consecutiveInterruptions === 1 ? "time" : "times";
	return {
		triggerTurn: false,
		note: `interrupted ${consecutiveInterruptions} ${times} by a crash; ask the user before resuming`,
	};
}
