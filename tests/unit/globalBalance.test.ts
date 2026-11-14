import { describe, expect, it } from 'vitest';
import { createDefaultGameBalance } from '../../src/config/balance';
import { fillMissingBalanceFields } from '../../src/platform/globalBalance';
import { validateGameBalance } from '../../src/simulation/admin';

type StoredDocument = Record<string, unknown>;

/** A stored document is untyped JSON, so every step down it is checked. */
function at(record: StoredDocument, ...path: string[]): StoredDocument {
  let node = record;
  for (const key of path) {
    const value = node[key];
    if (value === null || typeof value !== 'object') throw new Error(`No record at ${path.join('.')}`);
    node = value as StoredDocument;
  }
  return node;
}

function storedDefaults(): StoredDocument {
  return structuredClone(createDefaultGameBalance()) as unknown as StoredDocument;
}

/**
 * Every case here is a document published by an older build. Rejecting one
 * strands every client on the bundled defaults *and* pins the publish revision
 * at 0, so the stale document can never be corrected — the merge has to fill
 * rather than fail.
 */
describe('fillMissingBalanceFields', () => {
  it('fills strike targets a document published before the combat overhaul lacks', () => {
    const defaults = createDefaultGameBalance();
    const stored = storedDefaults();
    for (const id of Object.keys(at(stored, 'tools'))) {
      for (const field of ['damageByTarget', 'wearMultiplierByTarget']) {
        const targets = at(stored, 'tools', id, field);
        delete targets['raider'];
        delete targets['structure'];
      }
    }

    const merged = fillMissingBalanceFields(stored);

    expect(validateGameBalance(merged)).toBeNull();
    expect(merged.tools['wooden-axe'].damageByTarget.raider)
      .toBe(defaults.tools['wooden-axe'].damageByTarget.raider);
    expect(merged.tools['wooden-axe'].wearMultiplierByTarget.structure)
      .toBe(defaults.tools['wooden-axe'].wearMultiplierByTarget.structure);
  });

  it('fills a whole section, entry, and nested record that predate the document', () => {
    const defaults = createDefaultGameBalance();
    const stored = storedDefaults();
    delete stored['structures'];
    delete at(stored, 'creatures')['tuftle'];
    delete at(stored, 'bagWeight', 'itemHundredths')['wood'];
    delete at(stored, 'objects', 'tree')['hardness'];

    const merged = fillMissingBalanceFields(stored);

    expect(validateGameBalance(merged)).toBeNull();
    expect(merged.structures).toEqual(defaults.structures);
    expect(merged.creatures['tuftle']).toEqual(defaults.creatures['tuftle']);
    expect(merged.bagWeight.itemHundredths.wood).toBe(defaults.bagWeight.itemHundredths.wood);
    expect(merged.objects.tree.hardness).toBe(defaults.objects.tree.hardness);
  });

  it('keeps published values and drops fields the balance shape no longer has', () => {
    const stored = storedDefaults();
    at(stored, 'characterDefaults')['walkSpeed'] = 999;
    at(stored, 'bagWeight', 'itemHundredths')['arrows'] = 25;
    stored['retiredSection'] = { anything: 1 };

    const merged = fillMissingBalanceFields(stored);
    const loose = merged as unknown as StoredDocument;

    expect(merged.characterDefaults.walkSpeed).toBe(999);
    expect(loose['retiredSection']).toBeUndefined();
    expect(at(loose, 'bagWeight', 'itemHundredths')['arrows']).toBeUndefined();
  });

  it('fills the camera angle for a document published before it was global', () => {
    const stored = storedDefaults();
    delete stored['camera'];

    const merged = fillMissingBalanceFields(stored);

    expect(validateGameBalance(merged)).toBeNull();
    expect(merged.camera).toEqual({ yawTenths: 200, pitchTenths: 474 });
  });

  it('rejects a camera angle outside the editable range or off a whole tenth', () => {
    const balance = createDefaultGameBalance();
    balance.camera.yawTenths = 3_600;
    expect(validateGameBalance(balance)).toMatch(/Side angle/);

    balance.camera = { yawTenths: 200, pitchTenths: 47.4 };
    expect(validateGameBalance(balance)).toMatch(/Overhead angle/);
  });

  it('falls back to the full defaults when the stored document is not a record', () => {
    expect(fillMissingBalanceFields(null)).toEqual(createDefaultGameBalance());
    expect(validateGameBalance(fillMissingBalanceFields('nonsense'))).toBeNull();
  });
});
