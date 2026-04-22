import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	classifyMicError,
	detectMicEnvironment,
	isMicSupported,
	probeMicAccess,
	queryMicPermission,
	subscribeMicPermission,
} from "./mic-permissions";

type GetUserMediaSpy = ReturnType<typeof vi.fn>;
type PermissionsQuerySpy = ReturnType<typeof vi.fn>;

function makeTrack() {
	return { stop: vi.fn() };
}

function installMediaDevices(getUserMedia: GetUserMediaSpy) {
	Object.defineProperty(navigator, "mediaDevices", {
		configurable: true,
		value: { getUserMedia },
	});
}

function clearMediaDevices() {
	Object.defineProperty(navigator, "mediaDevices", {
		configurable: true,
		value: undefined,
	});
}

function installPermissions(query: PermissionsQuerySpy) {
	Object.defineProperty(navigator, "permissions", {
		configurable: true,
		value: { query },
	});
}

function clearPermissions() {
	Object.defineProperty(navigator, "permissions", {
		configurable: true,
		value: undefined,
	});
}

function setSecureContext(secure: boolean) {
	Object.defineProperty(window, "isSecureContext", {
		configurable: true,
		value: secure,
	});
}

beforeEach(() => {
	setSecureContext(true);
});

afterEach(() => {
	clearMediaDevices();
	clearPermissions();
	setSecureContext(true);
});

describe("detectMicEnvironment", () => {
	it("returns 'insecure-context' when the page is not a secure context", () => {
		setSecureContext(false);
		installMediaDevices(vi.fn());
		expect(detectMicEnvironment()).toBe("insecure-context");
	});

	it("returns 'unsupported' when navigator.mediaDevices is missing", () => {
		clearMediaDevices();
		expect(detectMicEnvironment()).toBe("unsupported");
	});

	it("returns 'unsupported' when getUserMedia is not a function", () => {
		Object.defineProperty(navigator, "mediaDevices", {
			configurable: true,
			value: {},
		});
		expect(detectMicEnvironment()).toBe("unsupported");
	});

	it("returns 'ok' when running in a secure context with getUserMedia", () => {
		installMediaDevices(vi.fn());
		expect(detectMicEnvironment()).toBe("ok");
		expect(isMicSupported()).toBe(true);
	});
});

describe("queryMicPermission", () => {
	it("returns null when navigator.permissions is missing", async () => {
		clearPermissions();
		await expect(queryMicPermission()).resolves.toBeNull();
	});

	it("returns null when permissions.query rejects (unsupported descriptor)", async () => {
		const query = vi.fn().mockRejectedValue(new TypeError("bad descriptor"));
		installPermissions(query);
		await expect(queryMicPermission()).resolves.toBeNull();
		expect(query).toHaveBeenCalledWith({ name: "microphone" });
	});

	it.each(["granted", "denied", "prompt"] as const)(
		"returns '%s' when the Permissions API reports that state",
		async (state) => {
			const query = vi.fn().mockResolvedValue({ state });
			installPermissions(query);
			await expect(queryMicPermission()).resolves.toBe(state);
		},
	);
});

describe("subscribeMicPermission", () => {
	it("returns the raw PermissionStatus when available", async () => {
		const status = { state: "prompt" };
		const query = vi.fn().mockResolvedValue(status);
		installPermissions(query);
		await expect(subscribeMicPermission()).resolves.toBe(status);
	});

	it("returns null when permissions.query rejects", async () => {
		installPermissions(vi.fn().mockRejectedValue(new Error("nope")));
		await expect(subscribeMicPermission()).resolves.toBeNull();
	});
});

describe("probeMicAccess", () => {
	it("resolves ok and stops every track on success", async () => {
		const trackOne = makeTrack();
		const trackTwo = makeTrack();
		const stream = { getTracks: () => [trackOne, trackTwo] };
		const getUserMedia = vi.fn().mockResolvedValue(stream);
		installMediaDevices(getUserMedia);

		const result = await probeMicAccess();

		expect(result).toEqual({ ok: true });
		expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
		expect(trackOne.stop).toHaveBeenCalledTimes(1);
		expect(trackTwo.stop).toHaveBeenCalledTimes(1);
	});

	it("classifies NotAllowedError as 'denied'", async () => {
		const err = new DOMException("denied", "NotAllowedError");
		installMediaDevices(vi.fn().mockRejectedValue(err));
		await expect(probeMicAccess()).resolves.toEqual({
			ok: false,
			state: "denied",
		});
	});

	it("classifies SecurityError as 'denied'", async () => {
		installMediaDevices(
			vi.fn().mockRejectedValue(new DOMException("blocked", "SecurityError")),
		);
		await expect(probeMicAccess()).resolves.toEqual({
			ok: false,
			state: "denied",
		});
	});

	it("classifies NotFoundError as 'no-device'", async () => {
		installMediaDevices(
			vi.fn().mockRejectedValue(new DOMException("none", "NotFoundError")),
		);
		await expect(probeMicAccess()).resolves.toEqual({
			ok: false,
			state: "no-device",
		});
	});

	it("classifies OverconstrainedError as 'no-device'", async () => {
		installMediaDevices(
			vi
				.fn()
				.mockRejectedValue(new DOMException("constraints", "OverconstrainedError")),
		);
		await expect(probeMicAccess()).resolves.toEqual({
			ok: false,
			state: "no-device",
		});
	});

	it("classifies NotReadableError as 'in-use'", async () => {
		installMediaDevices(
			vi.fn().mockRejectedValue(new DOMException("busy", "NotReadableError")),
		);
		await expect(probeMicAccess()).resolves.toEqual({
			ok: false,
			state: "in-use",
		});
	});

	it("classifies AbortError as 'in-use'", async () => {
		installMediaDevices(
			vi.fn().mockRejectedValue(new DOMException("aborted", "AbortError")),
		);
		await expect(probeMicAccess()).resolves.toEqual({
			ok: false,
			state: "in-use",
		});
	});

	it("classifies unrelated errors as 'unknown'", async () => {
		installMediaDevices(vi.fn().mockRejectedValue(new TypeError("bad")));
		await expect(probeMicAccess()).resolves.toEqual({
			ok: false,
			state: "unknown",
		});
	});

	it("short-circuits to 'insecure-context' without calling getUserMedia", async () => {
		setSecureContext(false);
		const getUserMedia = vi.fn();
		installMediaDevices(getUserMedia);
		await expect(probeMicAccess()).resolves.toEqual({
			ok: false,
			state: "insecure-context",
		});
		expect(getUserMedia).not.toHaveBeenCalled();
	});

	it("short-circuits to 'unsupported' when mediaDevices is missing", async () => {
		clearMediaDevices();
		await expect(probeMicAccess()).resolves.toEqual({
			ok: false,
			state: "unsupported",
		});
	});
});

describe("classifyMicError", () => {
	it("falls back to 'unknown' for plain string throws", () => {
		expect(classifyMicError("not-an-error")).toBe("unknown");
	});

	it("reads name from plain objects exposing a string name", () => {
		expect(classifyMicError({ name: "NotReadableError" })).toBe("in-use");
	});

	it("ignores a numeric 'name' field", () => {
		expect(classifyMicError({ name: 42 })).toBe("unknown");
	});
});
