/** Shared local icon set. SVG keeps silhouettes consistent and avoids OS emoji variants. */
export type UiIconName = 'axe' | 'pick' | 'sickle' | 'sword' | 'bow' | 'staff' | 'bag' | 'gear' | 'craft' | 'build' | 'creature' | 'character' | 'coin' | 'blueprint'
  | 'crest'|'quest'|'compass'|'shelter'|'garden'|'wood'|'stone'|'fiber'|'berry'|'ore'|'ingot'|'arrow'|'snare'|'mask'|'close'|'heart'|'stamina'|'mana';

const ICON_MARKUP: Readonly<Record<UiIconName, string>> = {
  crest:'<path d="M12 2 21 6v6c0 5-5 8-9 10-4-2-9-5-9-10V6l9-4Z"/><path d="M12 18V8m0 7c-5 0-6-4-6-5 5 0 6 3 6 5Zm0-3c0-4 3-6 6-6 0 4-2 6-6 6Z"/>',
  quest:'<path d="M5 3h13v18H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm0 0v18M9 7h5M9 11h5M9 15h3M18 5h3v16h-3"/>',
  compass:'<circle cx="12" cy="12" r="9"/><path d="m16 8-2 6-6 2 2-6 6-2ZM12 1v3m0 16v3M1 12h3m16 0h3"/>',
  shelter:'<path d="m2 11 10-8 10 8M5 10v11h14V10M10 21v-7h4v7M8 7V3h3"/>',
  garden:'<path d="M12 21V10m0 6c-5 0-8-3-8-7 5 0 8 3 8 7Zm0-5c0-5 3-8 8-8 0 5-3 8-8 8ZM4 21h16"/>',
  wood:'<path d="m5 9 10-6 6 5-10 7-6-6Zm0 0-3 6 6 6 3-6m-3 6 10-6 3-7"/><ellipse cx="7" cy="15" rx="2" ry="3" transform="rotate(-37 7 15)"/><path d="m12 9 5-3"/>',
  stone:'<path d="m3 15 3-9 10-3 6 8-4 9-11 1-4-6Zm3-9 6 7 10-2m-10 2-5 8m5-8 6 7"/>',
  fiber:'<path d="M7 21c5-5 9-11 10-18M7 17c-5-1-5-6-4-8 4 2 5 4 4 8Zm4-5c-4-1-4-5-3-7 4 1 5 4 3 7Zm3-4c0-5 4-6 7-6-1 5-3 6-7 6Zm-5 9c4 1 8-1 9-5-4-1-7 1-9 5Z"/>',
  berry:'<circle cx="8" cy="15" r="4"/><circle cx="15" cy="16" r="4"/><circle cx="12" cy="9" r="4"/><path d="M12 5c0-3 3-4 6-3-1 3-4 4-6 3ZM7 13h.01M14 14h.01M11 7h.01"/>',
  ore:'<path d="m4 16 2-8 5-3 3 5 5-2 3 9-9 5-9-6Zm2-8 5 8 3-6m-3 6 8-8m-8 8 2 6"/><path d="m14 3 2-2 1 3 3 1-3 1-1 3-1-3-3-1 2-1Z"/>',
  ingot:'<path d="m5 6 14 1 3 10-16 2-4-5 3-8Zm0 0 4 7 13 4M9 13l-3 6"/>',
  arrow:'<path d="m3 21 17-17m-6 0 7-1-1 7M3 15l6 6M3 18l3 3"/>',
  snare:'<ellipse cx="12" cy="11" rx="8" ry="7"/><ellipse cx="12" cy="11" rx="5" ry="4"/><path d="M5 16c-3 2-2 6 2 5s7-3 9-1M18 6l3-3"/>',
  mask:'<path d="M5 8c5 3 9 3 14 0v8c-5 5-9 5-14 0V8ZM5 9c-5-3-5 7 0 7m14-7c5-3 5 7 0 7M9 13h6m-6 3h6"/>',
  close:'<path d="m6 6 12 12M6 18 18 6"/>',
  heart:'<path d="M12 21C-3 12 3 1 10 6l2 2 2-2c7-5 13 6-2 15Z"/>',
  stamina:'<path d="m14 2-9 12h7l-2 8 9-13h-7l2-7Z"/>',
  mana:'<path d="m12 2 8 10-8 10-8-10 8-10Zm0 0v20M4 12h16"/>',
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
  svg.setAttribute('stroke-width', '1.65');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.style.display = 'block';
  svg.innerHTML = ICON_MARKUP[name];
  container.appendChild(svg);
}

export function createUiIcon(name: UiIconName, size = 20): HTMLSpanElement {
  const icon = document.createElement('span');
  setUiIcon(icon, name, size);
  icon.setAttribute('aria-hidden', 'true');
  return icon;
}
