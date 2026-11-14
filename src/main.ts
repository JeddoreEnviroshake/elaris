import Phaser from 'phaser';
import { DEFAULT_WORLD_SEED } from './config/platform';
import { globalBalanceService } from './platform/globalBalance';
import { SaveController } from './persistence/saveController';
import { initPwa, setBeforeReload } from './platform/updates';
import { createInitialState } from './simulation/state';
import { createPlayerState } from './simulation/state';
import { applyGameBalance } from './simulation/admin';
import { recordHighestAreaTier } from './simulation/environmentProgress';
import { WorldScene } from './scenes/WorldScene';
import { AppChrome } from './ui/appChrome';
import { installUiTheme } from './ui/theme';
import { installArtTheme } from './ui/artTheme';
import { installTypingGuard } from './ui/typingGuard';
import { Elaris3DRenderer } from './three/Elaris3DRenderer';
import { cameraOrientationFromTenths, type ElarisCameraOrientation } from './three/cameraControls';
import { PresentationModeController, type PresentationMode } from './three/presentationMode';
import type { BattleRoundPresentation } from './three/battleState';

/**
 * Milestone 0 entry point. Boot order: build the save layer and load any
 * existing save first (so the world starts from persisted state), then create
 * the Phaser game and inject the shared GameState. A bounded RESIZE scale
 * strategy plus per-scene responsive zoom serves phone/tablet/desktop; rotation
 * resizes in place without a reload.
 */
const appEl = document.getElementById('app') ?? document.body;
installUiTheme();
installArtTheme();
// Before Phaser starts listening: keys typed into panel fields must never reach
// the game's captured bindings, or admin values can't be edited.
installTypingGuard();
const chrome = new AppChrome(appEl);

const state = createInitialState(DEFAULT_WORLD_SEED);
const controller = new SaveController(state, {
  onStatus: (status, detail) => chrome.setSaveStatus(status, detail),
  onOfflineSettled: (summary) => {
    const parts = [
      summary.fiberGrown > 0 ? `+${summary.fiberGrown} fiber grown` : '',
      summary.woodGrown > 0 ? `+${summary.woodGrown} wood grown` : '',
      summary.ingotsSmelted > 0 ? `+${summary.ingotsSmelted} iron ingots smelted` : '',
      // Worker output was already being settled but never reported, so a Barn
      // full of creatures looked like it had done nothing while you were away.
      summary.workerResourcesProduced > 0 ? `+${summary.workerResourcesProduced} gathered by your creatures` : '',
      summary.expeditionsReturned > 0
        ? `${summary.expeditionsReturned} expedition${summary.expeditionsReturned === 1 ? '' : 's'} home — see Orin`
        : '',
      summary.nodesRespawned > 0 ? `${summary.nodesRespawned} nodes renewed` : '',
    ].filter(Boolean);
    chrome.flashSaved(`While you were away: ${parts.join(' · ')}`);
  },
});

// Load/lease before rendering so the world reflects the persisted save.
await controller.start();
// Reconcile derived enclosure progress on load. This recovers saves whose room
// was already complete before edge-placement/enclosure fixes were installed.
recordHighestAreaTier(state);

// The character save owns local values. Firebase owns global balance; the
// saved copy is retained only as a last-known-good offline fallback.
// `?localBalance=1` keeps the bundled defaults instead of the published global
// values. Browser tests rely on it so an admin publishing new balance can never
// change what a spec asserts; normal sessions always take the Firebase copy.
const pinLocalBalance = new URLSearchParams(window.location.search).has('localBalance');
const loadedGlobalBalance = await globalBalanceService.load(state.gameBalance, { remote: !pinLocalBalance });
// A silent fallback pins the publish revision at 0, so every later publish fails
// the revision guard with no hint of why. Say which source won at boot.
if (loadedGlobalBalance.source === 'local-fallback' && !pinLocalBalance) console.warn('[global-balance]', loadedGlobalBalance.detail);
else console.info('[global-balance]', loadedGlobalBalance.detail);
if (!controller.loadedExistingSave && loadedGlobalBalance.source !== 'local-fallback') {
  state.player = createPlayerState(loadedGlobalBalance.values);
}
const globalApply = applyGameBalance(state, loadedGlobalBalance.values);
if (!globalApply.ok) console.warn('[global-balance]', globalApply.message);
else await controller.saveCritical();

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#0f1512',
  pixelArt: true,
  roundPixels: true,
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: '100%',
    height: '100%',
  },
  render: { antialias: false },
  scene: [],
});
const threeHost = document.getElementById('three-game');
if (!threeHost) throw new Error('Missing #three-game host');
const renderer3d = new Elaris3DRenderer(threeHost, state);
// The camera angle is a published global value, so the loaded balance decides
// how the world is framed before the first frame rather than the default tilt.
renderer3d.setCameraOrientation(cameraOrientationFromTenths(state.gameBalance.camera));
// The presentation toggle lives in the Admin menu, so the controller mounts no
// top-right button of its own.
const presentationMode = new PresentationModeController(appEl, game, renderer3d, { mountButton: false });
const systemControls = {
  presentation: {
    get: () => presentationMode.current,
    set: (mode: PresentationMode) => presentationMode.setMode(mode),
  },
  camera: {
    // Preview only: the published balance is what every client actually loads.
    set: (orientation: ElarisCameraOrientation) => renderer3d.setCameraOrientation(orientation),
  },
  getOfflineReady: () => chrome.isOfflineReady,
  openDiagnostics: () => chrome.openAbout(),
  resetGame: async () => {
    await controller.reset();
    restartWorld();
  },
};
game.scene.add('world', WorldScene, true, {
  state,
  onStateChanged,
  onTransitionStarted: () => controller.prepareCriticalSave(),
  globalBalance: globalBalanceService,
  is3DPresentation: () => presentationMode.current === '3d',
  onBattleRound: (round: BattleRoundPresentation) => renderer3d.playBattleRound(round),
  system: systemControls,
});
renderer3d.setPresentationProvider(() => {
  const scene = game.scene.getScene('world') as WorldScene | null;
  return scene?.scene.isActive() ? scene.get3DPresentationState() : null;
});
renderer3d.setWorldPointerHandler((worldX, worldY, intent, clientX, clientY) => {
  const scene = game.scene.getScene('world') as WorldScene | null;
  scene?.handle3DWorldPointer(worldX, worldY, intent, clientX, clientY);
});

// --- orientation-change scale correction ---
// Mobile browsers (notably iOS Safari) report stale viewport dimensions for a
// beat after `orientationchange`, so Phaser's RESIZE manager can latch onto the
// old size. Rotating portrait→landscape→portrait then leaves the canvas at the
// landscape height, centered, with black bars above and below. Re-reading the
// parent bounds once layout has settled snaps it back to full screen. We refresh
// on the next frame and again after short delays to cover slow-settling layouts.
const refreshScale = (): void => {
  // getParentBounds() re-reads the #game element's live size into parentSize;
  // refresh() then applies that to the game/canvas size. In RESIZE mode refresh()
  // alone would only re-apply a possibly-stale parentSize, so both are required.
  game.scale.getParentBounds();
  game.scale.refresh();
};
const refreshScaleSettled = (): void => {
  requestAnimationFrame(refreshScale);
  window.setTimeout(refreshScale, 100);
  window.setTimeout(refreshScale, 300);
};
window.addEventListener('orientationchange', refreshScaleSettled);
// visualViewport tracks the true rotated viewport more reliably than window on
// mobile; its resize fires after the browser chrome settles.
window.visualViewport?.addEventListener('resize', refreshScale);
// A ScreenOrientation change is the most precise signal where supported.
window.screen?.orientation?.addEventListener?.('change', refreshScaleSettled);

// --- app chrome wiring ---
chrome.setDiagnosticsProvider(() => {
  const scene = game.scene.getScene('world') as WorldScene | null;
  const cam = scene?.cameras.main;
  const worldPerformance = scene?.getPerformanceSnapshot();
  const savePerformance = controller.getPerformanceSnapshot();
  const frames = worldPerformance?.frameTimes;
  const entities = worldPerformance?.entities;
  const queries = worldPerformance?.interactionQueries;
  const lastSave = savePerformance.last;
  const threePerformance = renderer3d.getSnapshot();
  return {
    Viewport: `${Math.round(game.scale.gameSize.width)}×${Math.round(game.scale.gameSize.height)}`,
    Zoom: cam ? `${cam.zoom}×` : '—',
    Presentation: presentationMode.current.toUpperCase(),
    Renderer: presentationMode.current === '3d'
      ? 'Three.js WebGL'
      : game.renderer.type === Phaser.WEBGL ? 'Phaser WebGL' : 'Phaser Canvas',
    '3D scene': `${threePerformance.visibleModels} models · ${threePerformance.drawCalls} draws · ${threePerformance.triangles} tris`,
    FPS: frames?.meanMs ? `${(1000 / frames.meanMs).toFixed(1)} avg` : '—',
    'Frame time': frames?.p50Ms != null
      ? `p50 ${formatMs(frames.p50Ms)} · p95 ${formatMs(frames.p95Ms)} · p99 ${formatMs(frames.p99Ms)}`
      : '—',
    'Long frames': frames ? `${frames.longCount}/${frames.count} over 33ms` : '—',
    'Area transition': worldPerformance?.areaTransitions.count
      ? `p50 ${formatMs(worldPerformance.areaTransitions.p50Ms)} · p95 ${formatMs(worldPerformance.areaTransitions.p95Ms)}`
      : '—',
    Terrain: worldPerformance
      ? `${worldPerformance.terrainChunks.visible}/${worldPerformance.terrainChunks.total} chunks visible`
      : '—',
    Entities: entities ? `${entities.active}/${entities.total} active` : '—',
    'Entity mix': entities
      ? `resources ${entities.resources.active}/${entities.resources.total} · creatures ${entities.creatures.active}/${entities.creatures.total} · drops ${entities.drops.active}/${entities.drops.total} · structures ${entities.structures.active}/${entities.structures.total}`
      : '—',
    'Target queries': queries
      ? `${queries.candidates}/${queries.total} candidates · p95 ${formatMs(queries.durations.p95Ms)}`
      : '—',
    'Last save': lastSave
      ? `${lastSave.kind} ${formatMs(lastSave.totalMs)} (snapshot ${formatMs(lastSave.snapshotMs)})`
      : '—',
    'Save p95': savePerformance.durations.p95Ms != null ? formatMs(savePerformance.durations.p95Ms) : '—',
    'Global balance': `${loadedGlobalBalance.source} r${loadedGlobalBalance.revision}`,
    'SW controller': navigator.serviceWorker?.controller ? 'active' : 'none',
  };
});
chrome.setSaveActions({
  onExport: () => controller.exportToFile(),
  onImport: async () => {
    if (await controller.importFromFile()) restartWorld();
  },
  onReset: async () => {
    await controller.reset();
    restartWorld();
  },
});

function onStateChanged(kind: 'ordinary' | 'critical'): void {
  if (kind === 'critical') void controller.saveCritical();
  else controller.markDirty();
}

function restartWorld(): void {
  game.scene.getScene('world')?.scene.restart({
    state,
    onStateChanged,
    onTransitionStarted: () => controller.prepareCriticalSave(),
    globalBalance: globalBalanceService,
    is3DPresentation: () => presentationMode.current === '3d',
    onBattleRound: (round: BattleRoundPresentation) => renderer3d.playBattleRound(round),
    system: systemControls,
  });
}

function formatMs(value: number | null): string {
  return value == null ? '—' : `${value.toFixed(1)}ms`;
}

// --- service worker: precache + safe, non-blocking update prompt ---
initPwa({
  onOfflineReady: () => chrome.markOfflineReady(),
  onUpdateReady: (applyUpdate) => chrome.showUpdateReady(applyUpdate),
  onError: (error) => console.warn('[pwa]', error),
});
// "Save and update": flush + release the writer lease before the reload.
setBeforeReload(() => controller.flushAndRelease());

// --- lifecycle ---
// On real teardown (navigation/close, not bfcache) flush AND release the writer
// lease so a reload re-acquires immediately instead of waiting out the TTL.
// On mere backgrounding (bfcache or tab hidden) keep the lease and just flush.
window.addEventListener('pagehide', (e: PageTransitionEvent) => {
  if (e.persisted) void controller.flush();
  else void controller.flushAndRelease();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') void controller.flush();
});

// Dev-only handle for debugging and browser (e2e) tests; stripped in production.
if (import.meta.env.DEV) {
  const g = globalThis as unknown as {
    __game: Phaser.Game;
    __controller: SaveController;
    __renderer3d: Elaris3DRenderer;
    __presentationMode: PresentationModeController;
  };
  g.__game = game;
  g.__controller = controller;
  g.__renderer3d = renderer3d;
  g.__presentationMode = presentationMode;
}
