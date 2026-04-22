import type { TTSProvider } from "@cloudflare/voice";
import { WorkersAITTS } from "@cloudflare/voice";
import HttpKramerTts from "./http-kramer-tts.ts";

export function createKramerTtsProvider(env: Env): TTSProvider {
	if (env.KRAMER_TTS_MODE === "http" && env.KRAMER_TTS_URL?.length) {
		return new HttpKramerTts({ speakUrl: env.KRAMER_TTS_URL });
	}
	return new WorkersAITTS(env.AI, { speaker: "asteria" });
}
