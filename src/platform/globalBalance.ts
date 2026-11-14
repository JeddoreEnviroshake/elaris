import { signInWithEmailAndPassword, signOut } from 'firebase/auth';
import {
  doc,
  getDocFromCache,
  getDocFromServer,
  runTransaction,
  serverTimestamp,
  type DocumentSnapshot,
} from 'firebase/firestore';
import { validateGameBalance } from '../simulation/admin';
import { createDefaultGameBalance } from '../config/balance';
import type { GameBalanceState } from '../simulation/state';
import { firebaseIsConfigured, getFirebaseServices } from './firebase';

const LOAD_TIMEOUT_MS = 5_000;
const GLOBAL_BALANCE_PATH = ['gameConfig', 'globalBalance'] as const;

export type GlobalBalanceSource = 'firebase' | 'firebase-cache' | 'local-fallback';

export interface LoadedGlobalBalance {
  values: GameBalanceState;
  revision: number;
  source: GlobalBalanceSource;
  detail: string;
}

interface GlobalBalanceDocument {
  schemaVersion: 1;
  revision: number;
  values: GameBalanceState;
}

export class GlobalBalanceService {
  private loadedRevision = 0;
  private loadedSource: GlobalBalanceSource = 'local-fallback';
  private loadedDetail = 'Global values have not been loaded yet';

  get configured(): boolean { return firebaseIsConfigured(); }
  get revision(): number { return this.loadedRevision; }
  get source(): GlobalBalanceSource { return this.loadedSource; }
  /**
   * Why the current source won: the published revision, or the failure that
   * dropped this client onto the cache or the bundled defaults. A fallback
   * pins `revision` at 0, which makes every publish fail the revision guard,
   * so the reason has to stay visible rather than being swallowed by `load`.
   */
  get detail(): string { return this.loadedDetail; }

  get signedInEmail(): string | null {
    return getFirebaseServices()?.auth.currentUser?.email ?? null;
  }

  async waitForAuth(): Promise<void> {
    const auth = getFirebaseServices()?.auth;
    if (auth) await auth.authStateReady();
  }

  async signIn(email: string, password: string): Promise<void> {
    const services = getFirebaseServices();
    if (!services) throw new Error('Firebase web configuration is missing');
    if (!email.trim() || !password) throw new Error('Enter the admin email and password');
    await signInWithEmailAndPassword(services.auth, email.trim(), password);
  }

  async signOut(): Promise<void> {
    const auth = getFirebaseServices()?.auth;
    if (auth) await signOut(auth);
  }

  /**
   * `remote: false` pins the bundled defaults and skips Firebase entirely.
   * Browser tests use it so a published balance revision can never change what
   * a spec asserts; nothing in the shipped app passes it.
   */
  async load(fallback: GameBalanceState, options: { remote?: boolean } = {}): Promise<LoadedGlobalBalance> {
    if (options.remote === false) return this.useFallback(fallback, 'Pinned to the bundled defaults');
    const services = getFirebaseServices();
    if (!services) return this.useFallback(fallback, 'Firebase web configuration is missing');
    const reference = doc(services.firestore, ...GLOBAL_BALANCE_PATH);

    let serverFailure = 'The global document has not been published yet';
    try {
      const snapshot = await withTimeout(getDocFromServer(reference), LOAD_TIMEOUT_MS);
      const parsed = parseGlobalBalanceSnapshot(snapshot);
      if (parsed) return this.remember(parsed, 'firebase', `Loaded Firebase revision ${parsed.revision}`);
    } catch (error) {
      serverFailure = errorMessage(error);
    }

    try {
      const snapshot = await getDocFromCache(reference);
      const parsed = parseGlobalBalanceSnapshot(snapshot);
      if (parsed) return this.remember(parsed, 'firebase-cache', `Offline cache revision ${parsed.revision}`);
    } catch {
      // A first-time client has no cached document; the bundled fallback is intentional.
    }
    return this.useFallback(fallback, serverFailure);
  }

  async publish(values: GameBalanceState): Promise<number> {
    const validationError = validateGameBalance(values);
    if (validationError) throw new Error(validationError);
    const services = getFirebaseServices();
    if (!services) throw new Error('Firebase web configuration is missing');
    await services.auth.authStateReady();
    const user = services.auth.currentUser;
    if (!user) throw new Error('Sign in with an admin account before publishing');
    const expectedRevision = this.loadedRevision;
    const reference = doc(services.firestore, ...GLOBAL_BALANCE_PATH);

    const nextRevision = await runTransaction(services.firestore, async (transaction) => {
      const snapshot = await transaction.get(reference);
      const currentRevision = snapshot.exists() ? readRevision(snapshot.data()) : 0;
      if (currentRevision !== expectedRevision) {
        throw new Error(`Firebase is at revision ${currentRevision}; reload Global Values before overwriting it`);
      }
      const revision = currentRevision + 1;
      transaction.set(reference, {
        schemaVersion: 1,
        revision,
        values: structuredClone(values),
        updatedAt: serverTimestamp(),
        updatedBy: user.uid,
      });
      return revision;
    });

    this.loadedRevision = nextRevision;
    this.loadedSource = 'firebase';
    this.loadedDetail = `Published Firebase revision ${nextRevision}`;
    return nextRevision;
  }

  private remember(
    document: GlobalBalanceDocument,
    source: GlobalBalanceSource,
    detail: string,
  ): LoadedGlobalBalance {
    this.loadedRevision = document.revision;
    this.loadedSource = source;
    this.loadedDetail = detail;
    return { values: structuredClone(document.values), revision: document.revision, source, detail };
  }

  private useFallback(fallback: GameBalanceState, detail: string): LoadedGlobalBalance {
    this.loadedRevision = 0;
    this.loadedSource = 'local-fallback';
    this.loadedDetail = detail;
    return { values: structuredClone(fallback), revision: 0, source: 'local-fallback', detail };
  }
}

export const globalBalanceService = new GlobalBalanceService();

function parseGlobalBalanceSnapshot(snapshot: DocumentSnapshot): GlobalBalanceDocument | null {
  if (!snapshot.exists()) return null;
  const raw: unknown = snapshot.data();
  if (!isRecord(raw) || raw['schemaVersion'] !== 1) throw new Error('Unsupported Firebase global-balance schema');
  const revision = readRevision(raw);
  const rawValues = raw['values'];
  if (!isRecord(rawValues)) throw new Error('Firebase global values are missing');
  const values = fillMissingBalanceFields(rawValues);
  const validationError = validateGameBalance(values);
  if (validationError) throw new Error(`Firebase global values are invalid: ${validationError}`);
  return { schemaVersion: 1, revision, values: structuredClone(values) };
}

/**
 * Rebuild a stored balance document on top of the shipped defaults, filling
 * every field the document is missing at any depth.
 *
 * A published revision predates every field added after it. Tools gained
 * `raider` and `structure` strike targets with the combat overhaul, so a
 * document published before that has tools carrying no raider damage;
 * validating it verbatim fails, `load` falls back, and the fallback pins the
 * revision at 0 — which makes republishing a corrected document impossible,
 * because publishing first requires having loaded the one it replaces. Filling
 * from defaults rather than rejecting is what keeps adding a field from
 * stranding every client on the bundled values.
 *
 * The defaults are the skeleton, so a field the balance shape no longer has is
 * dropped instead of being carried forward into live state. Exported for the
 * unit tests, which pin the shapes an old document can arrive in.
 */
export function fillMissingBalanceFields(stored: unknown): GameBalanceState {
  return withDefaults(createDefaultGameBalance(), stored);
}

function withDefaults<T>(defaults: T, stored: unknown): T {
  if (!isRecord(defaults)) return (stored === undefined ? defaults : stored) as T;
  const source = asRecordOrEmpty(stored);
  const merged: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(defaults)) merged[key] = withDefaults(value, source[key]);
  return merged as T;
}

function readRevision(raw: unknown): number {
  if (!isRecord(raw) || !Number.isSafeInteger(raw['revision']) || (raw['revision'] as number) < 1) {
    throw new Error('Firebase global-balance revision is invalid');
  }
  return raw['revision'] as number;
}

function asRecordOrEmpty(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Firebase global-value request timed out')), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Could not load Firebase global values';
}
