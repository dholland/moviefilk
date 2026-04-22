/**
 * Browser microphone capability, permission, and probe utilities.
 *
 * Pure browser-API wrappers; no React dependency. Each helper is written so it
 * can be unit-tested by substituting `window`/`navigator` globals.
 *
 * The error taxonomy here is the single source of truth for mapping
 * `DOMException.name` values to our user-facing state strings. If you extend
 * the taxonomy, update `classifyMicError` and the exported type union
 * together.
 */

export type MicPermissionStateType =
	| "granted"
	| "prompt"
	| "denied"
	| "no-device"
	| "in-use"
	| "insecure-context"
	| "unsupported"
	| "unknown";

/**
 * The subset of `MicPermissionStateType` that represents a failed probe.
 * `granted` and `prompt` are intentionally excluded — a probe that resolves
 * successfully yields `granted`, and `prompt` is only ever a pre-probe state
 * reported by the Permissions API.
 */
export type MicFailureStateType = Exclude<
	MicPermissionStateType,
	"granted" | "prompt"
>;

export type MicProbeResultType =
	| { ok: true }
	| { ok: false; state: MicFailureStateType };

export type MicEnvironmentType = "ok" | "insecure-context" | "unsupported";

export function detectMicEnvironment(): MicEnvironmentType {
	if (typeof window !== "undefined" && window.isSecureContext === false) {
		return "insecure-context";
	}
	if (
		typeof navigator === "undefined" ||
		!navigator.mediaDevices ||
		typeof navigator.mediaDevices.getUserMedia !== "function"
	) {
		return "unsupported";
	}
	return "ok";
}

export function isMicSupported(): boolean {
	return detectMicEnvironment() === "ok";
}

/**
 * One-shot query of the Permissions API for the `microphone` descriptor.
 * Returns `null` when the API is absent OR when the descriptor is rejected
 * (e.g., historical Firefox builds that did not recognize "microphone").
 * Callers should treat `null` as "unknown — fall back to probe".
 */
export async function queryMicPermission(): Promise<MicPermissionStateType | null> {
	const status = await getPermissionStatus();
	return status ? normalizePermissionState(status.state) : null;
}

/**
 * Sibling helper to `queryMicPermission` that returns the raw `PermissionStatus`
 * so callers can subscribe to `change` events and react to live updates
 * (R6 in the plan). Returns `null` in the same cases as `queryMicPermission`.
 */
export async function subscribeMicPermission(): Promise<PermissionStatus | null> {
	return getPermissionStatus();
}

async function getPermissionStatus(): Promise<PermissionStatus | null> {
	if (typeof navigator === "undefined" || !navigator.permissions) {
		return null;
	}
	try {
		const descriptor: PermissionDescriptor = { name: "microphone" };
		return await navigator.permissions.query(descriptor);
	} catch {
		return null;
	}
}

function normalizePermissionState(
	state: PermissionState,
): MicPermissionStateType {
	switch (state) {
		case "granted":
			return "granted";
		case "denied":
			return "denied";
		case "prompt":
			return "prompt";
	}
}

/**
 * Attempts to acquire the mic with the loosest possible constraints
 * (`{ audio: true }`) so that a probe-pass is a strict superset of what the
 * `@cloudflare/voice` library will itself request. Stops all tracks
 * immediately on success — we only want to learn if access is granted, not
 * hold the device.
 */
export async function probeMicAccess(): Promise<MicProbeResultType> {
	const env = detectMicEnvironment();
	if (env !== "ok") {
		return { ok: false, state: env };
	}
	try {
		const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
		for (const track of stream.getTracks()) {
			track.stop();
		}
		return { ok: true };
	} catch (caught) {
		return { ok: false, state: classifyMicError(caught) };
	}
}

/**
 * Single source of truth for mapping a thrown value (typically a
 * `DOMException`) into a user-facing failure state.
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia#exceptions
 */
export function classifyMicError(err: unknown): MicFailureStateType {
	const name = getErrorName(err);
	switch (name) {
		case "NotAllowedError":
		case "SecurityError":
			return "denied";
		case "NotFoundError":
		case "OverconstrainedError":
			return "no-device";
		case "NotReadableError":
		case "AbortError":
			return "in-use";
		default:
			return "unknown";
	}
}

function getErrorName(err: unknown): string {
	if (err instanceof Error) {
		return err.name;
	}
	if (err !== null && typeof err === "object" && "name" in err) {
		const candidate = err.name;
		if (typeof candidate === "string") {
			return candidate;
		}
	}
	return "";
}

export function describeMicState(state: MicPermissionStateType): string {
	switch (state) {
		case "granted":
			return "Microphone access granted.";
		case "prompt":
			return "Microphone access will be requested.";
		case "denied":
			return "Microphone blocked. Unlock it in your browser settings.";
		case "no-device":
			return "No microphone detected.";
		case "in-use":
			return "Microphone is in use by another app.";
		case "insecure-context":
			return "Microphone requires an HTTPS (or localhost) page.";
		case "unsupported":
			return "This browser does not support microphone capture.";
		case "unknown":
			return "Something unexpected blocked microphone access.";
	}
}
