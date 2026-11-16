import type {SpeciesId} from '../simulation/state';

const PORTRAITS:readonly (SpeciesId|'player')[]=['player','tuftle','craghopper','glade-stag','snarlfox','masonmole','slingtail','bulwark-boar','quillfinch','mistmoth'];

/** A static atlas rendered from the original game rigs; no extra WebGL context in menus. */
export function characterPortrait(id:SpeciesId|'player',size=72):HTMLSpanElement {
  const portrait=document.createElement('span');
  portrait.className='elaris-portrait';portrait.setAttribute('aria-hidden','true');
  portrait.style.setProperty('--portrait-size',`${size}px`);
  setCharacterPortrait(portrait,id);
  return portrait;
}
export function setCharacterPortrait(portrait:HTMLElement,id:SpeciesId|'player'):void {
  const index=PORTRAITS.indexOf(id);
  portrait.style.setProperty('--portrait-position',`${(index%5)*25}% ${Math.floor(index/5)*100}%`);
}
