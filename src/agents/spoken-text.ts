/**
 * Sanitize LLM output into plain spoken text suitable for TTS.
 *
 * Strips markdown formatting that TTS engines read aloud as literal symbols
 * (asterisks, hash-headings, backticks, etc.) and collapses whitespace so
 * the synthesized speech sounds natural.
 *
 * Returns `null` for empty/whitespace-only input so the voice pipeline can
 * skip synthesis entirely.
 */
export function sanitizeForSpeech(raw: string): string | null {
	let text = raw;

	// Bold / italic asterisks and underscores: **bold**, *italic*, __bold__, _italic_
	text = text.replace(/\*{1,3}([^*]+)\*{1,3}/g, "$1");
	text = text.replace(/_{1,3}([^_]+)_{1,3}/g, "$1");

	// Stray asterisks that didn't match a pair
	text = text.replace(/\*/g, "");

	// Markdown headings
	text = text.replace(/^#{1,6}\s+/gm, "");

	// Backtick code spans and fences
	text = text.replace(/`{1,3}[^`]*`{1,3}/g, (match) =>
		match.replace(/`/g, ""),
	);

	// Bullet / numbered list markers at the start of a line
	text = text.replace(/^[\s]*[-•]\s+/gm, "");
	text = text.replace(/^[\s]*\d+\.\s+/gm, "");

	// Collapse multiple whitespace / newlines into a single space
	text = text.replace(/\s+/g, " ");

	const trimmed = text.trim();
	return trimmed.length > 0 ? trimmed : null;
}
