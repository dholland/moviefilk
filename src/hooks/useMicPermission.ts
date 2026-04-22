import { useCallback, useEffect, useRef, useState } from "react";
import {
	type MicPermissionStateType,
	describeMicState,
	detectMicEnvironment,
	probeMicAccess,
	subscribeMicPermission,
} from "../lib/mic-permissions";

export type UseMicPermissionReturnType = {
	state: MicPermissionStateType;
	lastErrorReason: string | null;
	request: () => Promise<MicPermissionStateType>;
};

/**
 * Exposes live microphone permission state, a `request()` action that must be
 * invoked from a user gesture, and a human-readable `lastErrorReason` for the
 * current failure (if any). Subscribes to the `PermissionStatus` `change` event
 * so the UI updates without a reload when the user toggles the permission in
 * browser settings.
 *
 * The hook never synthesizes React state after unmount: all async writes are
 * guarded by a `mountedRef` and the effect cleans up the permission listener.
 */
export function useMicPermission(): UseMicPermissionReturnType {
	const [state, setState] = useState<MicPermissionStateType>(() => {
		const env = detectMicEnvironment();
		return env === "ok" ? "prompt" : env;
	});

	const mountedRef = useRef(true);

	const applyState = useCallback((next: MicPermissionStateType) => {
		if (!mountedRef.current) return;
		setState(next);
	}, []);

	useEffect(() => {
		mountedRef.current = true;

		const env = detectMicEnvironment();
		if (env !== "ok") {
			applyState(env);
			return () => {
				mountedRef.current = false;
			};
		}

		let detach: (() => void) | null = null;

		void (async () => {
			const status = await subscribeMicPermission();
			if (!mountedRef.current) return;
			if (!status) {
				applyState("prompt");
				return;
			}
			// `PermissionState` is exactly "granted" | "denied" | "prompt",
			// a strict subset of `MicPermissionStateType`, so no assertion needed.
			applyState(status.state);
			const handler = () => applyState(status.state);
			status.addEventListener("change", handler);
			detach = () => {
				status.removeEventListener("change", handler);
			};
		})();

		return () => {
			mountedRef.current = false;
			if (detach) detach();
		};
	}, [applyState]);

	const request = useCallback(async (): Promise<MicPermissionStateType> => {
		const env = detectMicEnvironment();
		if (env !== "ok") {
			applyState(env);
			return env;
		}

		const result = await probeMicAccess();
		const nextState: MicPermissionStateType = result.ok
			? "granted"
			: result.state;
		applyState(nextState);
		return nextState;
	}, [applyState]);

	const lastErrorReason =
		state === "granted" || state === "prompt" ? null : describeMicState(state);

	return { state, lastErrorReason, request };
}
