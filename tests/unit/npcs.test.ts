import { describe, expect, it } from 'vitest';
import { INTERACTION_RANGE_PX } from '../../src/config/balance';
import { NPC_DEFINITIONS } from '../../src/content/npcs';
import { nearestNpc } from '../../src/simulation/npcs';
import { createInitialState } from '../../src/simulation/state';
import { NpcPanel } from '../../src/ui/npcPanel';

describe('friendly NPC content', () => {
  it('defines one stable character for every planned world service', () => {
    expect(NPC_DEFINITIONS.map((npc) => npc.service)).toEqual(['blacksmith', 'farm', 'market']);
    expect(new Set(NPC_DEFINITIONS.map((npc) => npc.id)).size).toBe(NPC_DEFINITIONS.length);
  });

  it('finds an NPC only inside interaction range', () => {
    const state = createInitialState(123);
    const mara = NPC_DEFINITIONS[0]!;
    state.player.x = mara.x + INTERACTION_RANGE_PX + 1;
    state.player.y = mara.y;
    expect(nearestNpc(state)).toBeNull();
    state.player.x = mara.x + INTERACTION_RANGE_PX;
    expect(nearestNpc(state)?.id).toBe('mara-smith');
  });

  it('opens an accessible service conversation and closes cleanly', () => {
    const panel = new NpcPanel(document.body);
    panel.open(NPC_DEFINITIONS[0]!);
    const dialog = document.querySelector('[role="dialog"]');
    expect(panel.isOpen).toBe(true);
    expect(dialog?.getAttribute('aria-label')).toBe('Conversation with Mara');
    expect(dialog?.textContent).toContain('Blacksmith services');
    expect(dialog?.textContent).toContain('Milestone 2');
    panel.close();
    expect(panel.isOpen).toBe(false);
    panel.destroy();
  });
});
