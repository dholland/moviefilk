/** Set with `wrangler secret put ANTHROPIC_API_KEY` or in `.dev.vars` for local dev. */
declare namespace Cloudflare {
	interface Env {
		ANTHROPIC_API_KEY: string;
	}
}
