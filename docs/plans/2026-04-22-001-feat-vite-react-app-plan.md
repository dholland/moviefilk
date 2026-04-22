---
title: "feat: Set up Vite + React application"
type: feat
status: active
date: 2026-04-22
---

# feat: Set up Vite + React application

## Overview

Initialize a **Vite-powered React** frontend in the currently empty `moviefilk` repository: dev server, production build, TypeScript, linting, and a minimal automated test baseline so later features have a stable toolchain.

## Problem Frame

The repository contains only Git metadata and no application code. The team needs a **standard, maintainable frontend skeleton** that supports fast local development and reliable production builds, without committing to backend or deployment details in this pass.

## Requirements Trace

- **R1.** Developers can run a local dev server with hot module replacement and see a working React root mount.
- **R2.** A production build produces static assets suitable for static hosting or integration behind any future backend.
- **R3.** TypeScript is enabled project-wide with a typecheck command that can run in CI later.
- **R4.** ESLint is configured for React and TypeScript so new code follows a consistent baseline.
- **R5.** At least one automated test runs (component or smoke-level) to prove the test runner is wired correctly.

## Scope Boundaries

- **In scope:** Frontend app scaffold, core npm scripts, ESLint, TypeScript, minimal Vitest (or equivalent Vite-native test) setup.
- **Out of scope:** Backend API, authentication, routing library choice (e.g. React Router), deployment pipelines, design system, PWA features, and Convex or other BaaS integration unless added in a follow-up plan.
- **Out of scope:** Authoring a full `README.md` or onboarding docs unless explicitly requested later (this plan only notes script expectations for verification).

## Context & Research

### Relevant Code and Patterns

- **Greenfield repository** — there are no existing manifests, `AGENTS.md`, or prior frontend conventions in-tree. The implementing agent should prefer **official Vite and React documentation** and the default **create-vite** React + TypeScript template as the source of truth for file layout.
- After scaffold, establish **team conventions** (see Key Technical Decisions) in new source files and optionally in a short `AGENTS.md` if the repo adopts agent guidance later.

### Institutional Learnings

- No `docs/solutions/` directory or documented prior art in this repository.

### External References

- [Vite: Getting Started](https://vite.dev/guide/) — dev server, `vite.config`, build and preview.
- [create-vite](https://vite.dev/guide/#scaffolding-your-first-vite-project) — official scaffolding flow and template options.

## Key Technical Decisions

- **Use the official React + TypeScript template via create-vite** — Minimizes drift from upstream, keeps `vite.config` and `tsconfig` splits aligned with current Vite releases, and avoids hand-rolling a config that ages quickly on an empty repo.
- **Prefer Vitest for the minimal test baseline** — Shares config with Vite, avoids a separate Jest toolchain, and satisfies R5 with low ceremony.
- **Choose one package manager for the plan and stick to it for lockfile and commands** — Default assumption: **npm** with a committed `package-lock.json` for reproducible installs across machines and future CI. If the team standardizes on pnpm or Yarn, substitute consistently in all units (lockfile, install commands, and documentation snippets).
- **ESLint flat config** — Follow the template and current `@eslint/js` + `typescript-eslint` + `eslint-plugin-react-hooks` guidance shipped with or adjacent to the scaffold; do not introduce legacy `.eslintrc` unless the template does.
- **Type naming and component style for new code** — Align with project preferences: suffix custom types/interfaces with `Type`, use `export default function ComponentName` for components, avoid `as any` and avoid type assertions solely to silence errors. Apply these in newly added example components/tests, not necessarily in generated boilerplate until touched.

## Open Questions

### Resolved During Planning

- **Is there an existing requirements doc?** None found under `docs/brainstorms/`; planning proceeds from the user request.
- **Monorepo or single package?** Single-package app at repository root is assumed unless a future plan introduces workspaces.

### Deferred to Implementation

- **Exact create-vite CLI flags and template name** — Depend on the installed `@latest` generator; the implementer should follow the interactive or non-interactive flow documented at release time.
- **Node.js version pin** — Deferred until `engines` / `.nvmrc` are added; choose an LTS version supported by the Vite major version in use.

## Implementation Units

- [ ] **Unit 1: Scaffold Vite + React + TypeScript at repo root**

**Goal:** Generate the canonical project tree (config, `index.html`, `src` entry, public assets) using create-vite.

**Requirements:** R1, R2

**Dependencies:** None (Node.js installed locally).

**Files:**

- Create (via scaffold): `package.json`, `package-lock.json` (or chosen lockfile), `vite.config.ts`, `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json`, `index.html`, `src/main.tsx`, `src/App.tsx`, associated CSS modules or files, `public/`, `eslint.config.js` (or `.ts` per template), `.gitignore`
- **Test:** Automated tests begin in Unit 4; this unit relies on manual verification only.

**Approach:**

- Run create-vite targeting the repository root (or confirm whether to use a `frontend/` subfolder; **default: root** for the empty repo).
- Install dependencies with the chosen package manager.
- Ensure `.gitignore` excludes `node_modules`, build output (typically `dist`), and editor noise.

**Patterns to follow:**

- Official Vite React–TS template layout and script names from the generator.

**Test scenarios:**

- **Happy path:** After install, start the dev server; load the app in a browser and confirm the default React content renders without console errors.
- **Error path:** Run the dev script with `NODE_ENV` or environment misconfiguration only if the template documents a clear failure mode; otherwise skip.

**Verification:**

- Dev server starts and hot reload works for a trivial edit to `src/App.tsx`.
- Production build completes without errors.

---

- [ ] **Unit 2: Normalize scripts, Node constraints, and install reproducibility**

**Goal:** Make `package.json` scripts complete and predictable for local dev and future CI.

**Requirements:** R1, R2, R3

**Dependencies:** Unit 1

**Files:**

- Modify: `package.json`
- Create (optional but recommended): `.nvmrc` or `.node-version`, `engines` field in `package.json`

**Approach:**

- Ensure scripts exist for: `dev`, `build`, `preview`, `lint` (if ESLint not yet wired, add in Unit 3 and return here to confirm), and `typecheck` (e.g. `tsc -b` or `tsc --noEmit` per template).
- Pin Node version to an LTS line compatible with the Vite version in use.

**Patterns to follow:**

- Script naming conventions from the generated template; extend rather than rename to avoid confusion.

**Test scenarios:**

- **Happy path:** `build` produces `dist/` with expected static assets; `preview` serves the built app.
- **Happy path:** `typecheck` exits zero on a clean tree.
- **Error path:** `typecheck` fails when a deliberate type error is introduced in a throwaway branch (then reverted).

**Verification:**

- A new clone with `npm ci` (or pnpm/yarn equivalent) can run `dev`, `build`, and `typecheck` successfully.

---

- [ ] **Unit 3: Harden ESLint and TypeScript strictness**

**Goal:** Satisfy R4 with a baseline that catches common React and TS foot-guns.

**Requirements:** R4, R3

**Dependencies:** Unit 2

**Files:**

- Modify: `eslint.config.*`, `tsconfig.app.json` (or root `tsconfig` as appropriate), possibly `package.json` devDependencies

**Approach:**

- Enable React Hooks rules and TypeScript-aware lint rules per current eslint flat-config recommendations.
- Tighten compiler options incrementally if the template is loose (e.g. `strict`, `noUnusedLocals`) **without** breaking the scaffold; if strict mode surfaces issues in generated boilerplate, fix them in the same unit.

**Patterns to follow:**

- Extend the template’s ESLint setup rather than replacing it wholesale.

**Test scenarios:**

- **Happy path:** `lint` passes on the scaffold after any strictness fixes.
- **Error path:** Unused variable or missing hook dependency is reported by ESLint when introduced temporarily.
- **Integration:** A file that violates both TS and ESLint (e.g. implicit `any` if forbidden) fails the appropriate command.

**Verification:**

- `lint` and `typecheck` both succeed on main; violations fail loudly.

---

- [ ] **Unit 4: Add Vitest + React Testing Library smoke test**

**Goal:** Satisfy R5 with one meaningful test (e.g. `App` renders expected text).

**Requirements:** R5

**Dependencies:** Unit 3

**Files:**

- Modify: `vite.config.ts` (test config), `package.json` scripts (e.g. `test`)
- Create: `src/App.spec.tsx` or `src/App.test.tsx` (match project convention once chosen), optional `src/test/setup.ts`

**Approach:**

- Add Vitest and React Testing Library dependencies aligned with Vite’s testing guide.
- Configure `environment: 'jsdom'` (or current recommended test environment).
- Write a single test that renders `App` and asserts on visible content from the template.

**Patterns to follow:**

- Vite Vitest integration docs; colocate test next to component or use `src/test` per team preference (default: colocated `*.spec.tsx`).

**Test scenarios:**

- **Happy path:** `test` script runs and passes with the sample assertion.
- **Error path:** Assertion fails when expected text is removed from `App`, confirming the test is not vacuous.
- **Integration:** Test run uses the same path aliases (if any) as the app build.

**Verification:**

- CI-ready command exists (`npm test` or `npm run test`) and completes with exit code zero.

## System-Wide Impact

- **Interaction graph:** No existing entry points; the Vite dev server and static `dist/` output become the primary surfaces. Any future backend or Convex integration will consume the build output or proxy dev requests in a later plan.
- **Error propagation:** Build, typecheck, lint, and test failures should fail fast in terminal with actionable messages; no runtime error reporting service in scope.
- **State lifecycle risks:** None for static scaffold; cache directories (`node_modules`, `dist`) must remain gitignored.
- **API surface parity:** Not applicable — no published library API.
- **Integration coverage:** Manual browser load of dev and preview servers complements automated tests.
- **Unchanged invariants:** N/A (greenfield); future plans should treat `package.json` scripts and lockfile as contracts.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Node / Vite version mismatch on teammates’ machines | Pin Node via `engines` and optional `.nvmrc`; document in a future onboarding doc if needed |
| Strict TS or ESLint breaks generated boilerplate | Fix boilerplate in Unit 3 rather than disabling rules broadly |
| Package manager drift (multiple lockfiles) | Commit exactly one lockfile type and ignore others |

## Documentation / Operational Notes

- Optional follow-up: add `README.md` with install and script commands once the team wants contributor-facing docs.
- Slack tools were not used; ask to search Slack if organizational standards (e.g. mandated package manager) should override the npm default.

## Sources & References

- **Origin document:** none (request-only planning)
- Related code: repository root (greenfield)
- External docs: [https://vite.dev/guide/](https://vite.dev/guide/)
