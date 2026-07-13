/**
 * Shared DOM factories for the gameplay HUD. Every interactive control is
 * touch-first: 44px+ targets, no tap highlight flash, a subtle pressed-state
 * squeeze, and accessible names that stay stable even when a visual label
 * carries an icon (e2e selectors match accessible names exactly).
 */

/** Right-edge rail geometry shared by the gameplay menu toggles. */
export const RAIL_RIGHT = 'calc(env(safe-area-inset-right) + 18px)';
export const RAIL_BOTTOMS = {
  craft: 'calc(env(safe-area-inset-bottom) + 104px)',
  build: 'calc(env(safe-area-inset-bottom) + 168px)',
  menu: 'calc(env(safe-area-inset-bottom) + 232px)',
  creatures: 'calc(env(safe-area-inset-bottom) + 296px)',
  stats: 'calc(env(safe-area-inset-bottom) + 360px)',
} as const;

export function div(style: Partial<CSSStyleDeclaration>): HTMLDivElement {
  const element = document.createElement('div');
  Object.assign(element.style, style);
  return element;
}

export function uiButton(label: string, onClick: () => void): HTMLButtonElement {
  const element = document.createElement('button');
  element.textContent = label;
  Object.assign(element.style, {
    minWidth: '44px',
    minHeight: '48px',
    padding: '8px 12px',
    border: '1px solid rgba(255,255,255,0.16)',
    borderRadius: '9px',
    color: '#e8f0ea',
    background: '#2f6b43',
    font: '14px system-ui, sans-serif',
    pointerEvents: 'auto',
    // Keep taps crisp without swallowing vertical swipes inside scrollable menus.
    touchAction: 'manipulation',
    cursor: 'pointer',
    webkitTapHighlightColor: 'transparent',
    transition: 'transform 0.06s',
  } satisfies Partial<CSSStyleDeclaration> & { webkitTapHighlightColor?: string });
  pressFeedback(element);
  element.addEventListener('click', (event) => {
    event.stopPropagation();
    onClick();
  });
  return element;
}

/** Apply the dense, left-aligned card treatment used by the Build palette. */
export function paletteCard(button: HTMLButtonElement): HTMLButtonElement {
  Object.assign(button.style, {
    display: 'block', width: '100%', minHeight: '58px', marginTop: '10px',
    padding: '10px 12px', textAlign: 'left', lineHeight: '1.3', touchAction: 'pan-y',
    background: 'rgba(30,48,37,0.94)',
  } satisfies Partial<CSSStyleDeclaration>);
  return button;
}

/** Small overline used to separate groups within menu palettes. */
export function paletteSection(label: string): HTMLDivElement {
  const section = div({
    marginTop: '16px', color: 'rgba(232,240,234,0.64)', fontSize: '11px',
    fontWeight: '700', letterSpacing: '0.08em', textTransform: 'uppercase',
  });
  section.textContent = label;
  return section;
}

/**
 * A right-rail toggle: an icon stacked over a short label. The aria-label is
 * exactly the plain label so accessible names (and tests) ignore the icon.
 */
export function railButton(icon: string, label: string, onClick: () => void): HTMLButtonElement {
  const element = uiButton('', onClick);
  element.setAttribute('aria-label', label);
  Object.assign(element.style, {
    position: 'absolute',
    right: RAIL_RIGHT,
    width: '64px',
    minHeight: '56px',
    padding: '6px 4px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '2px',
    background: 'rgba(30,48,37,0.94)',
  } satisfies Partial<CSSStyleDeclaration>);
  const glyph = document.createElement('span');
  glyph.textContent = icon;
  glyph.setAttribute('aria-hidden', 'true');
  Object.assign(glyph.style, { fontSize: '19px', lineHeight: '1' } satisfies Partial<CSSStyleDeclaration>);
  const text = document.createElement('span');
  text.textContent = label;
  Object.assign(text.style, { fontSize: '11px', fontWeight: '600' } satisfies Partial<CSSStyleDeclaration>);
  element.append(glyph, text);
  return element;
}

/** Mark a toggle's expanded state and the panel it controls for AT users. */
export function wireDisclosure(toggle: HTMLButtonElement, panel: HTMLElement, panelId: string): void {
  panel.id = panelId;
  toggle.setAttribute('aria-controls', panelId);
  toggle.setAttribute('aria-expanded', 'false');
}

function pressFeedback(element: HTMLButtonElement): void {
  const release = () => {
    element.style.transform = '';
  };
  element.addEventListener('pointerdown', () => {
    if (!element.disabled) element.style.transform = 'scale(0.94)';
  });
  element.addEventListener('pointerup', release);
  element.addEventListener('pointerleave', release);
  element.addEventListener('pointercancel', release);
}
