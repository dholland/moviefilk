import { createAnthropic } from "@ai-sdk/anthropic";
import {
	type VoiceTurnContext,
	WorkersAITTS,
	withVoice,
} from "@cloudflare/voice";
import { Agent, type Connection } from "agents";
import { streamText } from "ai";
import ElevenLabsRealtimeTranscriber from "./elevenlabs-realtime-stt.ts";
import { KRAMER_SYSTEM_PROMPT } from "./kramer-system-prompt.ts";

const KramerVoiceAgentBase = withVoice(Agent);

export class KramerVoiceAgent extends KramerVoiceAgentBase {
	transcriber = new ElevenLabsRealtimeTranscriber({
		apiKey: this.env.ELEVENLABS_API_KEY,
	});
	/** deepgram/aura-1 voice — `asteria` is a clear default; swap to tune timbre. */
	tts = new WorkersAITTS(this.env.AI, { speaker: "asteria" });

	afterTranscribe(transcript: string, _connection: Connection): string | null {
		const trimmed = transcript.trim();
		if (trimmed.length < 2) {
			return null;
		}
		return transcript;
	}

	async onCallStart(connection: Connection): Promise<void> {
		const line = await this.kramerTextForSeedMessage(
			"*phone ringing, someone just called the Moviefone number*",
		);
		await this.speak(connection, line);
	}

	async onTurn(transcript: string, context: VoiceTurnContext) {
		if (!this.env.ANTHROPIC_API_KEY) {
			return "Jerry! The phone company forgot to give me a line!";
		}
		try {
			return this.kramerTextStream(transcript, context);
		} catch {
			return "Hello? HELLO?! Jerry, is this your friend? The line went dead!";
		}
	}

	private kramerTextStream(transcript: string, context: VoiceTurnContext) {
		const anthropic = createAnthropic({ apiKey: this.env.ANTHROPIC_API_KEY });
		return streamText({
			model: anthropic("claude-sonnet-4-20250514"),
			system: KRAMER_SYSTEM_PROMPT,
			messages: [
				...context.messages.map((m) => ({
					role: m.role,
					content: m.content,
				})),
				{ role: "user", content: transcript },
			],
			abortSignal: context.signal,
		}).textStream;
	}

	private async kramerTextForSeedMessage(userLine: string): Promise<string> {
		if (!this.env.ANTHROPIC_API_KEY) {
			return "Welcome to Movie... FONE... heh heh... it's me, Kramer! Giddy up — what movie are we doing?!";
		}
		try {
			const anthropic = createAnthropic({ apiKey: this.env.ANTHROPIC_API_KEY });
			const result = streamText({
				model: anthropic("claude-sonnet-4-20250514"),
				system: KRAMER_SYSTEM_PROMPT,
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
		return "Giddy-up! Something's crackling on the line—hit me with that again!";
	}
}
