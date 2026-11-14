import { describe, expect, it } from 'vitest';
import {
  TOOL_DEFINITIONS,
  VARIANT_TOOL_GRADES,
  createDefaultGameBalance,
  isHandcraftTool,
  toolDefinition,
  variantToolGrade,
} from '../../src/config/balance';
import { blueprintQuality } from '../../src/content/blueprintQuality';
import { blueprintsGrantedUpToLevel } from '../../src/content/blueprintGates';
import { VARIANT_BLUEPRINT_IDS, isBlueprintItemId } from '../../src/simulation/blueprintKnowledge';
import { collectNearestGroundDrop } from '../../src/simulation/gameplayCommands';
import { createInitialState } from '../../src/simulation/state';

describe('variant tools', () => {
  it('adds one whole tool set per grade above Iron', () => {
    expect(VARIANT_TOOL_GRADES.map((grade) => grade.quality))
      .toEqual(['reinforced', 'masterwork', 'ancient']);
    expect(VARIANT_BLUEPRINT_IDS).toHaveLength(15);
    for (const id of VARIANT_BLUEPRINT_IDS) {
      expect(isBlueprintItemId(id)).toBe(true);
      expect(TOOL_DEFINITIONS.some((tool) => tool.definitionId === id)).toBe(true);
      expect(variantToolGrade(id as never)).not.toBeNull();
    }
  });

  it('climbs in power and durability with each grade', () => {
    for (const kind of ['axe', 'pick', 'sickle', 'sword', 'bow'] as const) {
      const base = toolDefinition(kind === 'bow' ? 'bow' : `iron-${kind}` as never);
      const grades = VARIANT_TOOL_GRADES.map(
        (grade) => toolDefinition(`${grade.quality}-${kind}` as never),
      );
      let previousDamage = base.damage;
      let previousDurability = base.maxDurability;
      for (const variant of grades) {
        expect(variant.damage).toBeGreaterThan(previousDamage);
        expect(variant.maxDurability).toBeGreaterThan(previousDurability);
        previousDamage = variant.damage;
        previousDurability = variant.maxDurability;
      }
    }
  });

  it('costs more iron than the Iron recipe it is built from', () => {
    for (const kind of ['axe', 'pick', 'sickle', 'sword'] as const) {
      const base = toolDefinition(`iron-${kind}` as never);
      for (const grade of VARIANT_TOOL_GRADES) {
        const variant = toolDefinition(`${grade.quality}-${kind}` as never);
        expect(variant.craftCost['iron-ingot']!)
          .toBeGreaterThan(base.craftCost['iron-ingot'] ?? 0);
        // Repairs are billed off the same cost, never the cheaper base recipe.
        expect(variant.repairBasisCost).toEqual(variant.craftCost);
      }
    }
  });

  it('is bench work even for the Bow, whose plain recipe is handcraft', () => {
    expect(isHandcraftTool(toolDefinition('bow'))).toBe(true);
    for (const grade of VARIANT_TOOL_GRADES) {
      expect(isHandcraftTool(toolDefinition(`${grade.quality}-bow` as never))).toBe(false);
    }
  });

  it('carries its grade as its blueprint quality', () => {
    for (const kind of ['axe', 'pick', 'sickle', 'sword', 'bow'] as const) {
      expect(blueprintQuality(`reinforced-${kind}`)).toBe('rare');
      expect(blueprintQuality(`masterwork-${kind}`)).toBe('epic');
      expect(blueprintQuality(`ancient-${kind}`)).toBe('legendary');
    }
  });

  it('is never granted by a level, at any level', () => {
    const everything = new Set(blueprintsGrantedUpToLevel(99));
    for (const id of VARIANT_BLUEPRINT_IDS) expect(everything.has(id)).toBe(false);
  });

  it('appears in the Admin balance table like any other tool', () => {
    const balance = createDefaultGameBalance();
    for (const id of VARIANT_BLUEPRINT_IDS) {
      const editable = balance.tools[id as keyof typeof balance.tools];
      expect(editable).toBeDefined();
      expect(editable.maxDurability).toBeGreaterThan(0);
      expect(editable.damageByTarget).toBeDefined();
    }
  });
});

describe('picking a blueprint back up', () => {
  it('takes the blueprint before a resource stack lying just as close', () => {
    const state = createInitialState(9);
    state.groundDrops.push({
      id: 'wood-drop', resource: 'wood', amount: 5,
      x: state.player.x, y: state.player.y, expiresAtTick: null,
    });
    state.blueprintDrops.push({
      id: 'bp-drop', blueprintId: 'furnace',
      x: state.player.x, y: state.player.y, expiresAtTick: state.tick + 100,
    });

    // A corpse run must never fail because a stack of wood was fractionally
    // nearer than the thing the player came back for.
    expect(collectNearestGroundDrop(state)).toMatchObject({ ok: true });
    expect(state.blueprintDrops).toEqual([]);
    expect(state.carriedBlueprints.map((carried) => carried.blueprintId)).toEqual(['furnace']);
    expect(state.groundDrops).toHaveLength(1);
  });
});
