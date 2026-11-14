import { describe, expect, it } from 'vitest';
import { installUiTheme } from '../../src/ui/theme';
import { uiButton } from '../../src/ui/controls';

describe('interior accessibility polish', () => {
  it('installs explicit high-contrast, forced-colors, and reduced-motion rules', () => {
    installUiTheme();
    const css = document.getElementById('elaris-ui-theme')?.textContent ?? '';
    expect(css).toContain('@media (prefers-contrast: more)');
    expect(css).toContain('@media (forced-colors: active)');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
  });

  it('keeps shared interaction controls above the 44px touch target minimum', () => {
    const button = uiButton('Interact', () => {});
    expect(Number.parseFloat(button.style.minWidth)).toBeGreaterThanOrEqual(44);
    expect(Number.parseFloat(button.style.minHeight)).toBeGreaterThanOrEqual(44);
  });
});
