import type { NpcDialogueId, NpcId, NpcService } from './npcs';

export type DialogueCondition =
  | { readonly kind: 'first-visit' }
  | { readonly kind: 'repeat-visit' }
  | { readonly kind: 'player-level-at-least'; readonly level: number }
  | { readonly kind: 'equipped-tool' }
  | { readonly kind: 'recent-purchase'; readonly service: NpcService }
  | { readonly kind: 'seen-moment'; readonly momentId: string };

export type DialogueAction =
  | { readonly kind: 'open-service'; readonly service: NpcService }
  | { readonly kind: 'close-dialogue' };

export interface DialogueChoiceDefinition {
  readonly id: string;
  readonly label: string;
  readonly targetNodeId?: string;
  readonly action?: DialogueAction;
  readonly conditions?: readonly DialogueCondition[];
}

export interface DialogueNodeDefinition {
  readonly id: string;
  readonly text: string | readonly string[];
  readonly choices: readonly DialogueChoiceDefinition[];
  readonly seenMomentId?: string;
}

export interface DialogueStartRule {
  readonly nodeId: string;
  readonly conditions: readonly DialogueCondition[];
}

export interface DialogueDefinition {
  readonly id: NpcDialogueId;
  readonly npcId: NpcId;
  /** Evaluated in order; the first matching rule wins. */
  readonly startRules: readonly DialogueStartRule[];
  readonly nodes: readonly DialogueNodeDefinition[];
}

const MAIN_CHOICES: readonly DialogueChoiceDefinition[] = [
  { id: 'tools', label: 'Let me see your tools', action: { kind: 'open-service', service: 'weaponsmith' } },
  { id: 'train', label: 'Train me', targetNodeId: 'training' },
  { id: 'work', label: 'What are you working on?', targetNodeId: 'work' },
  { id: 'goodbye', label: 'Goodbye', action: { kind: 'close-dialogue' } },
];

const MARA_DIALOGUE: DialogueDefinition = {
  id: 'mara-forge',
  npcId: 'mara-smith',
  startRules: [
    { nodeId: 'recent-purchase', conditions: [{ kind: 'recent-purchase', service: 'weaponsmith' }] },
    { nodeId: 'seasoned', conditions: [{ kind: 'repeat-visit' }, { kind: 'player-level-at-least', level: 3 }] },
    { nodeId: 'equipped', conditions: [{ kind: 'equipped-tool' }] },
    { nodeId: 'returning', conditions: [{ kind: 'repeat-visit' }] },
    { nodeId: 'first-meeting', conditions: [{ kind: 'first-visit' }] },
  ],
  nodes: [
    {
      id: 'first-meeting',
      text: 'Mara lowers her hammer. “New face. I am Mara. Around here, a sound tool is the difference between a long day and a lost one.”',
      choices: MAIN_CHOICES,
      seenMomentId: 'mara:introduction',
    },
    { id: 'returning', text: '“Back again? Good. Metal improves under steady hands.”', choices: MAIN_CHOICES },
    { id: 'equipped', text: 'Mara studies the tool in your hand. “That one has a story already. Let me hear what the edge says.”', choices: MAIN_CHOICES },
    { id: 'seasoned', text: '“You carry yourself differently now. The road has been teaching you.”', choices: MAIN_CHOICES },
    { id: 'recent-purchase', text: '“Before you go: use what I changed. A forge promise only counts after the tool survives the field.”', choices: MAIN_CHOICES },
    {
      id: 'training',
      text: '“Strength is not swinging harder. It is putting the whole body behind one exact strike. I can drill that into you—for the usual training fee.”',
      choices: [
        { id: 'training-service', label: 'Show me the training offer', action: { kind: 'open-service', service: 'weaponsmith' } },
        { id: 'training-back', label: 'Maybe later', targetNodeId: 'returning' },
      ],
      seenMomentId: 'mara:training-explained',
    },
    {
      id: 'work',
      text: [
        '“A narrow forest axe. Less weight at the heel, so it will not fight you when the undergrowth gets close.”',
        '“A pick head for cold stone. The shape looks simple until you try to keep it from twisting.”',
        '“Balancing a sword for someone who thinks heavy means strong. The blade will teach them otherwise.”',
      ],
      choices: [
        { id: 'work-tools', label: 'Can you work on mine?', action: { kind: 'open-service', service: 'weaponsmith' } },
        { id: 'work-back', label: 'Interesting', targetNodeId: 'returning' },
      ],
      seenMomentId: 'mara:current-work',
    },
  ],
};

function simpleDialogue(
  id: NpcDialogueId,
  npcId: NpcId,
  service: NpcService,
  welcome: string,
  returning: string,
): DialogueDefinition {
  return {
    id,
    npcId,
    startRules: [
      { nodeId: 'returning', conditions: [{ kind: 'repeat-visit' }] },
      { nodeId: 'welcome', conditions: [{ kind: 'first-visit' }] },
    ],
    nodes: [
      { id: 'welcome', text: welcome, choices: [
        { id: 'service', label: 'Let us get to work', action: { kind: 'open-service', service } },
        { id: 'goodbye', label: 'Goodbye', action: { kind: 'close-dialogue' } },
      ] },
      { id: 'returning', text: returning, choices: [
        { id: 'service', label: 'Show me your services', action: { kind: 'open-service', service } },
        { id: 'goodbye', label: 'Goodbye', action: { kind: 'close-dialogue' } },
      ] },
    ],
  };
}

export const DIALOGUE_DEFINITIONS: readonly DialogueDefinition[] = [
  MARA_DIALOGUE,
  simpleDialogue('orin-stockhouse', 'orin-stockkeeper', 'farm',
    'Orin closes his ledger softly. “First time in the stockhouse? Meet every animal at its own pace. The records come second.”',
    'Orin marks your return in the ledger. “The pens remember a calm visitor. Which record shall we review?”'),
  simpleDialogue('tavi-market', 'tavi-trader', 'market',
    'Tavi clears a space beside the brass scale. “New seller? We weigh the goods where both of us can see the tally.”',
    'Tavi taps the open space on the counter. “Back with another bundle? Let us see what the road provided.”'),
  simpleDialogue('elowen-sanctuary', 'elowen-caretaker', 'church',
    'Elowen cups a hand around a small flame. “Your first quiet moment here asks nothing from you. Stay until your breathing settles.”',
    'Elowen recognizes you with a warm nod. “You found the sanctuary again. What would you strengthen today?”'),
  simpleDialogue('garrick-armoury', 'garrick-armourer', 'armoury',
    'Garrick lowers a practice blade. “First lesson: the racks are not decoration. Every tool marks a different mistake.”',
    'Garrick glances at your stance before your face. “Better footing than last time. Ready to make it precise?”'),
  simpleDialogue('selene-arcanum', 'selene-arcanist', 'magic-shop',
    'Selene stills the nearest floating page. “A new mind changes the room’s pattern. Stand inside the rune and let it learn you.”',
    'The runes brighten before Selene turns. “They remember your cadence. Shall we continue the pattern?”'),
  simpleDialogue('bram-tavern', 'bram-innkeeper', 'tavern',
    'Bram sets out a cup before you ask. “First visit buys you a welcome. The useful stories cost attention.”',
    'Bram points to the chair you used before. “Your seat survived. I have a better story for the person returning to it.”'),
  simpleDialogue('kael-arena', 'kael-arena-master', 'arena',
    'Kael draws a line in the sand. “First day? Cross that line only when you are ready to finish the drill you choose.”',
    'Kael studies the old marks beside your boots. “You came back. Good. Today we erase one hesitation.”'),
] as const;

export function dialogueDefinition(id: NpcDialogueId): DialogueDefinition {
  const definition = DIALOGUE_DEFINITIONS.find((dialogue) => dialogue.id === id);
  if (!definition) throw new Error(`unknown dialogue ${id}`);
  return definition;
}
