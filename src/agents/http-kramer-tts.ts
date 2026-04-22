import type { TTSProvider } from "@cloudflare/voice";

export type HttpKramerTtsConfigType = {
	speakUrl: string;
};

/**
 * TTS that POSTs to a /speak-style endpoint: JSON body `{ text }`, WAV (or any
 * decodeAudioData-compatible) bytes in the response body.
 */
export default class HttpKramerTts implements TTSProvider {
	#speakUrl: string;

	constructor(config: HttpKramerTtsConfigType) {
		this.#speakUrl = config.speakUrl;
	}

	async synthesize(
		text: string,
		signal?: AbortSignal,
	): Promise<ArrayBuffer | null> {
		const trimmed = text.trim();
		if (trimmed.length === 0) {
			return null;
		}
		const res = await fetch(this.#speakUrl, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ text: trimmed }),
			signal,
		});
		if (!res.ok) {
			const detail = await res.text().catch(() => "");
			console.error("[HttpKramerTts] speak failed", res.status, detail);
			return null;
		}
		return res.arrayBuffer();
	}
}
