import { registerSW } from 'virtual:pwa-register';

/**
 * Service-worker lifecycle wiring for a safe, non-blocking update flow.
 *
 * - Registration does NOT skipWaiting: a new build waits until the user
 *   consents, so code is never swapped beneath a running session.
 * - `onOfflineReady` fires only after precaching completes — that is the real
 *   "Ready offline" signal, not merely a loaded page.
 * - `applyUpdate` runs a caller-supplied `beforeReload` (used from Milestone 2
 *   onward to flush the save and release the writer lease) before activating
 *   the waiting worker and reloading on controllerchange.
 */
export interface PwaHandlers {
  /** A waiting worker exists; show a non-blocking "Update ready" notice. */
  onUpdateReady: (applyUpdate: () => Promise<void>) => void;
  /** Precache finished; the app can now cold-launch offline. */
  onOfflineReady: () => void;
  /** Registration errored (best-effort; app still runs online). */
  onError?: (error: unknown) => void;
}

export function initPwa(handlers: PwaHandlers): void {
  // No-op in dev (SW disabled) and where SW is unsupported.
  if (!('serviceWorker' in navigator)) return;

  let beforeReload: () => Promise<void> = async () => {};

  const updateSW = registerSW({
    onNeedRefresh() {
      handlers.onUpdateReady(async () => {
        // "Save and update": flush first, then activate + reload.
        try {
          await beforeReload();
        } catch (error) {
          handlers.onError?.(error);
          // If saving failed, keep the session; do not risk progress.
          return;
        }
        await updateSW(true);
      });
    },
    onOfflineReady() {
      handlers.onOfflineReady();
    },
    onRegisterError(error) {
      handlers.onError?.(error);
    },
  });

  // Allow later milestones to register a save/flush step run before reload.
  setBeforeReload = (fn) => {
    beforeReload = fn;
  };
}

/** Set the async step run before an update reload (e.g. flush save + release lease). */
export let setBeforeReload: (fn: () => Promise<void>) => void = () => {};
