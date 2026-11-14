import { npcDefinition, type NpcId } from '../content/npcs';

export type NpcBarkKind = 'arrival' | 'nearby' | 'afterService';

export interface NpcBarkView { readonly npcId: NpcId; readonly npcName: string; readonly text: string; }

/** Incidental speech is transient, deterministic, and globally rate-limited. */
export class NpcBarkController {
  private nextAllowedAtMs = 0;
  private readonly indices = new Map<string, number>();

  constructor(private readonly cooldownMs = 12_000) {}

  request(npcId: NpcId, kind: NpcBarkKind, nowMs: number): NpcBarkView | null {
    if (nowMs < this.nextAllowedAtMs) return null;
    const npc = npcDefinition(npcId);
    const options = npc.barks[kind];
    if (options.length === 0) return null;
    const key = `${npcId}:${kind}`;
    const index = this.indices.get(key) ?? 0;
    this.indices.set(key, index + 1);
    this.nextAllowedAtMs = nowMs + this.cooldownMs;
    return { npcId, npcName: npc.name, text: options[index % options.length] ?? '' };
  }
}
