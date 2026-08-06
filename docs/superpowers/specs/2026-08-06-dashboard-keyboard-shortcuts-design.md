# KeepRoot Dashboard Keyboard Shortcuts Design

## Goal

Add ten familiar, reader-oriented keyboard shortcuts to the authenticated KeepRoot dashboard without interfering with text entry, native browser commands, dialogs, or destructive-action confirmation.

## Selected approach

Use unmodified single-key shortcuts, following reading-list and feed-reader conventions. This keeps frequent actions fast and avoids browser-reserved modifier combinations. Keyboard handling remains within the existing dashboard event layer, with small helpers for resolving the active bookmark and moving focus.

Two alternatives were considered and rejected:

- Modifier chords would reduce accidental activation, but common combinations are intercepted inconsistently by Safari, Chrome, and Firefox.
- Multi-key navigation sequences such as `g` then `i` would reduce key collisions, but add state, timeout behaviour, and a steeper learning curve without enough value for the current dashboard.

## Shortcut set

The existing `/` search shortcut remains unchanged. The ten additions are:

| Key | Action |
| --- | --- |
| `J` | Focus the next visible bookmark card. From no selection, focus the first card. |
| `K` | Focus the previous visible bookmark card. From no selection, focus the last card. |
| `O` | Open the focused bookmark, falling back to the bookmark already open in the reader. |
| `R` | Toggle read or unread on the focused or open bookmark. |
| `P` | Toggle pinned or unpinned on the focused or open bookmark. |
| `E` | Open tag editing for the focused or open bookmark. |
| `I` | Open Inbox. |
| `A` | Open All items. |
| `Escape` | Close the top open dialog; otherwise clear a non-empty library search. |
| `?` | Open a compact keyboard-shortcut reference dialog. |

`J` and `K` stop at the first and last visible card rather than wrapping. Moving focus does not open or mark an item as read. Bookmark actions retain focus on the same card after list rendering where that card remains visible.

## Input and modal safety

Single-key shortcuts do not run when the event starts within an input, textarea, select, or contenteditable element. While a dialog is open, only `Escape` is handled, allowing the user to close it without other dashboard actions firing behind the modal. Shortcuts are disabled while the authenticated app shell is hidden.

Deletion is deliberately excluded from the shortcut set. It is destructive and already has a visible control plus confirmation; assigning Backspace or Delete would create disproportionate accidental-action risk.

## Components and behaviour

- `backend/dashboard/src/main.ts` resolves the active bookmark, moves card focus, dispatches navigation and item actions, and enforces input/modal guards.
- `backend/public/index.html` adds the shortcut-reference dialog and exposes its close control.
- `backend/dashboard/src/lib/dom.ts` registers the new dialog elements.
- `backend/dashboard/src/styles.css` adds only the small reference-grid and keycap styles needed by the dialog.
- The generated dashboard bundle under `backend/public/assets/` is rebuilt through the established build script.

The existing bookmark action path remains the source of truth for read and pin mutations. Tag editing gains a dedicated bookmark target so editing a focused card does not incorrectly claim that the reader has opened it.

## Error handling

Shortcuts with no applicable visible or open bookmark are no-ops. Existing API failures continue to surface through dashboard toasts. Focus restoration is best-effort after rendering because a bookmark can legitimately disappear from the current filtered view after an action.

## Verification

Add dashboard interaction tests that cover:

- `J` and `K` focus movement and boundaries;
- `O`, `R`, `P`, and `E` against the focused bookmark;
- `I` and `A` navigation;
- `Escape` dialog and search behaviour;
- `?` opening the complete shortcut reference;
- suppression while typing or while a modal is open.

Run `npm run test:dashboard`, `npm test`, the dashboard build, and `git diff --check`.
