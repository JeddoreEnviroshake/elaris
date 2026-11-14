/**
 * Who gets the Admin menu.
 *
 * The public build is embedded on jeddore.com and installed by players, so the
 * Admin rail button is hidden unless this browser has asked for it. Open the
 * game once with `?admin=1` to turn it on (remembered in this browser), or with
 * `?admin=0` to turn it off again. Development builds always show it.
 *
 * This only hides the menu. Publishing global balance is still gated by the
 * Firebase admin sign-in and the Firestore rules.
 */
const STORAGE_KEY = 'elaris.adminMenu';

type FlagStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function browserStorage(): FlagStorage | undefined {
  try {
    return window.localStorage;
  } catch {
    // Storage can be blocked (private mode, embedded frames); the URL still works.
    return undefined;
  }
}

export function adminMenuEnabled(
  locationSearch: string = window.location.search,
  storage: FlagStorage | undefined = browserStorage(),
  dev: boolean = import.meta.env.DEV,
): boolean {
  const requested = new URLSearchParams(locationSearch).get('admin');
  if (requested !== null) {
    const on = requested !== '0' && requested !== 'false' && requested !== 'off';
    try {
      if (on) storage?.setItem(STORAGE_KEY, '1');
      else storage?.removeItem(STORAGE_KEY);
    } catch {
      // A blocked write only means the choice is not remembered.
    }
    return on || dev;
  }
  if (dev) return true;
  try {
    return storage?.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}
