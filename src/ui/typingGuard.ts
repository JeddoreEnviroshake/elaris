/**
 * Keeps game key bindings out of DOM text fields.
 *
 * Phaser binds its keys with capture enabled, so its `window` keydown listener
 * calls `preventDefault()` on every bound key — the hotbar digits 1–5, 0 for
 * bare hands, WASD, E, C, B, I. That fires no matter what has focus, so typing
 * any of those characters into an Admin menu field inserted nothing (and
 * silently switched the hotbar behind the panel). It bites hardest on phones,
 * where the numeric keypad is how every admin value gets edited.
 *
 * The guard sits on `document` and stops the event on its way up from the
 * focused field, before it reaches `window`. Stopping rather than preventing
 * keeps the character insertion intact; stopping at the document leaves other
 * document-level listeners (panel Escape handling) running, since only nodes
 * further along the path are skipped.
 */

const TYPING_TAGS: ReadonlySet<string> = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/** Whether keystrokes at this target belong to a form field, not the game. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (TYPING_TAGS.has(target.tagName) || target.isContentEditable) return true;
  // jsdom never reports isContentEditable, so the attribute is checked too.
  return target.closest('[contenteditable]:not([contenteditable="false"])') !== null;
}

/** Install the guard for the app's lifetime; returns a disposer for tests. */
export function installTypingGuard(target: Document = document): () => void {
  const guard = (event: KeyboardEvent): void => {
    if (isTypingTarget(event.target)) event.stopPropagation();
  };
  target.addEventListener('keydown', guard);
  target.addEventListener('keyup', guard);
  return () => {
    target.removeEventListener('keydown', guard);
    target.removeEventListener('keyup', guard);
  };
}
