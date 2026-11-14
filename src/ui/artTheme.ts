/** The 3D game's shared leather, ink, linen and brushed-brass visual language. */
export function installArtTheme(): void {
  if(document.getElementById('elaris-art-direction'))return;
  const style=document.createElement('style');style.id='elaris-art-direction';
  style.textContent=`
html[data-presentation="3d"] {
 --art-ink:#f2ead7;--art-muted:#b6c2b5;--art-gold:#c9af78;--art-dark:#142a28;--art-line:rgba(206,183,133,.44);
 --elaris-font-display:Georgia,'Palatino Linotype',serif;--elaris-border:#9f8a61;--elaris-accent:#dac38e;
}
[data-presentation="3d"] .elaris-panel {
 color:var(--art-ink)!important;border:1px solid var(--art-line)!important;border-radius:12px!important;
 background:linear-gradient(145deg,rgba(29,48,44,.97),rgba(12,28,27,.97))!important;
 box-shadow:0 8px 24px #0513104d,inset 0 1px #f8e2ad16!important;
}
[data-presentation="3d"] .elaris-button {
 color:#f4ecd8!important;border:1px solid #bca57859!important;border-radius:8px!important;
 background:linear-gradient(155deg,#36544a,#203c35)!important;
 box-shadow:inset 0 1px #fbe6b21c,0 3px 9px #09171333!important;
 font-weight:650!important;letter-spacing:.015em;transition:background .15s,box-shadow .15s,transform .1s;
}
[data-presentation="3d"] .elaris-button:hover:not(:disabled){background:linear-gradient(155deg,#496b58,#2c4c40)!important;border-color:#d1bb83a6!important}
[data-presentation="3d"] .elaris-button[aria-pressed="true"],
[data-presentation="3d"] .elaris-button[aria-selected="true"]{border-color:#ddc18a!important;box-shadow:inset 0 0 0 1px #d8bd7866,0 0 14px #e0b76a22!important}
[data-presentation="3d"] .elaris-button:disabled{opacity:.42!important;filter:saturate(.3)!important}
[data-presentation="3d"] [data-delete-structure]{background:linear-gradient(145deg,#855044,#59352f)!important;border-color:#d39c78!important;color:#fff0db!important}
[data-presentation="3d"] [data-ui-panel] {color:#f3ead7;font-family:'Segoe UI',system-ui,sans-serif}
[data-presentation="3d"] [data-ui-panel] h1,[data-presentation="3d"] [data-ui-panel] h2 {font-family:Georgia,'Palatino Linotype',serif!important;letter-spacing:.035em}
[data-presentation="3d"] [data-world-journal]{top:14px!important;left:14px!important;gap:9px!important}
[data-presentation="3d"] [data-world-map-frame]{border-radius:14px!important;padding:7px!important;border-color:#cab37a99!important}
[data-presentation="3d"] [data-world-map-frame] canvas{border-radius:7px!important;filter:saturate(.65) sepia(.1)}
[data-presentation="3d"] [data-coin-score]{font:700 13px Georgia,serif!important;min-height:32px!important;letter-spacing:.05em}
[data-presentation="3d"] [aria-label="Active quests"]{padding:2px 0!important;border-color:#bbab7c55!important;font-size:11px!important;line-height:1.5!important}
[data-presentation="3d"] [aria-label="Active quests"] strong{font-family:Georgia,serif;color:#e6d2a4!important;font-size:12px}
[data-presentation="3d"] [data-hud-status-stack]{top:14px!important;right:14px!important;gap:6px!important}
[data-presentation="3d"] [data-survival-timer]{border:1px solid #c6ad754d!important;background:linear-gradient(135deg,#152e2aed,#0c211feb)!important;border-radius:10px!important;font:700 11px/1.45 'Segoe UI',sans-serif!important;letter-spacing:.055em;padding:8px 12px!important;box-shadow:0 5px 16px #0b211c29}
[data-presentation="3d"] [data-player-xp]{border-radius:10px!important;border:1px solid #b39d6d55!important;background:#112722e8!important;box-shadow:0 5px 16px #0b211c29!important}
[data-presentation="3d"] [data-player-xp-fill]{background:linear-gradient(90deg,#94ad86,#dec785)!important;border-radius:4px}
[data-presentation="3d"] [role="toolbar"][aria-label="Hotbar"]{padding:7px!important;gap:6px!important;background:linear-gradient(150deg,#40382bec,#1c3028f2)!important;border-radius:14px!important;border-color:#c1a16d99!important}
[data-presentation="3d"] [aria-label="Hotbar"] button{width:48px!important;min-height:46px!important;border-radius:8px!important;background:linear-gradient(155deg,#3d4b38,#26362b)!important}
[data-presentation="3d"] [data-action-button]{border-radius:18px!important;background:linear-gradient(145deg,#d3ba7d,#9a7948)!important;color:#172d26!important;font-weight:800!important;border-color:#f1dc9c!important;box-shadow:0 5px 20px #05191355,inset 0 1px #fff3c766!important}
[data-presentation="3d"] [data-sprint-toggle]{border-radius:10px!important;background:#19382fe6!important;font-size:11px!important}
[data-presentation="3d"] [data-rail-button]{border-radius:12px!important;background:#17352dec!important;border-color:#bba36d66!important}
[data-presentation="3d"] [data-dpad-base]{background:radial-gradient(circle,#223f313d,#1d3b2b14)!important;border:1px solid #e3d5b633!important;box-shadow:inset 0 0 16px #183c2422}
[data-presentation="3d"] [data-dpad-thumb]{background:#e3ddbf44!important;border:1px solid #e3d5b633}
[data-presentation="3d"] [data-area-splash]{top:12%!important;padding:11px 26px!important;border:1px solid #d5bc8055!important;background:linear-gradient(135deg,#1c352dee,#122820ee)!important;border-radius:3px 16px!important;font:600 19px Georgia,serif!important;letter-spacing:.08em;box-shadow:0 8px 30px #152a2233}
[data-presentation="3d"] .elaris-battle>div:first-child{padding-top:18px!important;font-family:Georgia,serif!important}
[data-presentation="3d"] .eb-bottom{background:linear-gradient(0deg,#102622fa,#142c27ed)!important;border-top:1px solid #cdb77b88!important;gap:12px!important;padding:12px 16px 16px!important;box-shadow:0 -10px 40px #10221d33}
[data-presentation="3d"] .eb-plate{border-radius:12px!important;background:#1a342be8!important;border-color:#c7ac704d!important}
[data-presentation="3d"] .eb-plate>div:first-child{background:transparent!important;color:#ead5a6!important;font-family:Georgia,serif!important}
[data-presentation="3d"] .eb-actions .elaris-button{min-height:44px!important;font-size:12px!important}
[data-presentation="3d"] .eb-actions .elaris-button[aria-label="Melee attack"],
[data-presentation="3d"] .eb-actions .elaris-button[aria-label="Ranged attack"],
[data-presentation="3d"] .eb-actions .elaris-button[aria-label="Magic attack"]{background:linear-gradient(145deg,#654b3b,#443c2e)!important;border-color:#c1a36f99!important}
@media(max-width:600px){
 [data-presentation="3d"] [data-world-journal]{top:9px!important;left:9px!important;gap:6px!important}
 [data-presentation="3d"] [data-hud-status-stack]{top:9px!important;right:9px!important;max-width:170px!important}
 [data-presentation="3d"] [data-survival-timer]{font-size:10px!important;padding:6px 8px!important}
 [data-presentation="3d"] [role="toolbar"][aria-label="Hotbar"]{gap:4px!important;padding:5px!important}
 [data-presentation="3d"] [aria-label="Hotbar"] button{width:clamp(30px,calc((100vw - 198px)/5),40px)!important;min-height:44px!important}
 [data-presentation="3d"] .eb-bottom{padding:7px 8px 10px!important;gap:6px!important}
 [data-presentation="3d"] .eb-actions .elaris-button{font-size:10px!important;min-height:40px!important;padding:5px!important}
 [data-presentation="3d"] [data-area-splash]{font-size:15px!important;max-width:65vw!important;top:24%!important}
}
@media(prefers-contrast:more){[data-presentation="3d"] .elaris-panel,[data-presentation="3d"] .elaris-button{border-color:#e7d3a3!important}}
@media(orientation:landscape) and (max-height:500px){
 [data-presentation="3d"] [data-world-journal]{top:9px!important;left:9px!important;gap:6px!important}
 [data-presentation="3d"] [data-world-map-frame]{width:80px!important;padding:5px!important}
 [data-presentation="3d"] [data-world-map-frame] canvas{width:80px!important;height:80px!important}
 [data-presentation="3d"] [aria-label="Open large map"]{left:59px!important;top:43px!important}
 [data-presentation="3d"] [aria-label="Active quests"]{width:96px!important;max-height:86px!important;overflow-y:auto!important;font-size:10px!important}
 [data-presentation="3d"] [data-hud-status-stack]{top:9px!important;right:98px!important;max-width:190px!important;gap:5px!important}
 [data-presentation="3d"] [data-survival-timer]{font-size:10px!important;padding:5px 8px!important}
 [data-presentation="3d"] [data-rail-button][aria-label="Menu"]{bottom:174px!important}
 [data-presentation="3d"] [data-rail-button][aria-label="Admin"]{bottom:238px!important}
 [data-presentation="3d"] [aria-label="Hotbar"] button{width:44px!important;min-height:44px!important}
}
@media(prefers-reduced-motion:reduce){[data-presentation="3d"] .elaris-button{transition:none!important}}
`;
  document.head.appendChild(style);
}
