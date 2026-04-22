import { createOpenAI } from "@ai-sdk/openai";
import { type VoiceTurnContext, withVoice } from "@cloudflare/voice";
import { Agent, type Connection } from "agents";
import { streamText } from "ai";
import { NOW_SHOWING_TITLES } from "../lib/now-showing-catalog.ts";
import ElevenLabsRealtimeTranscriber from "./elevenlabs-realtime-stt.ts";
import { buildSystemPrompt } from "./kramer-system-prompt.ts";
import { createKramerTtsProvider } from "./kramer-tts-factory.ts";
import { sanitizeForSpeech } from "./spoken-text.ts";

const KramerVoiceAgentBase = withVoice(Agent);

export class KramerVoiceAgent extends KramerVoiceAgentBase {
	transcriber = new ElevenLabsRealtimeTranscriber({
		apiKey: this.env.ELEVENLABS_API_KEY,
	});
	/** Workers AI (`asteria`) or HTTP `/speak` — see `createKramerTtsProvider` + `KRAMER_TTS_*` env. */
	tts = createKramerTtsProvider(this.env);

	private readonly systemPrompt = buildSystemPrompt(NOW_SHOWING_TITLES);

	afterTranscribe(transcript: string, _connection: Connection): string | null {
		const trimmed = transcript.trim();
		if (trimmed.length < 2) {
			return null;
		}
		return transcript;
	}

	beforeSynthesize(text: string, _connection: Connection): string | null {
		const cleaned = sanitizeForSpeech(text);
		console.info("[KramerTTS] beforeSynthesize", {
			inputLen: text.length,
			outputLen: cleaned?.length ?? 0,
			nulled: cleaned === null,
		});
		return cleaned;
	}

	afterSynthesize(
		audio: ArrayBuffer | null,
		text: string,
		_connection: Connection,
	): ArrayBuffer | null {
		console.info("[KramerTTS] afterSynthesize", {
			textLen: text.length,
			audioBytes: audio?.byteLength ?? 0,
			nullAudio: audio === null,
		});
		return audio;
	}

	async onCallStart(connection: Connection): Promise<void> {
		const line = await this.kramerTextForSeedMessage(
			"The phone is ringing. Someone just called the Moviefone number.",
		);
		await this.speak(connection, line);
	}

	async onTurn(transcript: string, context: VoiceTurnContext) {
		if (!this.env.OPENAI_API_KEY) {
			return "Jerry! The phone company forgot to give me a line!";
		}
		try {
			return this.kramerTextStream(transcript, context);
		} catch {
			return "Hello? HELLO?! Jerry, is this your friend? The line went dead!";
		}
	}

	private kramerTextStream(transcript: string, context: VoiceTurnContext) {
		const openai = createOpenAI({ apiKey: this.env.OPENAI_API_KEY });
		const { textStream } = streamText({
			model: openai("gpt-5.4-mini-2026-03-17"),
			system: this.systemPrompt,
			messages: [
				...context.messages.map((msg) => ({
					role: msg.role,
					content: msg.content,
				})),
				{ role: "user", content: transcript },
			],
			abortSignal: context.signal,
		});
		// AI SDK 6 textStream is AsyncIterable & ReadableStream. The voice
		// mixin's iterateText checks instanceof ReadableStream first, which
		// can mis-route string chunks into NDJSON parsing. Strip the
		// ReadableStream interface so iterateText uses the async-iterator path.
		return asAsyncIterable(textStream);
	}

	private async kramerTextForSeedMessage(
		userLine: string,
	): Promise<string> {
		if (!this.env.OPENAI_API_KEY) {
			return "Welcome to Movie... Fone... heh heh... it's me, Kramer! Giddy up, what movie are we doing?!";
		}
		try {
			const openai = createOpenAI({ apiKey: this.env.OPENAI_API_KEY });
			const result = streamText({
				model: openai("gpt-5.4-mini-2026-03-17"),
				system: this.systemPrompt,
				messages: [{ role: "user", content: userLine }],
			});
			let combined = "";
			for await (const part of result.textStream) {
				combined += part;
			}
			const text = combined.trim();
			if (text.length > 0) {
				return text;
			}
		} catch {
			// fall through
		}
		return "Giddy-up! Something's crackling on the line, hit me with that again!";
	}
}

/** Yield-only wrapper that strips ReadableStream from an AsyncIterable. */
async function* asAsyncIterable(
	stream: AsyncIterable<string>,
): AsyncGenerator<string> {
	for await (const chunk of stream) {
		yield chunk;
	}
}
