import type { BuildingDefinitionId, ResourceId, SpeciesId } from '../simulation/state';
import type { NonEmptyEfficiencyAxes } from './efficiency';

export interface ProducerDefinition {
  id: string;
  speciesId: SpeciesId;
  cycleMs: number;
  inputPerCycle?: Readonly<Partial<Record<ResourceId, number>>>;
  outputPerCycle: Readonly<Partial<Record<ResourceId, number>>>;
  requiredFacilities: readonly BuildingDefinitionId[];
  efficiencyAxes: NonEmptyEfficiencyAxes;
}

/** Roughly one quarter of an early player's active plant-material collection. */
export const TUFTLE_HOUSING_PRODUCER: ProducerDefinition = {
  id: 'tuftle-housing-fiber',
  speciesId: 'tuftle',
  cycleMs: 15_000,
  outputPerCycle: { fiber: 2 },
  requiredFacilities: ['small-pen', 'barn'],
  efficiencyAxes: ['yield', 'pickup'],
};

/** A slow, storage-capped stone delivery rather than an invisible passive grant. */
export const CRAGHOPPER_STONE_PRODUCER: ProducerDefinition = {
  id: 'craghopper-stone-yard',
  speciesId: 'craghopper',
  cycleMs: 60_000,
  outputPerCycle: { stone: 2 },
  requiredFacilities: ['stone-yard'],
  efficiencyAxes: ['yield', 'pickup'],
};

export const PRODUCER_DEFINITIONS: readonly ProducerDefinition[] = [
  TUFTLE_HOUSING_PRODUCER,
  CRAGHOPPER_STONE_PRODUCER,
];

export function producerForSpecies(speciesId: SpeciesId): ProducerDefinition | null {
  return PRODUCER_DEFINITIONS.find((producer) => producer.speciesId === speciesId) ?? null;
}
