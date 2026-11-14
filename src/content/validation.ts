import { TOOL_DEFINITIONS } from '../config/balance';
import { PLACEABLES } from '../config/areaGates';
import { BUILDABLES } from './buildingParts';
import { CREATURE_DEFINITIONS } from './creatures';
import { BLACKSMITH_CONTRACTS, FARM_ORDER_CONTRACTS } from './economy';
import { isEfficiencyAxis } from './efficiency';
import { COMPANION_ABILITY_IDS } from './companionAbilities';
import { PRODUCER_DEFINITIONS } from './producers';
import { interiorContentValidationErrors } from './interiorValidation';

interface RewardDefinition { efficiencyAxes?: readonly unknown[]; cosmetic?: boolean }

export function validateEfficiencyDefinition(label: string, definition: RewardDefinition): string[] {
  if (definition.cosmetic) return definition.efficiencyAxes?.every(isEfficiencyAxis) ? [] : [`${label} has an invalid efficiency axis`];
  if (!definition.efficiencyAxes || definition.efficiencyAxes.length === 0) return [`${label} must declare efficiencyAxes`];
  return definition.efficiencyAxes.every(isEfficiencyAxis) ? [] : [`${label} has an invalid efficiency axis`];
}

/** All non-cosmetic Phase 1 reward registries are validated in one place. */
export function contentValidationErrors(): string[] {
  const definitions: Array<readonly [string, RewardDefinition]> = [
    ...TOOL_DEFINITIONS.map((definition) => [`tool:${definition.definitionId}`, definition] as const),
    ...BUILDABLES.map((definition) => [`buildable:${definition.id}`, definition] as const),
    ...PLACEABLES.map((definition) => [`placeable:${definition.id}`, definition] as const),
    ...CREATURE_DEFINITIONS.map((definition) => [`creature:${definition.speciesId}`, definition] as const),
    ...CREATURE_DEFINITIONS.map((definition) => [
      `creature-follow:${definition.speciesId}`, { efficiencyAxes: definition.followEfficiencyAxes },
    ] as const),
    ...CREATURE_DEFINITIONS.filter((definition) => definition.work !== null).map((definition) => [
      `creature-work:${definition.speciesId}`, { efficiencyAxes: definition.work!.efficiencyAxes },
    ] as const),
    ...BLACKSMITH_CONTRACTS.map((definition) => [`contract:${definition.id}`, definition] as const),
    ...FARM_ORDER_CONTRACTS.map((definition) => [`contract:${definition.id}`, definition] as const),
    ...PRODUCER_DEFINITIONS.map((definition) => [`producer:${definition.id}`, definition] as const),
  ];
  const errors = definitions.flatMap(([label, definition]) => validateEfficiencyDefinition(label, definition));
  errors.push(...interiorContentValidationErrors());
  const seenAbilities = new Set<string>();
  for (const creature of CREATURE_DEFINITIONS) {
    if (creature.encounter.battleAbilities.length === 0 || creature.encounter.battleAbilities.length > 4) {
      errors.push(`creature:${creature.speciesId} must declare one to four battle abilities`);
    }
    for (const ability of creature.encounter.battleAbilities) {
      if (!COMPANION_ABILITY_IDS.has(ability.id) || seenAbilities.has(ability.id)) errors.push(`companion ability:${ability.id} is invalid or duplicated`);
      seenAbilities.add(ability.id);
      if (!Number.isSafeInteger(ability.cooldownTurns) || ability.cooldownTurns < 0) errors.push(`companion ability:${ability.id} has invalid cooldown`);
      if (!Number.isSafeInteger(ability.unlockBondLevel) || ability.unlockBondLevel < 1) errors.push(`companion ability:${ability.id} has invalid Bond unlock`);
      const numericValues = Object.entries(ability.effect)
        .filter(([key]) => key !== 'kind' && key !== 'direction')
        .map(([, value]) => value);
      if (numericValues.some((value) => typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0)) {
        errors.push(`companion ability:${ability.id} has an invalid effect amount`);
      }
    }
  }
  return errors;
}

export function assertValidContent(): void {
  const errors = contentValidationErrors();
  if (errors.length > 0) throw new Error(`Content validation failed:\n${errors.join('\n')}`);
}
