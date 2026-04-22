import { useVoiceAgent } from "@cloudflare/voice/react";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useMicPermission } from "../hooks/useMicPermission";
import type { MicPermissionStateType } from "../lib/mic-permissions";

const RETRO_MOVIES = [
	"PULP FICTION",
	"THE MATRIX",
	"GOODFELLAS",
	"JURASSIC PARK",
	"HOME ALONE",
	"TITANIC",
	"THE LION KING",
	"FORREST GUMP",
	"SCHINDLER'S LIST",
	"SPEED",
	"DIE HARD",
	"TERMINATOR 2",
	"SILENCE OF THE LAMBS",
	"BRAVEHEART",
	"SEVEN",
];

type MessageType = { id: string; role: "user" | "assistant"; text: string };

/**
 * Copy for each mic permission / environment state, in status-bar uppercase.
 * Placed at module scope so tests (and future localization) can assert on
 * exact strings without reaching into component internals.
 */
const MIC_STATUS_COPY: Record<
	Exclude<MicPermissionStateType, "granted" | "prompt" | "unknown">,
	string
> = {
	"insecure-context": "HTTPS REQUIRED — OPEN ON A SECURE PAGE",
	unsupported: "BROWSER CAN'T REACH THE MIC",
	"no-device": "NO MIC DETECTED — PLUG ONE IN",
	"in-use": "MIC IN USE BY ANOTHER APP — CLOSE IT AND RETRY",
	denied: "MIC BLOCKED — UNLOCK IN BROWSER SETTINGS",
};

/**
 * States that block CONNECT entirely — CONNECT either no-ops or the user must
 * resolve the issue outside the page first (settings, hardware, HTTPS).
 */
function isMicBlocking(state: MicPermissionStateType): boolean {
	return (
		state === "insecure-context" ||
		state === "unsupported" ||
		state === "denied" ||
		state === "no-device"
	);
}

/**
 * States that warrant the in-page recovery panel with a RETRY button.
 * `insecure-context` / `unsupported` are not recoverable via a button click,
 * so they are handled by disabling CONNECT instead.
 */
function isMicRecoverable(state: MicPermissionStateType): boolean {
	return state === "denied" || state === "no-device" || state === "in-use";
}

/**
 * Best-effort AudioContext warmup that runs synchronously on the CONNECT tap.
 * iOS Safari ties media-output permission to a user activation, and the 2s
 * ringing animation that gates `startCall()` would otherwise separate the
 * tap from the library's first `AudioContext` construction.
 *
 * Silently no-ops if `AudioContext` is unavailable; any construction error is
 * swallowed because the primary flow (getUserMedia via the probe) is what
 * really matters for R1/R5 — this is belt-and-suspenders for iOS.
 */
function primeAudioContext(): void {
	if (typeof window === "undefined") return;
	if (typeof window.AudioContext !== "function") return;
	try {
		const ctx = new window.AudioContext();
		void ctx.resume();
		setTimeout(() => {
			void ctx.close();
		}, 0);
	} catch {
		// Intentionally ignored — warmup is advisory.
	}
}

export default function KramerMoviefilk() {
	const {
		status: voiceStatus,
		transcript,
		interimTranscript,
		startCall,
		endCall,
		toggleMute,
		isMuted,
		error,
		connected,
	} = useVoiceAgent({ agent: "KramerVoiceAgent" });

	const {
		state: micState,
		lastErrorReason: micLastErrorReason,
		request: micRequest,
	} = useMicPermission();

	const [phoneRinging, setPhoneRinging] = useState(false);
	/**
	 * The voice hook sets `connected` when the WebSocket to the agent is open
	 * (connect() runs on mount). That is not the same as the user having started
	 * a mic call — only this flag should drive connect vs hang-up UI.
	 */
	const [callSessionActive, setCallSessionActive] = useState(false);
	const [statusText, setStatusText] = useState("LIFT RECEIVER TO CONNECT");
	const chatRef = useRef<HTMLDivElement>(null);
	const ringTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const messages: MessageType[] = transcript.map((msg, messageIndex) => ({
		id: `${msg.timestamp}-${messageIndex}`,
		role: msg.role,
		text: msg.text,
	}));

	const tickerText = RETRO_MOVIES.join("  ✦  ");

	useEffect(() => {
		// Precedence (highest first): voice-hook error, environment problems
		// (insecure / unsupported), hardware problems (no-device / in-use),
		// permission denial, ringing animation, then the normal connected
		// voice-agent sub-states.
		if (error) {
			setStatusText("LINE TROUBLE — TRY AGAIN");
			return;
		}
		if (micState === "insecure-context") {
			setStatusText(MIC_STATUS_COPY["insecure-context"]);
			return;
		}
		if (micState === "unsupported") {
			setStatusText(MIC_STATUS_COPY.unsupported);
			return;
		}
		if (micState === "no-device") {
			setStatusText(MIC_STATUS_COPY["no-device"]);
			return;
		}
		if (micState === "in-use") {
			setStatusText(MIC_STATUS_COPY["in-use"]);
			return;
		}
		if (micState === "denied") {
			setStatusText(MIC_STATUS_COPY.denied);
			return;
		}
		if (phoneRinging) {
			setStatusText("DIALING...");
			return;
		}
		if (!callSessionActive) {
			setStatusText("LIFT RECEIVER TO CONNECT");
			return;
		}
		switch (voiceStatus) {
			case "idle":
				setStatusText("SPEAK ANY TIME — KRAMER IS ON THE LINE");
				break;
			case "listening":
				setStatusText("🎙 LISTENING...");
				break;
			case "thinking":
				setStatusText("KRAMER IS THINKING...");
				break;
			case "speaking":
				setStatusText("KRAMER IS SPEAKING...");
				break;
		}
	}, [error, micState, phoneRinging, callSessionActive, voiceStatus]);

	useEffect(() => {
		if (!connected && callSessionActive) {
			if (ringTimeoutRef.current) {
				clearTimeout(ringTimeoutRef.current);
				ringTimeoutRef.current = null;
			}
			setPhoneRinging(false);
			setCallSessionActive(false);
		}
	}, [connected, callSessionActive]);

	useEffect(() => {
		return () => {
			if (ringTimeoutRef.current) {
				clearTimeout(ringTimeoutRef.current);
			}
		};
	}, []);

	// biome-ignore lint/correctness/useExhaustiveDependencies: scroll to bottom when transcript updates
	useEffect(() => {
		if (chatRef.current) {
			chatRef.current.scrollTop = chatRef.current.scrollHeight;
		}
	}, [transcript]);

	const handleConnect = useCallback(async () => {
		// User-gesture sensitive work first (iOS Safari requires mic request and
		// AudioContext unlock to originate from the tap itself, not a setTimeout).
		primeAudioContext();

		// Terminal-bad states: UI already surfaces the recovery panel or muted
		// CONNECT button, so the tap is a no-op here.
		if (isMicBlocking(micState)) return;

		const resolved = await micRequest();
		if (resolved !== "granted") {
			// The hook has already moved into the appropriate failure state,
			// which feeds the status bar + recovery panel via precedence above.
			return;
		}

		setPhoneRinging(true);
		if (ringTimeoutRef.current) {
			clearTimeout(ringTimeoutRef.current);
		}
		ringTimeoutRef.current = setTimeout(() => {
			ringTimeoutRef.current = null;
			setPhoneRinging(false);
			setCallSessionActive(true);
			void startCall();
		}, 2000);
	}, [micState, micRequest, startCall]);

	const handleHangUp = useCallback(() => {
		if (ringTimeoutRef.current) {
			clearTimeout(ringTimeoutRef.current);
			ringTimeoutRef.current = null;
		}
		setPhoneRinging(false);
		setCallSessionActive(false);
		endCall();
	}, [endCall]);

	const handleMicRetry = useCallback(() => {
		primeAudioContext();
		void micRequest();
	}, [micRequest]);

	const isSpeaking = voiceStatus === "speaking";
	const isThinking = voiceStatus === "thinking";
	const isListenStt = voiceStatus === "listening";
	const isConnectedVisual = callSessionActive;
	const connectDisabled = phoneRinging || isMicBlocking(micState);
	const connectMuted =
		micState === "insecure-context" || micState === "unsupported";
	const showMicRecoveryPanel = !callSessionActive && isMicRecoverable(micState);

	return (
		<div className="min-h-screen bg-[#0a0a0f] font-mono flex flex-col items-center p-0 overflow-hidden relative">
			<div
				className="fixed inset-0 pointer-events-none z-100"
				style={{
					background:
						"repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.08) 2px, rgba(0,0,0,0.08) 4px)",
				}}
			/>

			<div
				className="fixed inset-0 pointer-events-none z-99"
				style={{
					background:
						"radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.7) 100%)",
				}}
			/>

			<div className="w-full bg-[#cc0000] py-1.5 overflow-hidden border-b-[3px] border-[#ff2200] relative z-10">
				<div className="flex whitespace-nowrap animate-ticker text-[#ffe000] text-[13px] font-bold tracking-[2px]">
					{["top-a", "top-b", "top-c"].map((key) => (
						<span key={key}>&nbsp;&nbsp;{tickerText}&nbsp;&nbsp;</span>
					))}
				</div>
			</div>

			<div className="w-full max-w-[680px] px-5 pt-6 text-center relative z-10">
				<div className="text-[11px] tracking-[6px] text-[#ff4400] mb-1.5 uppercase">
					☎ WELCOME TO
				</div>
				<h1
					className="text-[clamp(36px,8vw,64px)] font-serif font-black text-[#ffe000] m-0 leading-none tracking-[-1px]"
					style={{ textShadow: "3px 3px 0 #cc0000, 6px 6px 0 #880000" }}
				>
					555-<span className="text-[#ff4400]">FILK</span>
				</h1>
				<div className="text-xs text-[#999] tracking-[4px] my-6 uppercase">
					— Operated by K. Kramer, Apt. 5B —
				</div>
			</div>

			<div
				className="w-full max-w-[680px] mx-5 my-5 border-2 border-[#333] rounded relative z-10 overflow-hidden"
				style={{
					background: "linear-gradient(160deg, #1a1a24 0%, #0f0f18 100%)",
					boxShadow:
						"0 0 40px rgba(204,0,0,0.3), inset 0 0 80px rgba(0,0,0,0.5)",
				}}
			>
				<div
					className="m-5 bg-[#030a03] border-[3px] border-[#1a3a1a] rounded-sm min-h-[280px] max-h-[320px] flex flex-col overflow-hidden relative"
					style={{
						boxShadow:
							"inset 0 0 30px rgba(0,255,0,0.05), 0 0 20px rgba(0,200,0,0.1)",
					}}
				>
					<div className="bg-[#001a00] border-b border-[#0a3a0a] px-3 py-1.5 flex justify-between items-center">
						<span className="text-[#00cc00] text-[10px] tracking-[3px]">
							MOVIEFILK LIVE
						</span>
						<span
							className={`text-[10px] tracking-[2px] ${
								isConnectedVisual
									? "text-[#00ff00] animate-blink"
									: "text-[#cc4400]"
							}`}
						>
							{isConnectedVisual ? "● CONNECTED" : "○ STANDBY"}
						</span>
					</div>

					<div
						ref={chatRef}
						className="flex-1 overflow-y-auto p-3 flex flex-col gap-2.5 scrollbar-none"
						style={{ scrollbarWidth: "none" }}
					>
						{messages.length === 0 && !isThinking && (
							<div className="text-[#1a5a1a] text-xs text-center mt-[60px] leading-8">
								<div className="text-[28px] mb-2">☎</div>
								<div>PRESS CONNECT TO DIAL</div>
								<div className="text-[10px] mt-1 opacity-60">
									Kramer is standing by
								</div>
							</div>
						)}
						{messages.map((msg) => (
							<div
								key={msg.id}
								className={`flex gap-2 items-start ${
									msg.role === "user" ? "flex-row-reverse" : "flex-row"
								}`}
							>
								{msg.role === "assistant" && (
									<div className="w-7 h-7 rounded-full bg-[#1a4a1a] border border-[#2a7a2a] flex items-center justify-center text-sm shrink-0 text-[#44cc44]">
										K
									</div>
								)}
								<div
									className={`max-w-[75%] rounded-sm px-3 py-2 text-[13px] leading-relaxed font-mono ${
										msg.role === "user"
											? "bg-[#0a2a0a] border border-[#1a5a1a] text-[#88ff88]"
											: "bg-[#041204] border border-[#0a3a0a] text-[#44cc44]"
									}`}
								>
									{msg.role === "user" && (
										<div className="text-[9px] text-[#2a7a2a] mb-0.5 tracking-[2px]">
											YOU
										</div>
									)}
									{msg.text}
								</div>
							</div>
						))}
						{isThinking && (
							<div className="flex gap-2 items-center">
								<div className="w-7 h-7 rounded-full bg-[#1a4a1a] border border-[#2a7a2a] flex items-center justify-center text-sm text-[#44cc44]">
									K
								</div>
								<div className="bg-[#041204] border border-[#0a3a0a] px-3.5 py-2 rounded-sm flex gap-[5px] items-center">
									{[0, 0.2, 0.4].map((dotDelay) => (
										<div
											key={`dot-${dotDelay}`}
											className="w-1.5 h-1.5 rounded-full bg-[#44cc44] animate-dot-bounce"
											style={{ animationDelay: `${dotDelay}s` }}
										/>
									))}
								</div>
							</div>
						)}
					</div>

					<div className="border-t border-[#0a3a0a] px-3 py-1.5 bg-[#020802]">
						<div className="text-[#226622] text-[10px] tracking-[2px]">
							{isListenStt && (interimTranscript ?? "") ? (
								<span className="text-[#88ff44]">
									►{" "}
									<em className="not-italic text-[#aaff99]">
										{interimTranscript}
									</em>
								</span>
							) : error ? (
								<span className="text-[#ff6666]" title={error}>
									LINE TROUBLE — TRY AGAIN
								</span>
							) : (
								<span className="animate-blink">{statusText}</span>
							)}
						</div>
					</div>
				</div>

				<div className="px-5 pb-5 flex flex-col gap-3">
					<div className="flex gap-3 items-center flex-wrap">
						{!callSessionActive ? (
							<>
								<button
									type="button"
									onClick={handleConnect}
									disabled={connectDisabled}
									className={`flex-1 py-4 border-2 rounded-sm text-sm font-mono font-bold tracking-[3px] uppercase transition-all duration-100 ${
										connectMuted
											? "cursor-not-allowed border-[#444] text-[#888]"
											: connectDisabled
												? "cursor-not-allowed animate-shake translate-y-0.5 border-[#663300] text-[#ffe000]"
												: "cursor-pointer border-[#ff6600] text-[#ffe000]"
									}`}
									style={{
										background: connectMuted
											? "linear-gradient(180deg, #222, #111)"
											: connectDisabled
												? "linear-gradient(180deg, #442200, #331a00)"
												: "linear-gradient(180deg, #cc4400, #991100)",
										boxShadow:
											connectMuted || connectDisabled
												? "none"
												: "0 4px 0 #660000, 0 0 20px rgba(204,68,0,0.4)",
									}}
								>
									{phoneRinging
										? "☎ RINGING..."
										: connectMuted
											? "☎ OFFLINE"
											: "☎  CONNECT  ☎"}
								</button>
								{phoneRinging && (
									<button
										type="button"
										onClick={handleHangUp}
										className="py-4 px-5 border-2 border-[#660000] rounded-sm text-[#ff4444] text-[13px] font-mono font-bold tracking-[2px] cursor-pointer uppercase transition-all duration-100"
										style={{
											background: "linear-gradient(180deg, #440000, #220000)",
											boxShadow: "0 4px 0 #110000",
										}}
									>
										✕ CANCEL
									</button>
								)}
							</>
						) : (
							<>
								<button
									type="button"
									onClick={toggleMute}
									className="flex-1 py-4 border-2 rounded-sm text-[13px] font-mono font-bold tracking-[2px] uppercase transition-all duration-150 border-[#00aa22] text-[#88ff88] cursor-pointer"
									style={{
										background: isMuted
											? "linear-gradient(180deg, #442200, #220000)"
											: "linear-gradient(180deg, #006600, #004400)",
										boxShadow: isMuted ? "none" : "0 4px 0 #002200",
									}}
								>
									{isMuted ? "🔇 MUTED — UNMUTE" : "🎤 MIC ON — TAP TO MUTE"}
								</button>
								<button
									type="button"
									onClick={handleHangUp}
									className="py-4 px-5 border-2 border-[#660000] rounded-sm text-[#ff4444] text-[13px] font-mono font-bold tracking-[2px] cursor-pointer uppercase transition-all duration-100"
									style={{
										background: "linear-gradient(180deg, #440000, #220000)",
										boxShadow: "0 4px 0 #110000",
									}}
								>
									✕ HANG UP
								</button>
							</>
						)}
					</div>

					{showMicRecoveryPanel && (
						<div
							role="status"
							aria-live="polite"
							data-testid="mic-recovery-panel"
							className="border-2 border-[#663300] rounded-sm px-4 py-3 flex flex-col gap-2"
							style={{
								background: "linear-gradient(180deg, #1a0f00, #0f0700)",
								boxShadow: "inset 0 0 20px rgba(204,68,0,0.15)",
							}}
						>
							<div className="text-[#ffaa44] text-[11px] tracking-[2px] font-bold uppercase">
								{micState === "denied" && "🔒 MIC BLOCKED"}
								{micState === "no-device" && "🎤 NO MIC FOUND"}
								{micState === "in-use" && "🎤 MIC BUSY"}
							</div>
							<div className="text-[#cc9966] text-[11px] leading-relaxed">
								{micState === "denied" && (
									<>
										Click the <span aria-hidden="true">🔒</span> in your address
										bar and set <strong>Microphone</strong> to <em>Allow</em>,
										then retry.
									</>
								)}
								{micState === "no-device" &&
									"Plug in or enable a microphone, then retry."}
								{micState === "in-use" &&
									"Another app is using the mic. Close it (Zoom, Meet, browser tabs) and retry."}
							</div>
							{micLastErrorReason && (
								<div className="text-[#885533] text-[10px] italic opacity-80">
									{micLastErrorReason}
								</div>
							)}
							<button
								type="button"
								onClick={handleMicRetry}
								className="self-start mt-1 py-2 px-4 border-2 border-[#ff6600] rounded-sm text-[#ffe000] text-[11px] font-mono font-bold tracking-[2px] uppercase cursor-pointer"
								style={{
									background: "linear-gradient(180deg, #cc4400, #991100)",
									boxShadow: "0 2px 0 #660000",
								}}
							>
								↻ RETRY
							</button>
						</div>
					)}
				</div>
			</div>

			{callSessionActive && isSpeaking && (
				<div className="text-[#555] text-[10px] text-center max-w-[680px] px-5 -mt-2 mb-2 relative z-10">
					Streaming reply — you can jump in; interrupt may cancel playback.
				</div>
			)}

			<div className="text-[10px] text-[#333] tracking-[3px] text-center mb-4 relative z-10">
				555-MOVIEFILK · NOT AFFILIATED WITH THE REAL MOVIEFONE · OR NBC
			</div>

			<div className="fixed bottom-0 w-full bg-[#cc0000] py-[5px] overflow-hidden border-t-[3px] border-[#ff2200] z-10">
				<div className="flex whitespace-nowrap animate-ticker-reverse text-[#ffe000] text-xs font-bold tracking-[2px]">
					{["bot-a", "bot-b", "bot-c"].map((key) => (
						<span key={key}>
							&nbsp;&nbsp;NOW SHOWING: {RETRO_MOVIES.join("  ★  ")}
							&nbsp;&nbsp;
						</span>
					))}
				</div>
			</div>

			<style>{`
				@keyframes ticker {
					0% { transform: translateX(0); }
					100% { transform: translateX(-33.33%); }
				}
				@keyframes ticker-reverse {
					0% { transform: translateX(-33.33%); }
					100% { transform: translateX(0); }
				}
				@keyframes blink {
					0%, 100% { opacity: 1; }
					50% { opacity: 0.3; }
				}
				@keyframes dot-bounce {
					0%, 100% { transform: translateY(0); opacity: 0.4; }
					50% { transform: translateY(-4px); opacity: 1; }
				}
				@keyframes shake {
					0%, 100% { transform: translateX(0); }
					25% { transform: translateX(-2px); }
					75% { transform: translateX(2px); }
				}
				.animate-ticker { animation: ticker 20s linear infinite; }
				.animate-ticker-reverse { animation: ticker-reverse 25s linear infinite; }
				.animate-blink { animation: blink 2s ease-in-out infinite; }
				.animate-dot-bounce { animation: dot-bounce 1s ease-in-out infinite; }
				.animate-shake { animation: shake 0.3s ease-in-out infinite; }
				.scrollbar-none::-webkit-scrollbar { display: none; }
			`}</style>
		</div>
	);
}

export const Route = createFileRoute("/")({ component: KramerMoviefilk });
