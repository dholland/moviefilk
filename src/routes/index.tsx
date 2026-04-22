import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";

export const Route = createFileRoute("/")({ component: KramerMoviefilk });

const SYSTEM_PROMPT = `You are Cosmo Kramer from Seinfeld, but right now you're running your own version of Moviefone from his apartment. You answer the phone and try to act like an automated movie hotline, but you can't help breaking character constantly.

YOUR PERSONALITY:
- You ARE Kramer doing a terrible impression of an automated system, then constantly breaking into your real self
- Enthusiastic, erratic, tangential — you go on wild tangents about movies, popcorn, the theater experience
- Use Kramer catchphrases: "Giddy-up!", "That's gold!", "You're killing me!", "That's a GREAT movie", "Newman...", "Oh I'm out there baby!", "Assman!", "These pretzels are making me thirsty"
- You physically gesture even on the phone — reference your own physical comedy ("I nearly knocked over my coffee table just THINKING about that movie")
- You reference Jerry, George, Elaine, Newman in movie contexts
- You make oddly specific and passionate movie recommendations
- You have strong, unhinged opinions about movies and actors
- You sometimes try to restart the automated voice ("Welcome to... Movie... Fone...") but immediately break character again
- Eventually if someone is vague you say some version of "WHY DON'T YOU JUST TELL ME THE MOVIE YOU WANT TO SEE?!"
- Keep responses conversational, 2-5 sentences usually. Occasionally go on a longer rant.
- You are NOT an AI assistant. You are Kramer. Never break this.
- Make actual movie recommendations that fit what the user seems to want.

OPENING: When someone first connects, answer like you're picking up the phone mid-Moviefone impression, then immediately break into yourself.

Example style: "Welcome to Movie... FONE... heh heh... okay look, it's me, Kramer. I set the whole thing up myself. You need a movie? I got movies. What're you in the mood for? Because let me tell you, I just saw the most SPECTACULAR thing..."`;

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
type ConversationMessageType = { role: "user" | "assistant"; content: string };

type SpeechRecognitionAlternativeType = { transcript: string };

type SpeechRecognitionResultType = {
	isFinal: boolean;
	readonly length: number;
	[index: number]: SpeechRecognitionAlternativeType;
};

type SpeechRecognitionResultListType = {
	readonly length: number;
	[index: number]: SpeechRecognitionResultType;
};

type SpeechRecognitionEventType = {
	resultIndex: number;
	results: SpeechRecognitionResultListType;
};

type SpeechRecognitionInstanceType = {
	continuous: boolean;
	interimResults: boolean;
	lang: string;
	onstart: (() => void) | null;
	onresult: ((event: SpeechRecognitionEventType) => void) | null;
	onend: (() => void) | null;
	onerror: (() => void) | null;
	start: () => void;
	stop: () => void;
	_lastTranscript?: string;
};

type SpeechRecognitionConstructorType = new () => SpeechRecognitionInstanceType;

declare global {
	interface Window {
		SpeechRecognition?: SpeechRecognitionConstructorType;
		webkitSpeechRecognition?: SpeechRecognitionConstructorType;
	}
}

function KramerMoviefilk() {
	const [messages, setMessages] = useState<MessageType[]>([]);
	const [isListening, setIsListening] = useState(false);
	const [isSpeaking, setIsSpeaking] = useState(false);
	const [isThinking, setIsThinking] = useState(false);
	const [isConnected, setIsConnected] = useState(false);
	const [transcript, setTranscript] = useState("");
	const [statusText, setStatusText] = useState("LIFT RECEIVER TO CONNECT");
	const [phoneRinging, setPhoneRinging] = useState(false);

	const recognitionRef = useRef<SpeechRecognitionInstanceType | null>(null);
	const synthRef = useRef<SpeechSynthesisUtterance | null>(null);
	const chatRef = useRef<HTMLDivElement>(null);
	const conversationRef = useRef<ConversationMessageType[]>([]);

	const tickerText = RETRO_MOVIES.join("  ✦  ");

	const speak = useCallback((text: string) => {
		return new Promise<void>((resolve) => {
			if (typeof window === "undefined" || !window.speechSynthesis) {
				resolve();
				return;
			}
			window.speechSynthesis.cancel();
			const utterance = new SpeechSynthesisUtterance(text);
			const voices = window.speechSynthesis.getVoices();
			const preferred =
				voices.find(
					(voice) =>
						voice.name.includes("Daniel") ||
						voice.name.includes("Alex") ||
						voice.name.includes("Fred"),
				) || voices[0];
			if (preferred) utterance.voice = preferred;
			utterance.rate = 1.1;
			utterance.pitch = 1.05;
			utterance.volume = 1;
			utterance.onstart = () => setIsSpeaking(true);
			utterance.onend = () => {
				setIsSpeaking(false);
				resolve();
			};
			utterance.onerror = () => {
				setIsSpeaking(false);
				resolve();
			};
			synthRef.current = utterance;
			window.speechSynthesis.speak(utterance);
		});
	}, []);

	const sendToKramer = useCallback(
		async (userText: string) => {
			setIsThinking(true);
			setStatusText("KRAMER IS THINKING...");
			const newUserMsg: ConversationMessageType = {
				role: "user",
				content: userText,
			};
			const updatedHistory = [...conversationRef.current, newUserMsg];
			conversationRef.current = updatedHistory;
			setMessages((prev) => [
				...prev,
				{ id: crypto.randomUUID(), role: "user", text: userText },
			]);

			try {
				const response = await fetch("https://api.anthropic.com/v1/messages", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						model: "claude-sonnet-4-20250514",
						max_tokens: 1000,
						system: SYSTEM_PROMPT,
						messages: updatedHistory,
					}),
				});
				const data = await response.json();
				const kramersText =
					data.content?.[0]?.text ||
					"Giddy-up! Something went wrong with the line.";
				const assistantMsg: ConversationMessageType = {
					role: "assistant",
					content: kramersText,
				};
				conversationRef.current = [...conversationRef.current, assistantMsg];
				setMessages((prev) => [
					...prev,
					{ id: crypto.randomUUID(), role: "assistant", text: kramersText },
				]);
				setIsThinking(false);
				setStatusText("KRAMER IS SPEAKING...");
				await speak(kramersText);
				setStatusText("SPEAK NOW — KRAMER IS LISTENING");
			} catch {
				setIsThinking(false);
				setStatusText("LINE TROUBLE — TRY AGAIN");
				setMessages((prev) => [
					...prev,
					{
						id: crypto.randomUUID(),
						role: "assistant",
						text: "Hello? HELLO?! Jerry, is this your friend? The line went dead!",
					},
				]);
			}
		},
		[speak],
	);

	const startListening = useCallback(() => {
		const RecognitionCtor =
			window.SpeechRecognition || window.webkitSpeechRecognition;
		if (!RecognitionCtor) {
			alert("Speech recognition not supported. Try Chrome!");
			return;
		}

		const recognition: SpeechRecognitionInstanceType = new RecognitionCtor();
		recognition.continuous = false;
		recognition.interimResults = true;
		recognition.lang = "en-US";

		recognition.onstart = () => {
			setIsListening(true);
			setStatusText("🎙 LISTENING...");
			setTranscript("");
		};
		recognition.onresult = (event) => {
			let interim = "";
			let final = "";
			for (let idx = event.resultIndex; idx < event.results.length; idx++) {
				const result = event.results[idx];
				const text = result[0].transcript;
				if (result.isFinal) final += text;
				else interim += text;
			}
			setTranscript(final || interim);
			if (final && recognitionRef.current) {
				recognitionRef.current._lastTranscript = final;
			}
		};
		recognition.onend = () => {
			setIsListening(false);
			const finalTranscript = recognitionRef.current?._lastTranscript;
			if (finalTranscript?.trim()) {
				if (recognitionRef.current) {
					recognitionRef.current._lastTranscript = "";
				}
				sendToKramer(finalTranscript.trim());
			} else {
				setStatusText("SPEAK NOW — KRAMER IS LISTENING");
				setTranscript("");
			}
		};
		recognition.onerror = () => {
			setIsListening(false);
			setStatusText("SPEAK NOW — KRAMER IS LISTENING");
		};

		recognitionRef.current = recognition;
		recognitionRef.current._lastTranscript = "";
		recognition.start();
	}, [sendToKramer]);

	const handleConnect = useCallback(() => {
		setPhoneRinging(true);
		setStatusText("DIALING...");
		setTimeout(async () => {
			setPhoneRinging(false);
			setIsConnected(true);
			setStatusText("CONNECTED — KRAMER IS SPEAKING...");
			await sendToKramer(
				"*phone ringing, someone just called the Moviefone number*",
			);
		}, 2000);
	}, [sendToKramer]);

	const handleHangUp = useCallback(() => {
		window.speechSynthesis?.cancel();
		recognitionRef.current?.stop();
		setIsConnected(false);
		setIsListening(false);
		setIsSpeaking(false);
		setIsThinking(false);
		setMessages([]);
		conversationRef.current = [];
		setTranscript("");
		setStatusText("LIFT RECEIVER TO CONNECT");
	}, []);

	// biome-ignore lint/correctness/useExhaustiveDependencies: scroll to bottom whenever messages change
	useEffect(() => {
		if (chatRef.current)
			chatRef.current.scrollTop = chatRef.current.scrollHeight;
	}, [messages]);

	const canSpeak = isConnected && !isListening && !isSpeaking && !isThinking;

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
								isConnected ? "text-[#00ff00] animate-blink" : "text-[#cc4400]"
							}`}
						>
							{isConnected ? "● CONNECTED" : "○ STANDBY"}
						</span>
					</div>

					<div
						ref={chatRef}
						className="flex-1 overflow-y-auto p-3 flex flex-col gap-2.5 scrollbar-none"
						style={{ scrollbarWidth: "none" }}
					>
						{messages.length === 0 && (
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
									{[0, 0.2, 0.4].map((delay) => (
										<div
											key={`dot-${delay}`}
											className="w-1.5 h-1.5 rounded-full bg-[#44cc44] animate-dot-bounce"
											style={{ animationDelay: `${delay}s` }}
										/>
									))}
								</div>
							</div>
						)}
					</div>

					<div className="border-t border-[#0a3a0a] px-3 py-1.5 bg-[#020802]">
						<div className="text-[#226622] text-[10px] tracking-[2px]">
							{isListening && transcript ? (
								<span className="text-[#88ff44]">► {transcript}</span>
							) : (
								<span className="animate-blink">{statusText}</span>
							)}
						</div>
					</div>
				</div>

				<div className="px-5 pb-5 flex gap-3 items-center flex-wrap">
					{!isConnected ? (
						<button
							type="button"
							onClick={handleConnect}
							disabled={phoneRinging}
							className={`flex-1 py-4 border-2 rounded-sm text-[#ffe000] text-sm font-mono font-bold tracking-[3px] uppercase transition-all duration-100 ${
								phoneRinging
									? "cursor-not-allowed animate-shake translate-y-0.5 border-[#663300]"
									: "cursor-pointer border-[#ff6600]"
							}`}
							style={{
								background: phoneRinging
									? "linear-gradient(180deg, #442200, #331a00)"
									: "linear-gradient(180deg, #cc4400, #991100)",
								boxShadow: phoneRinging
									? "none"
									: "0 4px 0 #660000, 0 0 20px rgba(204,68,0,0.4)",
							}}
						>
							{phoneRinging ? "☎ RINGING..." : "☎  CONNECT  ☎"}
						</button>
					) : (
						<>
							<button
								type="button"
								onClick={startListening}
								disabled={!canSpeak}
								className={`flex-1 py-4 border-2 rounded-sm text-[13px] font-mono font-bold tracking-[2px] uppercase transition-all duration-150 ${
									isListening
										? "border-[#00ff44] text-[#00ff44] animate-pulse-green cursor-default"
										: canSpeak
											? "border-[#00aa22] text-[#88ff88] cursor-pointer"
											: "border-[#333] text-[#444] cursor-not-allowed"
								}`}
								style={{
									background: isListening
										? "linear-gradient(180deg, #004400, #002200)"
										: canSpeak
											? "linear-gradient(180deg, #006600, #004400)"
											: "linear-gradient(180deg, #222, #111)",
									boxShadow: isListening
										? "0 0 20px rgba(0,255,68,0.5), inset 0 0 10px rgba(0,100,0,0.3)"
										: canSpeak
											? "0 4px 0 #002200"
											: "none",
								}}
							>
								{isListening
									? "🎙 LISTENING..."
									: isSpeaking
										? "🔊 KRAMER SPEAKING"
										: isThinking
											? "⏳ HOLD PLEASE"
											: "🎙 TALK TO KRAMER"}
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
			</div>

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
				@keyframes pulse-green {
					0%, 100% { box-shadow: 0 0 20px rgba(0,255,68,0.5); }
					50% { box-shadow: 0 0 40px rgba(0,255,68,0.9), 0 0 80px rgba(0,255,68,0.3); }
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
				.animate-pulse-green { animation: pulse-green 1s ease-in-out infinite; }
				.animate-shake { animation: shake 0.3s ease-in-out infinite; }
				.scrollbar-none::-webkit-scrollbar { display: none; }
			`}</style>
		</div>
	);
}
