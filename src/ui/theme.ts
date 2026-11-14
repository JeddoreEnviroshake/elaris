export const UI = {
  ink: '#f5ecd6',
  inkMuted: '#b9c7ba',
  panel: '#17231c',
  panelRaised: '#203328',
  panelDeep: '#0b120e',
  border: '#6f8a61',
  borderBright: '#d5ae58',
  accent: '#d5ae58',
  success: '#65a66d',
  warning: '#d58a4a',
  danger: '#bd5c52',
  radius: '4px',
  fontBody: 'system-ui, -apple-system, Segoe UI, sans-serif',
  fontDisplay: '"Trebuchet MS", system-ui, sans-serif',
} as const;

export function installUiTheme(): void {
  if (document.getElementById('elaris-ui-theme')) return;
  const style = document.createElement('style');
  style.id = 'elaris-ui-theme';
  style.textContent = `
:root {
  --elaris-ink: ${UI.ink}; --elaris-ink-muted: ${UI.inkMuted};
  --elaris-panel: ${UI.panel}; --elaris-panel-raised: ${UI.panelRaised}; --elaris-panel-deep: ${UI.panelDeep};
  --elaris-border: ${UI.border}; --elaris-border-bright: ${UI.borderBright}; --elaris-accent: ${UI.accent};
  --elaris-success: ${UI.success}; --elaris-warning: ${UI.warning}; --elaris-danger: ${UI.danger};
  --elaris-font-body: ${UI.fontBody}; --elaris-font-display: ${UI.fontDisplay};
}
.elaris-panel { border: 2px solid var(--elaris-border) !important; border-radius: 4px !important; background: linear-gradient(#203328, #15231b) !important; box-shadow: 0 0 0 2px #0b120e, 0 8px 18px rgba(0,0,0,.38) !important; }
.elaris-button { border: 2px solid #56704f !important; border-radius: 3px !important; background: linear-gradient(#38583f, #274331) !important; color: var(--elaris-ink) !important; box-shadow: inset 0 1px rgba(255,255,255,.08), 0 2px #0b120e !important; font-family: var(--elaris-font-body) !important; }
.elaris-button:focus-visible { outline: 3px solid var(--elaris-accent); outline-offset: 2px; }
/* Grayscale alone barely registered on the low-saturation palette cards, so an
   unaffordable recipe still read as clickable. Dim it and drop the raised edge. */
.elaris-button:disabled { filter: grayscale(.7); opacity: .5; cursor: not-allowed !important; box-shadow: none !important; border-color: #3d4f3a !important; }
.elaris-xp-points-ready {
  transform-origin: center right;
  will-change: transform, box-shadow, border-color;
  animation: elaris-xp-gold-pulse 1.05s cubic-bezier(.4, 0, .2, 1) infinite;
}
.elaris-xp-points-ready [data-player-xp-fill] {
  animation: elaris-xp-fill-shimmer 1.05s ease-in-out infinite;
}
@keyframes elaris-xp-gold-pulse {
  0%, 100% {
    transform: scale(1);
    color: #fff0a8;
    border-color: rgba(255, 210, 63, .52);
    background: rgba(43, 31, 6, .92);
    box-shadow: 0 3px 12px rgba(0,0,0,.35), 0 0 0 0 rgba(255,210,63,0), inset 0 0 8px rgba(255,210,63,.08);
  }
  50% {
    transform: scale(1.035);
    color: #fff8d4;
    border-color: #ffd23f;
    background: rgba(72, 50, 5, .96);
    box-shadow: 0 3px 14px rgba(0,0,0,.38), 0 0 0 5px rgba(255,210,63,.16), 0 0 22px rgba(255,210,63,.72), inset 0 0 13px rgba(255,239,159,.24);
  }
}
@keyframes elaris-xp-fill-shimmer {
  0%, 100% { background: #d8a51f; filter: brightness(.95); }
  50% { background: #ffe880; filter: brightness(1.35); }
}
/* A finished quest has to read as an event, not a line item, so the banner
   arrives with a pop and then keeps a slow gold heartbeat until it is tapped. */
.elaris-quest-banner {
  will-change: transform, box-shadow, border-color;
  animation: elaris-quest-arrive .34s cubic-bezier(.2, 1.5, .5, 1) 1, elaris-quest-flash 1.25s ease-in-out .34s infinite;
}
.elaris-quest-banner:active { transform: scale(.97); }
/* The quest-log row equivalent: the same heartbeat without the arrival pop,
   because the list is rebuilt on every HUD refresh. */
.elaris-quest-ready { animation: elaris-quest-flash 1.25s ease-in-out infinite; }
.elaris-quest-claimed { animation: elaris-quest-burst .5s cubic-bezier(.2, 1.4, .4, 1) 1 forwards; }
.elaris-quest-spark { animation: elaris-quest-spark .72s ease-out 1 forwards; }
@keyframes elaris-quest-arrive {
  0% { transform: translateY(-16px) scale(.86); opacity: 0; }
  100% { transform: translateY(0) scale(1); opacity: 1; }
}
@keyframes elaris-quest-flash {
  0%, 100% {
    border-color: rgba(255, 210, 63, .55);
    box-shadow: 0 6px 18px rgba(0,0,0,.45), 0 0 0 0 rgba(255,210,63,0), inset 0 0 10px rgba(255,210,63,.06);
  }
  50% {
    border-color: #ffe88a;
    box-shadow: 0 6px 20px rgba(0,0,0,.5), 0 0 0 6px rgba(255,210,63,.18), 0 0 28px rgba(255,210,63,.75), inset 0 0 16px rgba(255,239,159,.26);
  }
}
@keyframes elaris-quest-burst {
  0% { transform: scale(1); box-shadow: 0 0 0 0 rgba(255,232,138,.9); }
  35% { transform: scale(1.12); box-shadow: 0 0 0 14px rgba(255,232,138,.28), 0 0 40px rgba(255,210,63,.9); }
  100% { transform: scale(1.02); box-shadow: 0 0 0 26px rgba(255,232,138,0), 0 0 18px rgba(255,210,63,.35); }
}
@keyframes elaris-quest-spark {
  0% { opacity: 1; transform: translate(0, 0) scale(.6) rotate(0deg); }
  100% { opacity: 0; transform: translate(var(--spark-x, 0px), var(--spark-y, -40px)) scale(1.35) rotate(160deg); }
}
.storage-transfer-layout { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
.storage-bag-pane { order: 1; }
.storage-box-pane { order: 2; }
@media (max-width: 600px) {
  .storage-transfer-layout { grid-template-columns: minmax(0, 1fr); }
  .storage-box-pane { order: 1; }
  .storage-bag-pane { order: 2; }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { scroll-behavior: auto !important; animation-duration: 1ms !important; animation-iteration-count: 1 !important; transition-duration: 1ms !important; }
  .elaris-xp-points-ready {
    color: #fff0a8 !important;
    border-color: #ffd23f !important;
    background: rgba(72, 50, 5, .96) !important;
    box-shadow: 0 3px 12px rgba(0,0,0,.35), 0 0 12px rgba(255,210,63,.6) !important;
  }
  .elaris-xp-points-ready [data-player-xp-fill] { background: #ffd23f !important; filter: none !important; }
  /* The banner still has to stand out without pulsing, so it holds the lit frame. */
  .elaris-quest-banner, .elaris-quest-ready {
    border-color: #ffe88a !important;
    box-shadow: 0 6px 18px rgba(0,0,0,.5), 0 0 16px rgba(255,210,63,.6) !important;
  }
  .elaris-quest-spark { display: none !important; }
}
@media (prefers-contrast: more) {
  .elaris-button { border-width: 3px !important; border-color: #fff0a8 !important; }
  [data-ui-panel] { border: 3px solid #fff0a8 !important; box-shadow: 0 0 0 3px #000 !important; }
  [data-testid="playable-interior"] { filter: contrast(1.22) saturate(.9); }
}
@media (forced-colors: active) {
  .elaris-button, [data-ui-panel] { forced-color-adjust: auto; border: 2px solid ButtonText !important; }
  .elaris-button:focus-visible { outline: 3px solid Highlight !important; }
  [data-testid="playable-interior"] { forced-color-adjust: none; outline: 3px solid CanvasText; }
}
`;
  document.head.appendChild(style);
}
