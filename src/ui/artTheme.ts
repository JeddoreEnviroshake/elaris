import woodlandStyles from './woodland.css?inline';

/** Local, texture-free woodland journal styling shared by gameplay surfaces. */
export function installArtTheme(): void {
  if(document.getElementById('elaris-art-direction'))return;
  const style=document.createElement('style');style.id='elaris-art-direction';
  style.textContent=woodlandStyles;document.head.appendChild(style);
}
