import { act, fireEvent, render, screen } from "@testing-library/react";
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	type Mock,
	vi,
} from "vitest";

import type { MicPermissionStateType } from "../lib/mic-permissions";
import KramerMoviefilk from "./index";

const useVoiceAgentMock = vi.fn();
vi.mock("@cloudflare/voice/react", () => ({
	useVoiceAgent: (options: { agent: string }) => useVoiceAgentMock(options),
}));

const useMicPermissionMock = vi.fn();
vi.mock("../hooks/useMicPermission", () => ({
	useMicPermission: () => useMicPermissionMock(),
}));

type MicOverrideType = {
	state: MicPermissionStateType;
	lastErrorReason?: string | null;
	request?: Mock;
};

function mockMic(overrides: MicOverrideType) {
	const request = overrides.request ?? vi.fn();
	useMicPermissionMock.mockReturnValue({
		state: overrides.state,
		lastErrorReason: overrides.lastErrorReason ?? null,
		request,
	});
	return request;
}

function mockVoice(overrides: Partial<ReturnType<typeof voiceDefaults>> = {}) {
	const base = voiceDefaults();
	useVoiceAgentMock.mockReturnValue({ ...base, ...overrides });
	return { ...base, ...overrides };
}

function voiceDefaults() {
	return {
		status: "idle" as const,
		transcript: [],
		interimTranscript: null,
		metrics: null,
		audioLevel: 0,
		startCall: vi.fn().mockResolvedValue(undefined),
		endCall: vi.fn(),
		toggleMute: vi.fn(),
		sendText: vi.fn(),
		sendJSON: vi.fn(),
		isMuted: false,
		connected: false,
		error: null,
		lastCustomMessage: null,
	};
}

beforeEach(() => {
	useVoiceAgentMock.mockReset();
	useMicPermissionMock.mockReset();
	mockVoice();
	mockMic({ state: "prompt" });
});

afterEach(() => {
	vi.useRealTimers();
});

describe("KramerMoviefilk — mic permission UX", () => {
	it("shows the standard lift-receiver copy when mic is in 'prompt' state", () => {
		mockMic({ state: "prompt" });
		render(<KramerMoviefilk />);
		expect(screen.getByText("LIFT RECEIVER TO CONNECT")).toBeInTheDocument();
		const button = screen.getByRole("button", { name: /CONNECT/i });
		expect(button).toBeEnabled();
	});

	it.each([
		["insecure-context", "HTTPS REQUIRED — OPEN ON A SECURE PAGE"],
		["unsupported", "BROWSER CAN'T REACH THE MIC"],
		["no-device", "NO MIC DETECTED — PLUG ONE IN"],
		["in-use", "MIC IN USE BY ANOTHER APP — CLOSE IT AND RETRY"],
		["denied", "MIC BLOCKED — UNLOCK IN BROWSER SETTINGS"],
	] as const)("renders the correct status copy when mic state is '%s'", (state, copy) => {
		mockMic({ state });
		render(<KramerMoviefilk />);
		expect(screen.getByText(copy)).toBeInTheDocument();
	});

	it("renders the recovery panel with a working RETRY button when denied", () => {
		const request = mockMic({
			state: "denied",
			lastErrorReason: "Microphone blocked.",
		});
		render(<KramerMoviefilk />);

		expect(screen.getByTestId("mic-recovery-panel")).toBeInTheDocument();
		const retryButton = screen.getByRole("button", { name: /RETRY/i });
		fireEvent.click(retryButton);
		expect(request).toHaveBeenCalledTimes(1);
	});

	it("renders the recovery panel for 'in-use' with retry", () => {
		mockMic({ state: "in-use" });
		render(<KramerMoviefilk />);
		expect(screen.getByTestId("mic-recovery-panel")).toBeInTheDocument();
		expect(
			screen.getByText(/another app is using the mic/i),
		).toBeInTheDocument();
	});

	it("renders the recovery panel for 'no-device' with retry", () => {
		mockMic({ state: "no-device" });
		render(<KramerMoviefilk />);
		expect(screen.getByTestId("mic-recovery-panel")).toBeInTheDocument();
		expect(
			screen.getByText(/plug in or enable a microphone/i),
		).toBeInTheDocument();
	});

	it("does NOT render the recovery panel for 'insecure-context' (not recoverable via button)", () => {
		mockMic({ state: "insecure-context" });
		render(<KramerMoviefilk />);
		expect(screen.queryByTestId("mic-recovery-panel")).not.toBeInTheDocument();
	});

	it("disables CONNECT when the environment is insecure and does not fire startCall", () => {
		const voice = mockVoice();
		const request = mockMic({ state: "insecure-context" });
		render(<KramerMoviefilk />);

		const button = screen.getByRole("button", { name: /OFFLINE/i });
		expect(button).toBeDisabled();
		fireEvent.click(button);
		expect(request).not.toHaveBeenCalled();
		expect(voice.startCall).not.toHaveBeenCalled();
	});

	it("disables CONNECT when mic is permanently denied and does not call request on click", () => {
		const request = mockMic({ state: "denied" });
		render(<KramerMoviefilk />);

		// With denied, CONNECT is disabled (non-muted variant) — the RETRY
		// button inside the recovery panel is the way to re-attempt.
		const connectButtons = screen
			.getAllByRole("button")
			.filter((btn) => /CONNECT/i.test(btn.textContent ?? ""));
		expect(connectButtons[0]).toBeDisabled();

		fireEvent.click(connectButtons[0]);
		expect(request).not.toHaveBeenCalled();
	});

	it("gives voice-hook error precedence over mic state in the footer status", () => {
		mockVoice({ error: "server boom", connected: false });
		mockMic({ state: "granted" });
		render(<KramerMoviefilk />);

		expect(screen.getByText("LINE TROUBLE — TRY AGAIN")).toBeInTheDocument();
	});

	it("clears the recovery panel when mic state transitions from denied to prompt", () => {
		mockMic({ state: "denied" });
		const { rerender } = render(<KramerMoviefilk />);
		expect(screen.getByTestId("mic-recovery-panel")).toBeInTheDocument();

		mockMic({ state: "prompt" });
		rerender(<KramerMoviefilk />);

		expect(screen.queryByTestId("mic-recovery-panel")).not.toBeInTheDocument();
		expect(screen.getByText("LIFT RECEIVER TO CONNECT")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /CONNECT/i })).toBeEnabled();
	});

	it("requests mic, waits for the 2s ringing animation, then calls startCall on success", async () => {
		vi.useFakeTimers();
		const request = vi.fn().mockResolvedValue("granted");
		const voice = mockVoice();
		mockMic({ state: "prompt", request });
		render(<KramerMoviefilk />);

		const button = screen.getByRole("button", { name: /CONNECT/i });

		await act(async () => {
			fireEvent.click(button);
			// Let the awaited request() microtasks flush.
			await Promise.resolve();
			await Promise.resolve();
		});

		expect(request).toHaveBeenCalledTimes(1);
		expect(voice.startCall).not.toHaveBeenCalled();

		await act(async () => {
			vi.advanceTimersByTime(2000);
		});
		// `startCall` resolves, then `queueMicrotask` runs the PTT default-mute.
		await act(async () => {
			await Promise.resolve();
			await Promise.resolve();
		});

		expect(voice.startCall).toHaveBeenCalledTimes(1);
		expect(voice.toggleMute).toHaveBeenCalledTimes(1);
	});

	it("still shows CONNECT and STANDBY when the WebSocket is already connected on load", () => {
		mockVoice({ connected: true, status: "idle" });
		mockMic({ state: "prompt" });
		render(<KramerMoviefilk />);

		expect(screen.getByText("○ STANDBY")).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: /CONNECT/i }),
		).toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: /HANG UP/i }),
		).not.toBeInTheDocument();
	});

	it("HANG UP ends the session and returns to CONNECT", async () => {
		vi.useFakeTimers();
		const request = vi.fn().mockResolvedValue("granted");
		const voice = mockVoice({ connected: true });
		mockMic({ state: "prompt", request });
		const { rerender } = render(<KramerMoviefilk />);

		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: /CONNECT/i }));
			await Promise.resolve();
			await Promise.resolve();
		});
		await act(async () => {
			vi.advanceTimersByTime(2000);
		});
		await act(async () => {
			await Promise.resolve();
			await Promise.resolve();
		});

		expect(voice.startCall).toHaveBeenCalledTimes(1);
		expect(voice.toggleMute).toHaveBeenCalledTimes(1);
		mockVoice({ ...voice, isMuted: true, status: "idle", connected: true });
		rerender(<KramerMoviefilk />);
		expect(
			screen.getByText("MIC OFF — TAP THE MIC BUTTON TO SPEAK"),
		).toBeInTheDocument();

		const hangUp = screen.getByRole("button", { name: /HANG UP/i });
		fireEvent.click(hangUp);
		expect(voice.endCall).toHaveBeenCalledTimes(1);

		expect(
			screen.getByRole("button", { name: /CONNECT/i }),
		).toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: /HANG UP/i }),
		).not.toBeInTheDocument();
	});

	it("does not PTT arm toggle when startCall rejects", async () => {
		vi.useFakeTimers();
		const request = vi.fn().mockResolvedValue("granted");
		const startCall = vi.fn().mockRejectedValue(new Error("ws failed"));
		const voice = mockVoice({ startCall, connected: true });
		mockMic({ state: "prompt", request });
		render(<KramerMoviefilk />);

		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: /CONNECT/i }));
			await Promise.resolve();
			await Promise.resolve();
		});
		await act(async () => {
			vi.advanceTimersByTime(2000);
		});
		await act(async () => {
			await Promise.resolve();
			await Promise.resolve();
		});

		expect(startCall).toHaveBeenCalledTimes(1);
		expect(voice.toggleMute).not.toHaveBeenCalled();
	});

	it("skips ringing and startCall when the mic request resolves to denied", async () => {
		vi.useFakeTimers();
		const request = vi.fn().mockResolvedValue("denied");
		const voice = mockVoice();
		mockMic({ state: "prompt", request });
		render(<KramerMoviefilk />);

		const button = screen.getByRole("button", { name: /CONNECT/i });

		await act(async () => {
			fireEvent.click(button);
			await Promise.resolve();
			await Promise.resolve();
		});

		expect(request).toHaveBeenCalledTimes(1);
		await act(async () => {
			vi.advanceTimersByTime(2000);
		});
		expect(voice.startCall).not.toHaveBeenCalled();
	});
});
