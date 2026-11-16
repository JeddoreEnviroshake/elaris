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
import { LocalWorlds, type LocalWorld } from './persistence/localWorlds';
import { worldDatabaseName } from './persistence/IndexedDbSaveRepository';
import { SessionMenu } from './ui/sessionMenu';

/**
 * Menu-first boot. The local directory adopts the old save before listing
 * worlds; a world gets its own controller, scene and renderer only when chosen.
 */
const appEl = document.getElementById('app') ?? document.body;
installUiTheme();
installArtTheme();
// Before Phaser starts listening: keys typed into panel fields must never reach
// the game's captured bindings, or admin values can't be edited.
installTypingGuard();
const chrome = new AppChrome(appEl);
const worlds = new LocalWorlds();
let activeController: SaveController | null = null;
let starting = false;
const menu = new SessionMenu(appEl, {
  onContinue: (world) => startWorld(world),
  onCreate: async (name) => {
    const world = await worlds.create(name, DEFAULT_WORLD_SEED);
    try { await startWorld(world, true); }
    catch (error) {
      // Creation is durable even if rendering or loading the world fails.
      menu.show(await worlds.list());
      throw error;
    }
  },
  onRetry: showMenu,
});

async function showMenu(): Promise<void> {
  try {
    await worlds.open();
    menu.show(await worlds.list());
  } catch (error) {
    menu.show([], error instanceof Error ? error.message : String(error));
  }
}

async function startWorld(world: LocalWorld, fresh = false): Promise<void> {
  if (starting || activeController) return;
  let sessionGame: Phaser.Game | null = null;

  const state = createInitialState(world.seed);
  const controller = new SaveController(state, {
    repository: { worldId: world.id },
    requireExistingSave: true,
    onStatus: (status, detail) => {
      chrome.setSaveStatus(status, detail);
      if (status === 'readonly' && sessionGame) {
        sessionGame.scene.pause('world');
        chrome.flashSaved('This world is now read-only. Return to the menu to reopen it.');
      }
    },
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
  starting = true;
  activeController = controller;
  try {

    // Load/lease before rendering so the world reflects the persisted save.
    await controller.start();
    if (controller.status !== 'writer') throw new Error('This world is already open in another window. Close it there, then try again.');
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
    if (fresh && loadedGlobalBalance.source !== 'local-fallback') {
      state.player = createPlayerState(loadedGlobalBalance.values);
    }
    const globalApply = applyGameBalance(state, loadedGlobalBalance.values);
    if (!globalApply.ok) console.warn('[global-balance]', globalApply.message);
    else await controller.saveCritical();

    const game = new Phaser.Game({
      type: Phaser.HEADLESS,
      parent: 'game',
      scale: {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.CENTER_BOTH,
        width: '100%',
        height: '100%',
      },
      // The fixed-step accumulator already handles timing and interpolation.
      // Phaser's startup/focus smoothing clamps the first 120 frames to 60 Hz,
      // making gameplay run in slow motion on displays rendering below 60 FPS.
      fps: { smoothStep: false },
      scene: [],
    });
    sessionGame = game;
    const threeHost = document.getElementById('three-game');
    if (!threeHost) throw new Error('Missing #three-game host');
    const renderer3d = new Elaris3DRenderer(threeHost, state);
    // The camera angle is a published global value, so the loaded balance decides
    // how the world is framed before the first frame rather than the default tilt.
    renderer3d.setCameraOrientation(cameraOrientationFromTenths(state.gameBalance.camera));
    // Three.js is the only renderer; Phaser retains timing, keyboard and scene lifecycle.
    document.documentElement.dataset.presentation = '3d';
    const systemControls = {
      quitToMenu,
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
      system: systemControls,
    });
    renderer3d.setPresentationProvider(() => {
      const scene = game.scene.getScene('world') as WorldScene | null;
      return scene?.scene.isActive() ? scene.get3DPresentationState() : null;
    });
    // Present the pose produced by this frame's simulation, on the same clock.
    game.events.on(Phaser.Core.Events.POST_STEP, renderer3d.renderFrame);
    game.events.once(Phaser.Core.Events.DESTROY, () => {
      game.events.off(Phaser.Core.Events.POST_STEP, renderer3d.renderFrame);
      renderer3d.dispose();
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
    let sessionDisposed = false;
    const refreshScale = (): void => {
      if (sessionDisposed) return;
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
    const removeScaleListeners = (): void => {
      sessionDisposed = true;
      window.removeEventListener('orientationchange', refreshScaleSettled);
      window.visualViewport?.removeEventListener('resize', refreshScale);
      window.screen?.orientation?.removeEventListener?.('change', refreshScaleSettled);
    };
    game.events.once(Phaser.Core.Events.DESTROY, removeScaleListeners);

    // --- app chrome wiring ---
    chrome.setDiagnosticsProvider(() => {
      const scene = game.scene.getScene('world') as WorldScene | null;
      const worldPerformance = scene?.getPerformanceSnapshot();
      const savePerformance = controller.getPerformanceSnapshot();
      const frames = worldPerformance?.frameTimes;
      const entities = worldPerformance?.entities;
      const queries = worldPerformance?.interactionQueries;
      const lastSave = savePerformance.last;
      const threePerformance = renderer3d.getSnapshot();
      return {
        World: world.name,
        Viewport: `${Math.round(game.scale.gameSize.width)}×${Math.round(game.scale.gameSize.height)}`,
        Presentation: '3D',
        Renderer: 'Three.js WebGL',
        '3D scene': `${threePerformance.visibleModels} models · ${threePerformance.drawCalls} draws · ${threePerformance.triangles} tris`,
        FPS: frames?.meanMs ? `${(1000 / frames.meanMs).toFixed(1)} avg` : '—',
        'Frame time': frames?.p50Ms != null
          ? `p50 ${formatMs(frames.p50Ms)} · p95 ${formatMs(frames.p95Ms)} · p99 ${formatMs(frames.p99Ms)}`
          : '—',
        'Long frames': frames ? `${frames.longCount}/${frames.count} over 33ms` : '—',
        'Area transition': worldPerformance?.areaTransitions.count
          ? `p50 ${formatMs(worldPerformance.areaTransitions.p50Ms)} · p95 ${formatMs(worldPerformance.areaTransitions.p95Ms)}`
          : '—',
        '3D frame work': threePerformance.frameWork.p50Ms != null
          ? `p50 ${formatMs(threePerformance.frameWork.p50Ms)} · p95 ${formatMs(threePerformance.frameWork.p95Ms)} · max ${formatMs(threePerformance.frameWork.maxMs)}`
          : '—',
        '3D area rebuild': threePerformance.areaRebuild.count
          ? `last ${formatMs(threePerformance.areaRebuild.latestMs)} · max ${formatMs(threePerformance.areaRebuild.maxMs)} (${threePerformance.areaRebuild.count})`
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
          system: systemControls,
      });
    }

    function formatMs(value: number | null): string {
      return value == null ? '—' : `${value.toFixed(1)}ms`;
    }

    let quitting = false;
    async function quitToMenu(): Promise<void> {
      if (quitting) return;
      quitting = true;
      game.scene.pause('world');
      appEl.inert = true;
      try {
        // Pause first, then save the final pose before releasing this world's lease.
        await controller.saveCritical();
        await worlds.markPlayed(world.id);
        await controller.flushAndRelease();
      } catch (error) {
        appEl.inert = false;
        quitting = false;
        if (controller.repo.isWriter()) game.scene.resume('world');
        chrome.flashSaved(`Could not save: ${String(error)}. Your world is still open; try again.`);
        return;
      }
      game.scene.stop('world');
      activeController = null;
      controller.dispose();
      chrome.setSaveActions(null);
      chrome.setDiagnosticsProvider(() => ({}));
      if (import.meta.env.DEV) {
        const debug = globalThis as unknown as Record<string, unknown>;
        delete debug.__game; delete debug.__controller; delete debug.__renderer3d;
      }
      await new Promise<void>((resolve) => {
        game.events.once(Phaser.Core.Events.DESTROY, () => resolve());
        game.destroy(true);
      });
      appEl.inert = false;
      delete document.documentElement.dataset.worldDatabase;
      delete document.documentElement.dataset.worldId;
      await showMenu();
    }

    // Dev-only handle for debugging and browser (e2e) tests; stripped in production.
    if (import.meta.env.DEV) {
      const g = globalThis as unknown as {
        __game: Phaser.Game;
        __controller: SaveController;
        __renderer3d: Elaris3DRenderer;
      };
      g.__game = game;
      g.__controller = controller;
      g.__renderer3d = renderer3d;
    }
    await worlds.markPlayed(world.id);
    document.documentElement.dataset.worldDatabase = worldDatabaseName('default', world.id);
    document.documentElement.dataset.worldId = world.id;
    menu.hide();
  } catch (error) {
    sessionGame?.destroy(true);
    await controller.repo.releaseWriter().catch(() => undefined);
    controller.dispose();
    activeController = null;
    throw error;
  } finally {
    starting = false;
  }
}

// PWA and page lifecycle belong to the app, not any particular world session.
initPwa({
  onOfflineReady: () => chrome.markOfflineReady(),
  onUpdateReady: (applyUpdate) => chrome.showUpdateReady(applyUpdate),
  onError: (error) => console.warn('[pwa]', error),
});
setBeforeReload(async () => { await activeController?.flushAndRelease(); });
window.addEventListener('pagehide', (event: PageTransitionEvent) => {
  if (event.persisted) void activeController?.flush();
  else void activeController?.flushAndRelease();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') void activeController?.flush();
});
await showMenu();
