/** Shared local icon set. SVG keeps silhouettes consistent and avoids OS emoji variants. */
export type UiIconName = 'axe' | 'pick' | 'sickle' | 'sword' | 'bow' | 'staff' | 'bag' | 'gear' | 'craft' | 'build' | 'creature' | 'character' | 'coin' | 'blueprint';

const ICON_MARKUP: Readonly<Record<UiIconName, string>> = {
  axe: '<path d="M6 21 16 8M11 5l6-2 4 4-3 6-7-8Z"/><path d="m14 9 4 4"/>',
  pick: '<path d="M7 21 16 8M5 8c4-5 11-6 16-2M16 8l3 3"/>',
  sickle: '<path d="M7 21 13 9M13 9c1-5 5-7 9-6-1 7-5 11-11 12"/>',
  bow: '<path d="M6 3c7 2 11 6 13 13M6 3 4 21M19 16l2 5-5-2M5 5l14 14"/>',
  sword: '<path d="M20 3 10 13M8 15l-3 3 1 2 2 1 3-3M6 18l-3 3M14 5l5-2 2 2-2 5"/>',
  staff: '<path d="M9 21 14 7M14 7l-3-3 4-2 3 3-2 4-2-2Z"/><path d="m12 12 3 1M11 16l3 1"/>',
  bag: '<path d="M6 8h12l2 13H4L6 8Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2M8 12h8M12 12v6"/>',
  gear: '<path d="M9 3h6l1 3 3-1 3 5-2 2 2 2-3 5-3-1-1 3H9l-1-3-3 1-3-5 2-2-2-2 3-5 3 1 1-3Z"/><circle cx="12" cy="12" r="3"/>',
  craft: '<path d="m5 20 9-9M13 5l3-3 6 6-3 3-6-6ZM3 15l6 6M15 13l6 6"/>',
  build: '<path d="M3 5h8v6H3V5Zm10 0h8v6h-8V5ZM7 13h10v6H7v-6Z"/>',
  creature: '<circle cx="7" cy="8" r="2"/><circle cx="17" cy="8" r="2"/><circle cx="4" cy="13" r="2"/><circle cx="20" cy="13" r="2"/><path d="M7 19c0-4 2-7 5-7s5 3 5 7c-3 2-7 2-10 0Z"/>',
  character: '<circle cx="12" cy="7" r="4"/><path d="M5 21c1-6 3-9 7-9s6 3 7 9M9 17h6"/>',
  coin: '<circle cx="12" cy="12" r="9"/><path d="M15 8.5c-.7-.5-1.7-.8-2.8-.8-1.6 0-2.7.8-2.7 2s1.1 1.8 2.7 2.2c1.6.4 2.8.8 2.8 2.3s-1.2 2.1-2.9 2.1c-1.2 0-2.4-.4-3.2-1M12 5.8v12.4"/>',
  // A rolled sheet: reads as "a blueprint" generically, so it can stand in for
  // any undiscovered entry without hinting at which one it is.
  blueprint: '<path d="M4 5h13v14H4V5Z"/><path d="M17 5a2 3 0 0 1 0 14M7 9h6M7 12h6M7 15h4"/>',
};

export function setUiIcon(container: HTMLElement, name: UiIconName, size = 20): void {
  container.replaceChildren();
  container.classList.add('elaris-icon');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'square');
  svg.setAttribute('stroke-linejoin', 'miter');
  svg.style.display = 'block';
  svg.style.filter = 'drop-shadow(1px 1px 0 #0b120e)';
  svg.innerHTML = ICON_MARKUP[name];
  container.appendChild(svg);
}

export function createUiIcon(name: UiIconName, size = 20): HTMLSpanElement {
  const icon = document.createElement('span');
  setUiIcon(icon, name, size);
  icon.setAttribute('aria-hidden', 'true');
  return icon;
}
