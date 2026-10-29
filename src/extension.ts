/*
 * The background-work footer: one status line for the pending work of the
 * current session, whichever extension holds it. `import type` only, so the
 * host package is a peer dependency and nothing is bundled.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { collectBackgroundWorkSources } from "./collect";
import { type BackgroundWorkDisplayProvider, listBackgroundWorkDisplayProviders } from "./display";
import { BACKGROUND_WORK_STATUS_KEY, composeFooterText } from "./footer";
import { sessionIdentityForms } from "./session";

const TICK_INTERVAL_MS = 1_000;

function readDisplays(): readonly BackgroundWorkDisplayProvider[] {
	try {
		return listBackgroundWorkDisplayProviders();
	} catch {
		return [];
	}
}

export default function backgroundWorkFooter(pi: ExtensionAPI): void {
	let timer: ReturnType<typeof setTimeout> | undefined;
	let lastText: string | undefined;

	const stopTick = (): void => {
		if (timer !== undefined) clearTimeout(timer);
		timer = undefined;
	};

	/**
	 * Render once. Synchronous, in three guarded parts: read the session, then
	 * collect without a context, then write. A throw while reading or writing
	 * means the context is dead, so the tick stops instead of throwing inside a
	 * timer callback, which pi does not catch.
	 */
	const render = (ctx: ExtensionContext): boolean => {
		let forms: string[];
		try {
			forms = sessionIdentityForms(ctx.sessionManager);
		} catch {
			return false;
		}
		const nowMs = Date.now();
		let text: string | undefined;
		try {
			const [sessionId] = forms;
			text = sessionId === undefined
				? undefined
				: composeFooterText(collectBackgroundWorkSources(forms, nowMs), readDisplays(), { sessionId, sessionIds: forms, nowMs });
		} catch {
			// A provider or display provider whose own getters throw must not reach the
			// timer callback, which pi does not catch; keep what is on screen.
			text = lastText;
		}
		if (text === lastText) return true;
		try {
			ctx.ui.setStatus(BACKGROUND_WORK_STATUS_KEY, text);
		} catch {
			return false;
		}
		lastText = text;
		return true;
	};

	/** Render now and re-arm the 1 s chain, on the freshly captured context. */
	const arm = (ctx: ExtensionContext): void => {
		stopTick();
		if (!ctx.hasUI) return;
		const run = (): void => {
			timer = undefined;
			if (!render(ctx)) return;
			timer = setTimeout(run, TICK_INTERVAL_MS);
			timer.unref();
		};
		run();
	};

	pi.on("session_start", (_event, ctx) => {
		lastText = undefined;
		arm(ctx);
	});

	pi.on("agent_settled", (_event, ctx) => {
		arm(ctx);
	});

	pi.on("session_shutdown", (_event, ctx) => {
		stopTick();
		lastText = undefined;
		if (!ctx.hasUI) return;
		try {
			ctx.ui.setStatus(BACKGROUND_WORK_STATUS_KEY, undefined);
		} catch {}
	});
}
