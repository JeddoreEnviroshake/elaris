import type { GameState } from './state';

type CanonicalValue = null | boolean | number | string | CanonicalValue[] | CanonicalObject;

interface CanonicalObject {
  [key: string]: CanonicalValue;
}

/**
 * Serialize authoritative simulation state in the Phase 1 canonical form.
 *
 * GameState deliberately excludes save-envelope metadata, timestamps, UI and
 * render state, and recomputable caches. Object keys are sorted recursively;
 * arrays retain their gameplay-significant order.
 */
export function canonicalizeGameState(state: GameState): string {
  return JSON.stringify(toCanonicalValue(state, '$', new Set<object>()));
}

/** Return the lowercase SHA-256 digest of the canonical state's UTF-8 JSON. */
export async function hashGameState(state: GameState): Promise<string> {
  if (typeof globalThis.crypto?.subtle === 'undefined') {
    throw new Error('Web Crypto SHA-256 is unavailable in this environment');
  }

  const json = canonicalizeGameState(state);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(json));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function toCanonicalValue(value: unknown, path: string, ancestors: Set<object>): CanonicalValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;

  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw unsupported(path, 'numbers must be safe integers');
    }
    return value;
  }

  if (typeof value !== 'object') {
    throw unsupported(path, `received ${typeof value}`);
  }

  if (ancestors.has(value)) throw unsupported(path, 'cyclic references are not supported');
  ancestors.add(value);

  try {
    if (Array.isArray(value)) {
      return value.map((item, index) => toCanonicalValue(item, `${path}[${index}]`, ancestors));
    }

    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw unsupported(path, 'only arrays and plain objects are supported');
    }

    // A null prototype keeps even adversarial keys such as "__proto__" data-only.
    const result = Object.create(null) as CanonicalObject;
    for (const key of Object.keys(value).sort()) {
      result[key] = toCanonicalValue((value as Record<string, unknown>)[key], propertyPath(path, key), ancestors);
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
}

function propertyPath(parent: string, key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? `${parent}.${key}` : `${parent}[${JSON.stringify(key)}]`;
}

function unsupported(path: string, detail: string): TypeError {
  return new TypeError(`Unsupported canonical value at ${path}: ${detail}`);
}
