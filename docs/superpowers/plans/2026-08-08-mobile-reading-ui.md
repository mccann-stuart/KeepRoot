# KeepRoot Mobile Reading UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:test-driven-development` for behavioural changes and preserve the approved mobile-only boundary.

**Goal:** Replace the dashboard's stacked phone layout with distinct library/navigation and reader surfaces matching `mobileUI.png`, without changing backend behaviour or the UI above 720px.

**Architecture:** Reuse the existing dashboard DOM, state, API client and event handlers. Add mobile-only navigation elements and an internal presentation surface, then activate the new composition exclusively through the existing `max-width: 720px` boundary.

**Tech Stack:** Framework-free TypeScript, HTML, CSS, JSDOM/Vitest, esbuild.

## Global Constraints

- Do not modify backend routes, APIs, schemas, persistence, authentication, ingestion or dependencies.
- Do not change the rendered dashboard above `720px`; all new navigation and reader chrome must be mobile-only.
- Reuse existing bookmark, filter, preference, update and delete behaviour.
- Do not add an add-bookmark action, web sharing, URL routing or browser-history state.
- Preserve dark mode, keyboard access, protected media, highlights and reduced-motion behaviour.
- Rebuild committed dashboard assets with `npm run build`; never hand-edit generated bundles.

---

### Task 1: Mobile shell, tabs and filter navigation

**Files:**
- Modify: `backend/public/index.html`
- Modify: `backend/dashboard/src/lib/dom.ts`
- Modify: `backend/dashboard/src/main.ts`
- Test: `backend/dashboard/test/main.spec.ts`

**Deliverable:** A mobile presentation surface and accessible controls for Library, Lists, Tags, Settings and the overflow destinations, backed by the existing view/filter state.

- Add failing interaction tests for All items/Inbox switching, active states, bottom-tab routing, list/smart-list/tag selection, empty collection indices and overflow menu routing.
- Add mobile-only semantic markup with unique IDs and accessible labels; keep it hidden by default.
- Add a `MobileSurface` state covering `library`, `lists`, `tags`, `reader`, `settings`, `sources`, `setup` and `mcp`, plus one helper that synchronises DOM state and active tabs.
- Render mobile list/smart-list and tag indices from existing state and route selection back to the filtered Library surface.
- Reuse existing create-list, settings, Sources, API keys, MCP setup and logout actions.
- Run the focused dashboard test file and then `npm run test:dashboard`.

### Task 2: Mobile reader flow, metadata and actions

**Files:**
- Modify: `backend/public/index.html`
- Modify: `backend/dashboard/src/lib/dom.ts`
- Modify: `backend/dashboard/src/main.ts`
- Test: `backend/dashboard/test/main.spec.ts`

**Deliverable:** A separate reader surface whose Back control restores the library context and whose controls reuse existing preferences and bookmark mutations.

- Add failing tests proving article open/back preserves query and filter context, restores collection scroll, and does not mark the current item read.
- Split card metadata into semantic domain, reading-time and date spans while keeping desktop output equivalent.
- Add mobile Back, `Aa`, tag and details controls; `Aa` reuses the existing 12-32px preference in two-pixel steps.
- Add mobile pin/unpin, read/unread, open-original and confirmed-delete actions using existing APIs and toast handling.
- Keep the reader open with an actionable error state if content loading fails; Back must remain available.
- Run the focused dashboard test file and then `npm run test:dashboard`.

### Task 3: Mobile visual system and generated assets

**Files:**
- Modify: `backend/dashboard/src/styles.css`
- Regenerate: `backend/public/assets/app.css`
- Regenerate: `backend/public/assets/app.js`
- Regenerate: `backend/public/sw.js`

**Deliverable:** A reference-faithful, single-surface phone layout at `<=720px`, with no desktop/tablet regression.

- Keep `.mobile-only` hidden in base styles and implement the new layout inside `@media (max-width: 720px)`.
- Use `100dvh`, safe-area insets, independent content scrolling, sticky reader bars, 44px targets, existing theme tokens and the supplied glass/blue/rounded-card direction.
- Hide the device-frame chrome and unsupported floating add action; retain desktop selectors and values above the breakpoint.
- Build generated assets with `npm run build`.
- Verify light and dark layouts at 390px, 430px and 720px, including long titles and low-height landscape; compare 721px, 1024px and 1440px against the baseline.
- Run `npm run test:dashboard`, `npm test`, `git diff --check`, and review changed paths for scope.
