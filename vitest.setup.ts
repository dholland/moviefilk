import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// React Testing Library's auto-cleanup only runs when Vitest is configured
// with `globals: true` (it isn't here). Register an explicit afterEach so
// rendered components are unmounted between tests and we don't accumulate
// duplicate DOM nodes across the suite.
afterEach(() => {
	cleanup();
});
