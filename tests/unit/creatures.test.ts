import { describe, expect, it } from 'vitest';
import { CREATURE_DEFINITIONS, creatureDefinition, isSpeciesId } from '../../src/content/creatures';
import { generateWildCreatures } from '../../src/simulation/worldGeneration';

describe('creature species registry', () => {
  it('registers each original species once with a useful role', () => {
    const ids = CREATURE_DEFINITIONS.map((definition) => definition.speciesId);
    expect(ids).toEqual(['tuftle', 'craghopper', 'glade-stag', 'snarlfox']);
    expect(new Set(ids).size).toBe(ids.length);
    for (const definition of CREATURE_DEFINITIONS) {
      expect(isSpeciesId(definition.speciesId)).toBe(true);
      expect(definition.followRole.length).toBeGreaterThan(0);
      expect(definition.efficiencyAxes.length).toBeGreaterThan(0);
      expect(creatureDefinition(definition.speciesId)).toBe(definition);
    }
  });

  it('generates one deterministic preview spawn per registered species', () => {
    const first = generateWildCreatures(123);
    const second = generateWildCreatures(123);
    expect(second).toEqual(first);
    expect(first.map((creature) => creature.speciesId)).toEqual([
      'tuftle', 'craghopper', 'glade-stag', 'snarlfox',
    ]);
    expect(new Set(first.map((creature) => creature.id)).size).toBe(first.length);
  });

  it('rejects unregistered species identifiers', () => {
    expect(isSpeciesId('tuftle')).toBe(true);
    expect(isSpeciesId('not-a-creature')).toBe(false);
    expect(isSpeciesId(null)).toBe(false);
  });
});
