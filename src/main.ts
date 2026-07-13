import Phaser from 'phaser';
import { DEFAULT_WORLD_SEED } from './config/platform';
import { SaveController } from './persistence/saveController';
import { initPwa, setBeforeReload } from './platform/updates';
import { createInitialState } from './simulation/state';
import { WorldScene } from './scenes/WorldScene';
import { AppChrome } from './ui/appChrome';

/**
 * Milestone 0 entry point. Boot order: build the save layer and load any
 * existing save first (so the world starts from persisted state), then create
 * the Phaser game and inject the shared GameState. A bounded RESIZE scale
 * strategy plus per-scene responsive zoom serves phone/tablet/desktop; rotation
 * resizes in place without a reload.
 */
const appEl = document.getElementById('app') ?? document.body;
const chrome = new AppChrome(appEl);

const state = createInitialState(DEFAULT_WORLD_SEED);
const controller = new SaveController(state, {
  onStatus: (status, detail) => chrome.setSaveStatus(status, detail),
  onSaved: () => chrome.flashSaved(),
});

// Load/lease before rendering so the world reflects the persisted save.
await controller.start();

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
game.scene.add('world', WorldScene, true, {
  state,
  onStateChanged,
});

// --- app chrome wiring ---
chrome.setDiagnosticsProvider(() => {
  const scene = game.scene.getScene('world') as WorldScene | null;
  const cam = scene?.cameras.main;
  return {
    Viewport: `${Math.round(game.scale.gameSize.width)}×${Math.round(game.scale.gameSize.height)}`,
    Zoom: cam ? `${cam.zoom}×` : '—',
    Renderer: game.renderer.type === Phaser.WEBGL ? 'WebGL' : 'Canvas',
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
  game.scene.getScene('world')?.scene.restart({ state, onStateChanged });
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
  const g = globalThis as unknown as { __game: Phaser.Game; __controller: SaveController };
  g.__game = game;
  g.__controller = controller;
}
