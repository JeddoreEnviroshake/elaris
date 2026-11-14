export type NpcId =
  | 'mara-smith'
  | 'orin-stockkeeper'
  | 'tavi-trader'
  | 'elowen-caretaker'
  | 'garrick-armourer'
  | 'selene-arcanist'
  | 'bram-innkeeper'
  | 'kael-arena-master';
export type NpcService =
  | 'weaponsmith'
  | 'farm'
  | 'market'
  | 'church'
  | 'armoury'
  | 'magic-shop'
  | 'tavern'
  | 'arena';

export type NpcDialogueId =
  | 'mara-forge' | 'orin-stockhouse' | 'tavi-market' | 'elowen-sanctuary'
  | 'garrick-armoury' | 'selene-arcanum' | 'bram-tavern' | 'kael-arena';
export type NpcIdleBehavior =
  | 'hammering' | 'checking-ledger' | 'arranging-stock' | 'quiet-reflection'
  | 'armour-drill' | 'arcane-study' | 'serving-patrons' | 'coaching';

export interface NpcAppearance {
  portraitInitials: string;
  primaryColor: string;
  accentColor: string;
  description: string;
}

export interface NpcBarkSet {
  arrival: readonly string[];
  nearby: readonly string[];
  afterService: readonly string[];
}

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
  appearance: NpcAppearance;
  interactionRadiusTiles: number;
  idleBehavior: NpcIdleBehavior;
  dialogueId: NpcDialogueId;
  barks: NpcBarkSet;
}

export const NPC_DEFINITIONS: readonly NpcDefinition[] = [
  {
    id: 'mara-smith',
    name: 'Mara',
    title: 'The Smith',
    service: 'weaponsmith',
    serviceLabel: 'Weaponsmith services',
    summary: 'Strength training, repairs, replacement tools, and Power, Speed, and Durability upgrades.',
    greeting: 'Tools tell the truth. Bring me good metal and I will make yours worth carrying.',
    servicePreview: 'Mara applies the first two Power, Speed, and Durability ranks to owned tools.',
    availability: 'Open now — upgrades use fixed coin prices and never fail randomly.',
    appearance: { portraitInitials: 'M', primaryColor: '#8f3d32', accentColor: '#ffb24d', description: 'A broad-shouldered smith in a soot-red apron, carrying a square-faced hammer.' },
    interactionRadiusTiles: 2,
    idleBehavior: 'hammering',
    dialogueId: 'mara-forge',
    barks: {
      arrival: ['Mind the sparks. The forge has a temper today.'],
      nearby: ['Set it on the anvil if you want an honest answer.'],
      afterService: ['Test the balance before you trust it in the field.'],
    },
  },
  {
    id: 'orin-stockkeeper',
    name: 'Orin',
    title: 'The Stockkeeper',
    service: 'farm',
    serviceLabel: 'Farm services',
    summary: 'Creature work, trained-animal orders, housing, and assignments.',
    greeting: 'A creature works best when it trusts the hands beside it. Start by learning from the wild ones.',
    servicePreview: 'Orin arranges trained copies of species you have already tamed.',
    availability: 'Open now — tame a species once before ordering a trained copy.',
    appearance: { portraitInitials: 'O', primaryColor: '#77603b', accentColor: '#d8c36d', description: 'A patient stockkeeper in a weathered vest, with a ledger always close at hand.' },
    interactionRadiusTiles: 2,
    idleBehavior: 'checking-ledger',
    dialogueId: 'orin-stockhouse',
    barks: { arrival: ['Easy now. The animals notice every new footstep.'], nearby: ['A calm hand does more than a loud command.'], afterService: ['Give your new charge time to settle.'] },
  },
  {
    id: 'tavi-trader',
    name: 'Tavi',
    title: 'The Trader',
    service: 'market',
    serviceLabel: 'Market services',
    summary: 'Buys gathered and processed resources for coins.',
    greeting: 'Every new homestead needs supplies, and every surplus needs a buyer. I can help with the second part.',
    servicePreview: 'Tavi buys resources at fixed prices, providing the settlement’s single source of coins.',
    availability: 'Open now — sell one item or an entire resource stack.',
    appearance: { portraitInitials: 'T', primaryColor: '#315f68', accentColor: '#f0c85b', description: 'A quick-eyed trader with rolled sleeves and a bright tally cord around one wrist.' },
    interactionRadiusTiles: 2,
    idleBehavior: 'arranging-stock',
    dialogueId: 'tavi-market',
    barks: { arrival: ['Fresh stock? I can usually make room.'], nearby: ['Neat bundles fetch neater prices.'], afterService: ['A fair trade leaves both sides lighter.'] },
  },
  {
    id: 'elowen-caretaker',
    name: 'Elowen',
    title: 'The Caretaker',
    service: 'church',
    serviceLabel: 'Church training',
    summary: 'Develops Luck, Health, and Health Regeneration through reflection and restorative practice.',
    greeting: 'Fortune favors an open heart, but resilience is built one quiet choice at a time.',
    servicePreview: 'Elowen offers Luck, Health, and Health Regeneration skill points for a fixed coin donation.',
    availability: 'Open now — each lesson grants one skill point immediately.',
    appearance: { portraitInitials: 'E', primaryColor: '#6e7f9e', accentColor: '#f5dfa0', description: 'A silver-haired caretaker in layered blue robes, carrying a small lantern.' },
    interactionRadiusTiles: 2,
    idleBehavior: 'quiet-reflection',
    dialogueId: 'elowen-sanctuary',
    barks: { arrival: ['You may leave the noise of the road at the door.'], nearby: ['Breathe first. Answers can wait a moment.'], afterService: ['Carry that steadiness with you.'] },
  },
  {
    id: 'garrick-armourer',
    name: 'Garrick',
    title: 'The Armourer',
    service: 'armoury',
    serviceLabel: 'Armoury training',
    summary: 'Develops Dexterity and Carry Weight through drills in balance, aim, and loaded carries.',
    greeting: 'Good armour keeps you standing. Good hands keep you from being struck at all.',
    servicePreview: 'Garrick offers Dexterity and Carry Weight skill points for a fixed coin fee.',
    availability: 'Open now — each lesson grants one skill point immediately.',
    appearance: { portraitInitials: 'G', primaryColor: '#59696a', accentColor: '#dce5e3', description: 'A compact armourer in a fitted leather coat, measuring every movement.' },
    interactionRadiusTiles: 2,
    idleBehavior: 'armour-drill',
    dialogueId: 'garrick-armoury',
    barks: { arrival: ['Watch the racks. Every edge is where I left it.'], nearby: ['Balance first. Speed follows.'], afterService: ['Keep your feet under you and your guard honest.'] },
  },
  {
    id: 'selene-arcanist',
    name: 'Selene',
    title: 'The Arcanist',
    service: 'magic-shop',
    serviceLabel: 'Magic Shop training and wares',
    summary: 'Develops Magic through guided study and sells enchanted staves.',
    greeting: 'Power is easy to call. The difficult art is teaching it exactly where to go.',
    servicePreview: 'Selene offers Magic skill points and the shop-exclusive Magic Staff.',
    availability: 'Open now — each lesson grants one skill point immediately.',
    appearance: { portraitInitials: 'S', primaryColor: '#684c87', accentColor: '#77e5f0', description: 'An arcanist in ink-dark robes, surrounded by the faint glow of suspended runes.' },
    interactionRadiusTiles: 2,
    idleBehavior: 'arcane-study',
    dialogueId: 'selene-arcanum',
    barks: { arrival: ['Do not touch the blue flame. It remembers.'], nearby: ['Precision is the difference between a spell and a mess.'], afterService: ['Let the pattern settle before you cast again.'] },
  },
  {
    id: 'bram-innkeeper',
    name: 'Bram',
    title: 'The Innkeeper',
    service: 'tavern',
    serviceLabel: 'Tavern training',
    summary: 'Develops Mana and Mana Regeneration through stories, riddles, and hard-won local knowledge.',
    greeting: 'A good story saves you the trouble of learning every lesson the expensive way.',
    servicePreview: 'Bram offers Mana and Mana Regeneration skill points for a fixed coin fee.',
    availability: 'Open now — each lesson grants one skill point immediately.',
    appearance: { portraitInitials: 'B', primaryColor: '#74462e', accentColor: '#ffbc68', description: 'A warm-faced innkeeper with a flour-dusted apron and an inexhaustible smile.' },
    interactionRadiusTiles: 2,
    idleBehavior: 'serving-patrons',
    dialogueId: 'bram-tavern',
    barks: { arrival: ['Door is open and the kettle is on.'], nearby: ['Pull up a chair. Standing stories are always too short.'], afterService: ['Now that is a lesson worth remembering.'] },
  },
  {
    id: 'kael-arena-master',
    name: 'Kael',
    title: 'The Arena Master',
    service: 'arena',
    serviceLabel: 'Arena training',
    summary: 'Develops Stamina, Stamina Regeneration, and Speed through demanding physical drills.',
    greeting: 'The bout is decided before the first strike, in every lap and drill you thought nobody saw.',
    servicePreview: 'Kael offers Stamina, Stamina Regeneration, and Speed skill points for a fixed coin fee.',
    availability: 'Open now — each lesson grants one skill point immediately.',
    appearance: { portraitInitials: 'K', primaryColor: '#8b3d32', accentColor: '#ffd181', description: 'A scarred arena master in a red sash, forever counting someone’s footwork.' },
    interactionRadiusTiles: 2,
    idleBehavior: 'coaching',
    dialogueId: 'kael-arena',
    barks: { arrival: ['If you crossed the line, you came to work.'], nearby: ['Again. Cleaner this time.'], afterService: ['Rest when the lesson holds, not before.'] },
  },
] as const;

export function npcDefinition(id: NpcId): NpcDefinition {
  const definition = NPC_DEFINITIONS.find((npc) => npc.id === id);
  if (!definition) throw new Error(`unknown NPC ${id}`);
  return definition;
}

export const NPC_IDS = NPC_DEFINITIONS.map((npc) => npc.id) as readonly NpcId[];

export function isNpcId(value: unknown): value is NpcId {
  return typeof value === 'string' && NPC_IDS.includes(value as NpcId);
}
