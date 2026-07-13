import { WORLD_PX } from '../config/platform';

export type NpcId = 'mara-smith' | 'orin-stockkeeper' | 'tavi-trader';
export type NpcService = 'blacksmith' | 'farm' | 'market';

/** Immutable, friendly world characters. NPCs are content, never combat targets. */
export interface NpcDefinition {
  id: NpcId;
  name: string;
  title: string;
  service: NpcService;
  serviceLabel: string;
  summary: string;
  greeting: string;
  servicePreview: string;
  availability: string;
  x: number;
  y: number;
}

const center = WORLD_PX / 2;

export const NPC_DEFINITIONS: readonly NpcDefinition[] = [
  {
    id: 'mara-smith',
    name: 'Mara',
    title: 'The Smith',
    service: 'blacksmith',
    serviceLabel: 'Blacksmith services',
    summary: 'Repairs, replacement tools, and Power, Speed, and Durability upgrades.',
    greeting: 'Tools tell the truth. Bring me good metal and I will make yours worth carrying.',
    servicePreview: 'Mara will repair tools, order rank-zero replacements, and apply the first two upgrade ranks.',
    availability: 'Service preview — contracts arrive with iron and the coin economy in Milestone 2.',
    x: center + 88,
    y: center - 70,
  },
  {
    id: 'orin-stockkeeper',
    name: 'Orin',
    title: 'The Stockkeeper',
    service: 'farm',
    serviceLabel: 'Farm services',
    summary: 'Creature work, trained-animal orders, housing, and assignments.',
    greeting: 'A creature works best when it trusts the hands beside it. Start by learning from the wild ones.',
    servicePreview: 'Orin will introduce animal jobs and arrange trained copies of species you have already tamed.',
    availability: 'Service preview — orders arrive with the Farm Counter and area-32 progression in Milestone 2.',
    x: center - 88,
    y: center - 70,
  },
  {
    id: 'tavi-trader',
    name: 'Tavi',
    title: 'The Trader',
    service: 'market',
    serviceLabel: 'Market services',
    summary: 'Buys gathered and processed resources for coins.',
    greeting: 'Every new homestead needs supplies, and every surplus needs a buyer. I can help with the second part.',
    servicePreview: 'Tavi will buy resources at fixed prices, providing the settlement’s single source of coins.',
    availability: 'Service preview — buying opens with the coin economy in Milestone 2.',
    x: center,
    y: center + 92,
  },
] as const;

export function npcDefinition(id: NpcId): NpcDefinition {
  const definition = NPC_DEFINITIONS.find((npc) => npc.id === id);
  if (!definition) throw new Error(`unknown NPC ${id}`);
  return definition;
}
