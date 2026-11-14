import { afterEach, describe, expect, it, vi } from 'vitest';
import { NpcBarkController } from '../../src/presentation/npcBarks';
import { NpcDialogueController } from '../../src/presentation/npcDialogue';
import { createInitialState } from '../../src/simulation/state';
import { NpcDialogue } from '../../src/ui/npcDialogue';
import { dialogueDefinition } from '../../src/content/dialogues';
import { NPC_DEFINITIONS } from '../../src/content/npcs';

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('NPC dialogue model', () => {
  it('gives every NPC a distinct first-visit acknowledgment, return line, and service handoff', () => {
    const firstLines = new Set<string>();
    const returnLines = new Set<string>();
    for (const npc of NPC_DEFINITIONS) {
      const definition = dialogueDefinition(npc.dialogueId);
      const firstRule = definition.startRules.find((rule) => rule.conditions.some((condition) => condition.kind === 'first-visit'))!;
      const repeatRule = definition.startRules.find((rule) => rule.conditions.some((condition) => condition.kind === 'repeat-visit'))!;
      const first = definition.nodes.find((node) => node.id === firstRule.nodeId)!;
      const returning = definition.nodes.find((node) => node.id === repeatRule.nodeId)!;
      const firstText = typeof first.text === 'string' ? first.text : first.text.join(' ');
      const returnText = typeof returning.text === 'string' ? returning.text : returning.text.join(' ');
      firstLines.add(firstText);
      returnLines.add(returnText);
      expect(definition.nodes.flatMap((node) => node.choices)
        .some((choice) => choice.action?.kind === 'open-service' && choice.action.service === npc.service)).toBe(true);
    }
    expect(firstLines.size).toBe(NPC_DEFINITIONS.length);
    expect(returnLines.size).toBe(NPC_DEFINITIONS.length);
  });

  it('tracks visits and explicitly seen moments while exposing Mara choices', () => {
    const state = createInitialState(401);
    const controller = new NpcDialogueController();

    const first = controller.start(state, 'mara-smith');
    expect(first.nodeId).toBe('first-meeting');
    expect(first.choices.map((choice) => choice.label)).toEqual([
      'Let me see your tools', 'Train me', 'What are you working on?', 'Goodbye',
    ]);
    expect(state.npcMemory).toEqual({ visits: { 'mara-smith': 1 }, seenMomentIds: ['mara:introduction'] });

    const work = controller.choose('work');
    expect(work.kind).toBe('view');
    if (work.kind === 'view') expect(work.view.nodeId).toBe('work');
    expect(state.npcMemory.seenMomentIds).toContain('mara:current-work');
    expect(controller.choose('work-tools')).toEqual({ kind: 'open-service', npcId: 'mara-smith', service: 'weaponsmith' });
  });

  it('selects recent-purchase, progression, equipment, and repeat greetings in priority order', () => {
    const state = createInitialState(402);
    state.npcMemory.visits['mara-smith'] = 1;
    const controller = new NpcDialogueController();
    expect(controller.start(state, 'mara-smith').nodeId).toBe('returning');
    controller.close();

    state.tools.push({ instanceId: 'tool-1', definitionId: 'wooden-axe', durability: 60, maxDurability: 60, powerRank: 0, speedRank: 0, durabilityRank: 0 });
    state.equippedToolId = 'tool-1';
    expect(controller.start(state, 'mara-smith').nodeId).toBe('equipped');
    controller.close();

    state.player.level = 3;
    expect(controller.start(state, 'mara-smith').nodeId).toBe('seasoned');
    controller.close();
    expect(controller.start(state, 'mara-smith', { recentPurchaseService: 'weaponsmith' }).nodeId).toBe('recent-purchase');
  });
});

describe('NPC barks', () => {
  it('cycles deterministically and rate-limits incidental speech', () => {
    const barks = new NpcBarkController(1_000);
    expect(barks.request('mara-smith', 'arrival', 0)?.npcName).toBe('Mara');
    expect(barks.request('mara-smith', 'nearby', 999)).toBeNull();
    expect(barks.request('mara-smith', 'nearby', 1_000)?.text).toContain('anvil');
  });
});

describe('NPC dialogue surface', () => {
  it('reveals text, supports numeric choices, Escape, and touch-sized controls', () => {
    vi.useFakeTimers();
    const onChoice = vi.fn();
    const onClose = vi.fn();
    const surface = new NpcDialogue(document.body, { onChoice, onClose });
    surface.open({
      npcId: 'mara-smith', npcName: 'Mara', npcTitle: 'The Smith', portraitInitials: 'M',
      portraitPrimary: '#8f3d32', portraitAccent: '#ffb24d', nodeId: 'test', text: 'A measured line.',
      choices: [{ id: 'tools', label: 'Let me see your tools' }],
    });

    const root = document.querySelector<HTMLElement>('[data-ui-panel="npc-dialogue"]')!;
    expect(root.getAttribute('aria-modal')).toBe('true');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const button = root.querySelector<HTMLButtonElement>('[data-choice-id="tools"]')!;
    expect(button.style.minHeight).toBe('44px');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true }));
    expect(onChoice).toHaveBeenCalledWith('tools');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onClose).toHaveBeenCalledOnce();
    surface.destroy();
  });
});
