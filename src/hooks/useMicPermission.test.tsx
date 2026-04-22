import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MicPermissionStateType } from "../lib/mic-permissions";

const detectMicEnvironmentMock = vi.fn();
const subscribeMicPermissionMock = vi.fn();
const probeMicAccessMock = vi.fn();

vi.mock("../lib/mic-permissions", async () => {
	const actual = await vi.importActual<
		typeof import("../lib/mic-permissions")
	>("../lib/mic-permissions");
	return {
		...actual,
		detectMicEnvironment: () => detectMicEnvironmentMock(),
		subscribeMicPermission: () => subscribeMicPermissionMock(),
		probeMicAccess: () => probeMicAccessMock(),
	};
});

// Imported AFTER vi.mock so the hook picks up the mocked module.
import { useMicPermission } from "./useMicPermission";

/**
 * A real `EventTarget` wrapped with the readonly-ish shape of
 * `PermissionStatus` so `addEventListener`/`removeEventListener`/`dispatchEvent`
 * behave exactly like the browser API. Structural typing lets the hook treat
 * the returned object as a `PermissionStatus` without any casts.
 */
function createMockStatus(initial: PermissionState) {
	const target = new EventTarget();
	return Object.assign(target, {
		name: "microphone",
		state: initial,
		onchange: null,
	});
}

beforeEach(() => {
	detectMicEnvironmentMock.mockReset();
	subscribeMicPermissionMock.mockReset();
	probeMicAccessMock.mockReset();
	detectMicEnvironmentMock.mockReturnValue("ok");
	subscribeMicPermissionMock.mockResolvedValue(null);
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("useMicPermission", () => {
	it("settles to 'granted' when the Permissions API reports granted on mount", async () => {
		subscribeMicPermissionMock.mockResolvedValue(createMockStatus("granted"));

		const { result } = renderHook(() => useMicPermission());

		await waitFor(() => {
			expect(result.current.state).toBe("granted");
		});
		expect(result.current.lastErrorReason).toBeNull();
	});

	it("falls back to 'prompt' when the Permissions API is unsupported", async () => {
		subscribeMicPermissionMock.mockResolvedValue(null);

		const { result } = renderHook(() => useMicPermission());

		await waitFor(() => {
			expect(result.current.state).toBe("prompt");
		});
	});

	it("transitions to 'granted' when request() probes successfully", async () => {
		subscribeMicPermissionMock.mockResolvedValue(null);
		probeMicAccessMock.mockResolvedValue({ ok: true });

		const { result } = renderHook(() => useMicPermission());

		await waitFor(() => {
			expect(result.current.state).toBe("prompt");
		});

		let resolved: MicPermissionStateType = "prompt";
		await act(async () => {
			resolved = await result.current.request();
		});

		expect(resolved).toBe("granted");
		expect(result.current.state).toBe("granted");
		expect(probeMicAccessMock).toHaveBeenCalledTimes(1);
	});

	it("reports 'insecure-context' on mount without calling the probe", async () => {
		detectMicEnvironmentMock.mockReturnValue("insecure-context");

		const { result } = renderHook(() => useMicPermission());

		await waitFor(() => {
			expect(result.current.state).toBe("insecure-context");
		});

		let resolved: MicPermissionStateType = "prompt";
		await act(async () => {
			resolved = await result.current.request();
		});

		expect(resolved).toBe("insecure-context");
		expect(probeMicAccessMock).not.toHaveBeenCalled();
		expect(result.current.lastErrorReason).toMatch(/HTTPS/i);
	});

	it("reports 'unsupported' on mount and short-circuits request()", async () => {
		detectMicEnvironmentMock.mockReturnValue("unsupported");

		const { result } = renderHook(() => useMicPermission());

		await waitFor(() => {
			expect(result.current.state).toBe("unsupported");
		});

		await act(async () => {
			await result.current.request();
		});

		expect(probeMicAccessMock).not.toHaveBeenCalled();
	});

	it("transitions to 'denied' and sets lastErrorReason when request() is denied", async () => {
		probeMicAccessMock.mockResolvedValue({ ok: false, state: "denied" });

		const { result } = renderHook(() => useMicPermission());

		await act(async () => {
			await result.current.request();
		});

		expect(result.current.state).toBe("denied");
		expect(result.current.lastErrorReason).toMatch(/blocked|browser settings/i);
	});

	it("updates state live when the PermissionStatus fires a change event", async () => {
		const status = createMockStatus("prompt");
		subscribeMicPermissionMock.mockResolvedValue(status);

		const { result } = renderHook(() => useMicPermission());

		await waitFor(() => {
			expect(result.current.state).toBe("prompt");
		});

		act(() => {
			status.state = "denied";
			status.dispatchEvent(new Event("change"));
		});

		await waitFor(() => {
			expect(result.current.state).toBe("denied");
		});
	});

	it("detaches the change listener on unmount", async () => {
		const status = createMockStatus("prompt");
		const removeSpy = vi.spyOn(status, "removeEventListener");
		subscribeMicPermissionMock.mockResolvedValue(status);

		const { result, unmount } = renderHook(() => useMicPermission());

		await waitFor(() => {
			expect(result.current.state).toBe("prompt");
		});

		unmount();

		expect(removeSpy).toHaveBeenCalledWith("change", expect.any(Function));
	});
});
