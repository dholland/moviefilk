import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import KramerMoviefilk from "../routes/index.tsx";

const useVoiceAgentMock = vi.fn();
vi.mock("@cloudflare/voice/react", () => ({
	useVoiceAgent: (options: { agent: string }) => useVoiceAgentMock(options),
}));

const useMicPermissionMock = vi.fn();
vi.mock("../hooks/useMicPermission", () => ({
	useMicPermission: () => useMicPermissionMock(),
}));

describe("KramerMoviefilk", () => {
	beforeEach(() => {
		useVoiceAgentMock.mockReset();
		useMicPermissionMock.mockReset();
		useMicPermissionMock.mockReturnValue({
			state: "prompt",
			lastErrorReason: null,
			request: vi.fn(),
		});
	});

	it("shows connect and standby when the voice client is not connected", () => {
		useVoiceAgentMock.mockReturnValue({
			status: "idle",
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
		});
		render(<KramerMoviefilk />);
		expect(useVoiceAgentMock).toHaveBeenCalledWith({
			agent: "KramerVoiceAgent",
		});
		expect(screen.getByText("○ STANDBY")).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: /CONNECT/i }),
		).toBeInTheDocument();
	});

	it("surfaces a line trouble message when the hook reports an error", async () => {
		useVoiceAgentMock.mockReturnValue({
			status: "idle",
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
			error: "mic denied",
			lastCustomMessage: null,
		});
		render(<KramerMoviefilk />);
		await waitFor(() => {
			expect(screen.getByText("LINE TROUBLE — TRY AGAIN")).toBeInTheDocument();
		});
	});

	it("shows partial STT in the footer when listening and interim text exists", () => {
		useVoiceAgentMock.mockReturnValue({
			status: "listening",
			transcript: [],
			interimTranscript: "hello mov",
			metrics: null,
			audioLevel: 0.2,
			startCall: vi.fn().mockResolvedValue(undefined),
			endCall: vi.fn(),
			toggleMute: vi.fn(),
			sendText: vi.fn(),
			sendJSON: vi.fn(),
			isMuted: false,
			connected: true,
			error: null,
			lastCustomMessage: null,
		});
		render(<KramerMoviefilk />);
		expect(screen.getByText("hello mov")).toBeInTheDocument();
	});
});
