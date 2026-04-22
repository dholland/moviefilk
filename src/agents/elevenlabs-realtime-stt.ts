import type {
	Transcriber,
	TranscriberSession,
	TranscriberSessionOptions,
} from "@cloudflare/voice";

const SCRIBE_WS_BASE = "wss://api.elevenlabs.io/v1/speech-to-text/realtime";
const REALTIME_SCRIBE_TOKEN_PATH =
	"https://api.elevenlabs.io/v1/single-use-token/realtime_scribe";
const DEFAULT_MODEL_ID = "scribe_v2_realtime";
const SAMPLE_RATE = 16_000;

const SCRIBE_ERROR_MESSAGE_TYPES: ReadonlySet<string> = new Set([
	"error",
	"auth_error",
	"quota_exceeded",
	"commit_throttled",
	"unaccepted_terms",
	"rate_limited",
	"queue_overflow",
	"resource_exhausted",
	"session_time_limit_exceeded",
	"input_error",
	"chunk_size_exceeded",
	"insufficient_audio_activity",
	"transcriber_error",
]);

export type ScribeRealtimeDispatchResultType =
	| { kind: "noop" }
	| { kind: "interim"; text: string }
	| { kind: "utterance"; text: string }
	| { kind: "error"; message: string };

/**
 * Maps ElevenLabs Scribe Realtime server JSON to voice pipeline callbacks.
 * Exported for unit tests.
 */
export function interpretScribeRealtimeServerMessage(
	parsed: unknown,
): ScribeRealtimeDispatchResultType {
	if (!parsed || typeof parsed !== "object") {
		return { kind: "noop" };
	}
	const record = parsed as {
		message_type?: unknown;
		text?: unknown;
		error?: unknown;
	};
	const messageType = record.message_type;
	if (messageType === "partial_transcript") {
		const text = record.text;
		if (typeof text === "string" && text.length > 0) {
			return { kind: "interim", text };
		}
		return { kind: "noop" };
	}
	if (
		messageType === "committed_transcript" ||
		messageType === "committed_transcript_with_timestamps"
	) {
		const text = record.text;
		if (typeof text === "string" && text.length > 0) {
			return { kind: "utterance", text };
		}
		return { kind: "noop" };
	}
	if (messageType === "session_started") {
		return { kind: "noop" };
	}
	if (
		typeof messageType === "string" &&
		SCRIBE_ERROR_MESSAGE_TYPES.has(messageType)
	) {
		const errText = record.error;
		if (typeof errText === "string" && errText.length > 0) {
			return { kind: "error", message: errText };
		}
		return { kind: "error", message: "Unknown ElevenLabs Scribe error" };
	}
	return { kind: "noop" };
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	let binary = "";
	const chunkSize = 8192;
	for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
		const end = Math.min(offset + chunkSize, bytes.byteLength);
		const slice = bytes.subarray(offset, end);
		binary += String.fromCharCode(...slice);
	}
	return btoa(binary);
}

export type ElevenLabsRealtimeTranscriberConfigType = {
	apiKey: string | undefined;
	modelId?: string;
	fetchImpl?: typeof fetch;
	createWebSocket?: (url: string) => WebSocket;
};

export default class ElevenLabsRealtimeTranscriber implements Transcriber {
	readonly #apiKey: string | undefined;
	readonly #modelId: string;
	readonly #fetchImpl: typeof fetch;
	readonly #createWebSocket: (url: string) => WebSocket;

	constructor(config: ElevenLabsRealtimeTranscriberConfigType) {
		this.#apiKey = config.apiKey;
		this.#modelId = config.modelId ?? DEFAULT_MODEL_ID;
		// Workers `fetch` must be invoked with global `this`; storing a bare
		// reference and calling it causes "Illegal invocation" (see CF docs).
		this.#fetchImpl =
			config.fetchImpl ??
			((input, init) => globalThis.fetch(input, init));
		this.#createWebSocket =
			config.createWebSocket ??
			((url) => new globalThis.WebSocket(url));
	}

	createSession(options?: TranscriberSessionOptions): TranscriberSession {
		return new ElevenLabsScribeSession(
			{
				apiKey: this.#apiKey,
				modelId: this.#modelId,
				fetchImpl: this.#fetchImpl,
				createWebSocket: this.#createWebSocket,
			},
			options,
		);
	}
}

type ElevenLabsScribeSessionDepsType = {
	apiKey: string | undefined;
	modelId: string;
	fetchImpl: typeof fetch;
	createWebSocket: (url: string) => WebSocket;
};

class ElevenLabsScribeSession implements TranscriberSession {
	#onInterim: ((text: string) => void) | undefined;
	#onUtterance: ((text: string) => void) | undefined;
	#ws: WebSocket | null = null;
	#connected = false;
	#closed = false;
	#pendingChunks: ArrayBuffer[] = [];
	#deps: ElevenLabsScribeSessionDepsType;
	#language?: string;

	constructor(
		deps: ElevenLabsScribeSessionDepsType,
		options?: TranscriberSessionOptions,
	) {
		this.#deps = deps;
		this.#onInterim = options?.onInterim;
		this.#onUtterance = options?.onUtterance;
		this.#language = options?.language;
		void this.#connect();
	}

	async #connect(): Promise<void> {
		const apiKey = this.#deps.apiKey;
		if (!apiKey) {
			console.error(
				"[ElevenLabsSTT] Missing ELEVENLABS_API_KEY — speech-to-text is unavailable.",
			);
			return;
		}
		try {
			const tokenResponse = await this.#deps.fetchImpl(
				REALTIME_SCRIBE_TOKEN_PATH,
				{
					method: "POST",
					headers: {
						"xi-api-key": apiKey,
					},
				},
			);
			if (!tokenResponse.ok) {
				const bodyText = await tokenResponse.text();
				console.error(
					"[ElevenLabsSTT] Failed to mint realtime_scribe token:",
					tokenResponse.status,
					bodyText.slice(0, 500),
				);
				return;
			}
			const tokenJson: unknown = await tokenResponse.json();
			const token =
				tokenJson &&
				typeof tokenJson === "object" &&
				"token" in tokenJson &&
				typeof (tokenJson as { token: unknown }).token === "string"
					? (tokenJson as { token: string }).token
					: null;
			if (!token) {
				console.error("[ElevenLabsSTT] Token response missing `token` field.");
				return;
			}
			if (this.#closed) {
				return;
			}
			const query = new URLSearchParams({
				model_id: this.#deps.modelId,
				token,
				audio_format: "pcm_16000",
				commit_strategy: "vad",
			});
			if (this.#language) {
				query.set("language_code", this.#language);
			}
			const wsUrl = `${SCRIBE_WS_BASE}?${query.toString()}`;
			const ws = this.#deps.createWebSocket(wsUrl);
			this.#ws = ws;
			ws.addEventListener("open", () => {
				if (this.#closed) {
					try {
						ws.close();
					} catch {
						// ignore
					}
					return;
				}
				this.#connected = true;
				for (const chunk of this.#pendingChunks) {
					this.#sendAudioChunk(chunk);
				}
				this.#pendingChunks = [];
			});
			ws.addEventListener("message", (event) => {
				this.#handleMessage(event);
			});
			ws.addEventListener("close", () => {
				this.#connected = false;
			});
			ws.addEventListener("error", () => {
				this.#connected = false;
			});
		} catch (err) {
			console.error("[ElevenLabsSTT] Connection error:", err);
		}
	}

	#handleMessage(event: MessageEvent): void {
		if (this.#closed) {
			return;
		}
		try {
			const raw = event.data;
			const textPayload = typeof raw === "string" ? raw : null;
			if (!textPayload) {
				return;
			}
			const parsed: unknown = JSON.parse(textPayload);
			const action = interpretScribeRealtimeServerMessage(parsed);
			switch (action.kind) {
				case "interim":
					this.#onInterim?.(action.text);
					break;
				case "utterance":
					this.#onUtterance?.(action.text);
					break;
				case "error":
					console.error("[ElevenLabsSTT] Scribe error:", action.message);
					break;
				case "noop":
					break;
			}
		} catch {
			// ignore malformed frames
		}
	}

	#sendAudioChunk(chunk: ArrayBuffer): void {
		if (!this.#ws || this.#ws.readyState !== WebSocket.OPEN) {
			return;
		}
		const payload = {
			message_type: "input_audio_chunk" as const,
			audio_base_64: arrayBufferToBase64(chunk),
			commit: false,
			sample_rate: SAMPLE_RATE,
		};
		this.#ws.send(JSON.stringify(payload));
	}

	feed(chunk: ArrayBuffer): void {
		if (this.#closed) {
			return;
		}
		if (this.#connected && this.#ws && this.#ws.readyState === WebSocket.OPEN) {
			this.#sendAudioChunk(chunk);
		} else {
			this.#pendingChunks.push(chunk);
		}
	}

	close(): void {
		if (this.#closed) {
			return;
		}
		this.#closed = true;
		this.#pendingChunks = [];
		if (this.#ws) {
			try {
				this.#ws.close();
			} catch {
				// ignore
			}
			this.#ws = null;
		}
		this.#connected = false;
	}
}
