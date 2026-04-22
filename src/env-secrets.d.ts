/** Set with `wrangler secret put ANTHROPIC_API_KEY` or in `.dev.vars` for local dev. */
/** Set with `wrangler secret put ELEVENLABS_API_KEY` or in `.dev.vars` for local dev (Scribe Realtime STT). */
declare namespace Cloudflare {
	interface Env {
		ANTHROPIC_API_KEY: string;
		/** Optional until configured; runtime code treats a missing value as unavailable STT. */
		ELEVENLABS_API_KEY?: string;
	}
}
