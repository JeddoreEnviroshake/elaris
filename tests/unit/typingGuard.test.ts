import { afterEach, describe, expect, it } from 'vitest';
import { installTypingGuard, isTypingTarget } from '../../src/ui/typingGuard';

let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.replaceChildren();
});

function pressOne(target: HTMLElement): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key: '1', keyCode: 49, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

describe('typing guard', () => {
  it('hides admin field keystrokes from the game key bindings on window', () => {
    // Phaser listens on window and preventDefaults every key it captures, which
    // is what swallowed the hotbar digits typed into Admin number fields.
    const seenByGame: string[] = [];
    const phaserLike = (event: Event): void => {
      seenByGame.push((event as KeyboardEvent).key);
      event.preventDefault();
    };
    window.addEventListener('keydown', phaserLike);
    dispose = installTypingGuard();
    const field = document.createElement('input');
    field.type = 'number';
    document.body.appendChild(field);

    const typed = pressOne(field);
    expect(seenByGame).toEqual([]);
    expect(typed.defaultPrevented).toBe(false);

    const fromCanvas = pressOne(document.body);
    expect(seenByGame).toEqual(['1']);
    expect(fromCanvas.defaultPrevented).toBe(true);
    window.removeEventListener('keydown', phaserLike);
  });

  it('leaves other document-level panel shortcuts running', () => {
    let escapes = 0;
    const panel = (): void => { escapes += 1; };
    dispose = installTypingGuard();
    document.addEventListener('keydown', panel);
    const field = document.createElement('input');
    document.body.appendChild(field);

    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(escapes).toBe(1);
    document.removeEventListener('keydown', panel);
  });

  it('treats form fields and editable regions as typing targets', () => {
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    document.body.appendChild(editable);
    for (const tag of ['input', 'textarea', 'select'] as const) {
      expect(isTypingTarget(document.createElement(tag))).toBe(true);
    }
    expect(isTypingTarget(editable)).toBe(true);
    expect(isTypingTarget(document.createElement('canvas'))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
