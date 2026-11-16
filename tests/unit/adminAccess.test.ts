import { describe, expect, it } from 'vitest';
import { adminMenuEnabled } from '../../src/config/adminAccess';

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

describe('admin menu access', () => {
  it('is available by default in the public Menu', () => {
    expect(adminMenuEnabled('', memoryStorage(), false)).toBe(true);
    expect(adminMenuEnabled('?render=3d', memoryStorage(), false)).toBe(true);
  });

  it('turns on with ?admin=1 and is remembered in this browser', () => {
    const storage = memoryStorage();
    expect(adminMenuEnabled('?admin=1', storage, false)).toBe(true);
    expect(adminMenuEnabled('', storage, false)).toBe(true);
  });

  it('turns off again with ?admin=0', () => {
    const storage = memoryStorage();
    adminMenuEnabled('?admin', storage, false);
    expect(adminMenuEnabled('?admin=0', storage, false)).toBe(false);
    expect(adminMenuEnabled('', storage, false)).toBe(false);
  });

  it('is always shown in development builds', () => {
    expect(adminMenuEnabled('', memoryStorage(), true)).toBe(true);
    expect(adminMenuEnabled('?admin=0', memoryStorage(), true)).toBe(true);
  });

  it('works from the URL alone when storage is blocked', () => {
    const blocked = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
      removeItem: () => { throw new Error('blocked'); },
    };
    expect(adminMenuEnabled('?admin=1', blocked, false)).toBe(true);
    expect(adminMenuEnabled('', blocked, false)).toBe(true);
    expect(adminMenuEnabled('', undefined, false)).toBe(true);
  });
});
