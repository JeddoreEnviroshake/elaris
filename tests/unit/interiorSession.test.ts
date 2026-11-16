import { describe, expect, it } from 'vitest';
import {
  gameplayModeAllowsWorldInteraction,
  gameplayModeOwnsOverlayInput,
  InteriorSessionController,
} from '../../src/presentation/interiorSession';

describe('keeper conversations', () => {
  it('hands input to a dialogue, then its service, then back to the world', () => {
    const session = new InteriorSessionController();
    expect(session.mode).toEqual({ kind: 'world' });
    expect(session.isActive).toBe(false);
    expect(session.allowsWorldInteraction).toBe(true);

    // Walking into a shop is ordinary world play; only talking takes input.
    session.beginDialogue('market', 'tavi-trader');
    expect(session.mode).toEqual({ kind: 'dialogue', buildingId: 'market', npcId: 'tavi-trader' });
    expect(session.buildingId).toBe('market');
    expect(session.allowsWorldInteraction).toBe(false);
    expect(session.ownsOverlayInput).toBe(true);

    session.openService('tavi-trader');
    expect(session.mode).toEqual({ kind: 'service', buildingId: 'market', npcId: 'tavi-trader' });
    expect(session.ownsOverlayInput).toBe(true);

    session.endConversation();
    expect(session.mode).toEqual({ kind: 'world' });
    expect(session.buildingId).toBeNull();
    expect(session.allowsWorldInteraction).toBe(true);
  });

  it('defines input ownership for every gameplay mode', () => {
    expect(gameplayModeAllowsWorldInteraction({ kind: 'world' })).toBe(true);
    expect(gameplayModeOwnsOverlayInput({ kind: 'world' })).toBe(false);
    for (const kind of ['dialogue', 'service'] as const) {
      const mode = { kind, buildingId: 'tavern', npcId: 'bram-innkeeper' } as const;
      expect(gameplayModeAllowsWorldInteraction(mode)).toBe(false);
      expect(gameplayModeOwnsOverlayInput(mode)).toBe(true);
    }
  });

  it('refuses overlapping conversations and recovers to the world', () => {
    const session = new InteriorSessionController();
    expect(() => session.openService('mara-smith')).toThrow();
    session.beginDialogue('weaponsmith', 'mara-smith');
    expect(() => session.beginDialogue('tavern', 'bram-innkeeper')).toThrow();
    session.recoverToWorld();
    expect(session.mode).toEqual({ kind: 'world' });
  });
});
