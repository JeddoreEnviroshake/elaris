import { dialogueDefinition, type DialogueAction, type DialogueCondition, type DialogueNodeDefinition } from '../content/dialogues';
import { npcDefinition, type NpcId, type NpcService } from '../content/npcs';
import type { GameState } from '../simulation/state';

export interface DialogueChoiceView {
  readonly id: string;
  readonly label: string;
}

export interface DialogueView {
  readonly npcId: NpcId;
  readonly npcName: string;
  readonly npcTitle: string;
  readonly portraitInitials: string;
  readonly portraitPrimary: string;
  readonly portraitAccent: string;
  readonly nodeId: string;
  readonly text: string;
  readonly choices: readonly DialogueChoiceView[];
}

export type DialogueChoiceResult =
  | { readonly kind: 'view'; readonly view: DialogueView }
  | { readonly kind: 'open-service'; readonly npcId: NpcId; readonly service: NpcService }
  | { readonly kind: 'close' };

export interface DialogueStartContext {
  readonly recentPurchaseService?: NpcService;
}

/** Renderer-neutral conversation state. Only visits/seen moments touch GameState. */
export class NpcDialogueController {
  private active: { state: GameState; npcId: NpcId; node: DialogueNodeDefinition; visitsBefore: number; context: DialogueStartContext } | null = null;

  start(state: GameState, npcId: NpcId, context: DialogueStartContext = {}): DialogueView {
    const npc = npcDefinition(npcId);
    const definition = dialogueDefinition(npc.dialogueId);
    const visitsBefore = state.npcMemory.visits[npcId] ?? 0;
    const conditionContext = { state, visitsBefore, context };
    const rule = definition.startRules.find((candidate) => candidate.conditions.every((condition) => conditionMatches(condition, conditionContext)));
    if (!rule) throw new Error(`dialogue ${definition.id} has no matching start rule`);
    const node = requireNode(definition.nodes, rule.nodeId);
    state.npcMemory.visits[npcId] = visitsBefore + 1;
    this.active = { state, npcId, node, visitsBefore, context };
    this.rememberMoment(node);
    return this.view();
  }

  choose(choiceId: string): DialogueChoiceResult {
    const active = this.requireActive();
    const definition = dialogueDefinition(npcDefinition(active.npcId).dialogueId);
    const choice = active.node.choices.find((candidate) => candidate.id === choiceId
      && (candidate.conditions ?? []).every((condition) => conditionMatches(condition, active)));
    if (!choice) throw new Error(`choice ${choiceId} is unavailable`);
    if (choice.targetNodeId) {
      active.node = requireNode(definition.nodes, choice.targetNodeId);
      this.rememberMoment(active.node);
      return { kind: 'view', view: this.view() };
    }
    return actionResult(choice.action, active.npcId);
  }

  close(): void { this.active = null; }

  private view(): DialogueView {
    const active = this.requireActive();
    const npc = npcDefinition(active.npcId);
    const candidates = Array.isArray(active.node.text) ? active.node.text : [active.node.text];
    const text = candidates[(active.state.tick + active.visitsBefore) % candidates.length] ?? '';
    return {
      npcId: npc.id,
      npcName: npc.name,
      npcTitle: npc.title,
      portraitInitials: npc.appearance.portraitInitials,
      portraitPrimary: npc.appearance.primaryColor,
      portraitAccent: npc.appearance.accentColor,
      nodeId: active.node.id,
      text,
      choices: active.node.choices
        .filter((choice) => (choice.conditions ?? []).every((condition) => conditionMatches(condition, active)))
        .map(({ id, label }) => ({ id, label })),
    };
  }

  private rememberMoment(node: DialogueNodeDefinition): void {
    const active = this.requireActive();
    if (node.seenMomentId && !active.state.npcMemory.seenMomentIds.includes(node.seenMomentId)) {
      active.state.npcMemory.seenMomentIds.push(node.seenMomentId);
    }
  }

  private requireActive() {
    if (!this.active) throw new Error('no NPC dialogue is active');
    return this.active;
  }
}

interface ConditionContext {
  readonly state: GameState;
  readonly visitsBefore: number;
  readonly context: DialogueStartContext;
}

export function conditionMatches(condition: DialogueCondition, context: ConditionContext): boolean {
  switch (condition.kind) {
    case 'first-visit': return context.visitsBefore === 0;
    case 'repeat-visit': return context.visitsBefore > 0;
    case 'player-level-at-least': return context.state.player.level >= condition.level;
    case 'equipped-tool': return context.state.equippedToolId !== null;
    case 'recent-purchase': return context.context.recentPurchaseService === condition.service;
    case 'seen-moment': return context.state.npcMemory.seenMomentIds.includes(condition.momentId);
  }
}

function requireNode(nodes: readonly DialogueNodeDefinition[], nodeId: string): DialogueNodeDefinition {
  const node = nodes.find((candidate) => candidate.id === nodeId);
  if (!node) throw new Error(`unknown dialogue node ${nodeId}`);
  return node;
}

function actionResult(action: DialogueAction | undefined, npcId: NpcId): DialogueChoiceResult {
  if (!action) throw new Error('dialogue choice has neither target nor action');
  if (action.kind === 'open-service') return { kind: 'open-service', npcId, service: action.service };
  return { kind: 'close' };
}
