import { describe, expect, it } from "vitest";
import { KRAMER_SYSTEM_PROMPT } from "./kramer-system-prompt.ts";

describe("KRAMER_SYSTEM_PROMPT", () => {
	it("keeps a non-trivial in-character system prompt for the voice agent", () => {
		expect(KRAMER_SYSTEM_PROMPT.length).toBeGreaterThan(200);
		expect(KRAMER_SYSTEM_PROMPT).toContain("Kramer");
		expect(KRAMER_SYSTEM_PROMPT).toContain("Moviefone");
	});
});
