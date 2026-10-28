/*
 * The pi extension surface this package uses, typed structurally: the entry
 * point imports nothing from the host, so the package needs no runtime or peer
 * dependency on it (the same approach as src/session.ts for SessionManager).
 */

/** Structural view of `ExtensionUIContext`'s status setter and friends. */
export interface HostUI {
	/** Set or clear one footer status line. Pass `undefined` to clear. */
	setStatus(key: string, text: string | undefined): void;
}

/** Structural view of pi's `ReadonlySessionManager` (see src/session.ts). */
export interface HostSessionManager {
	getSessionId(): string;
	getSessionFile(): string | undefined;
}

/** Structural view of pi's `ExtensionContext` as far as this package needs it. */
export interface HostContext {
	readonly hasUI: boolean;
	readonly ui: HostUI;
	readonly sessionManager: HostSessionManager;
}

/** Structural view of pi's `ExtensionAPI` event subscription. */
export interface HostExtensionApi {
	on(event: "session_start" | "agent_settled" | "session_shutdown", handler: (event: unknown, ctx: HostContext) => void): unknown;
}
