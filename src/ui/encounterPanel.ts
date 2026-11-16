import { creatureDefinition, type CombatStyle } from '../content/creatures';
import { creatureBondLevel } from '../content/companionAbilities';
import { isOpeningGuardian } from '../content/onboarding';
import {
  BACKWARD_SP_COST,
  companionAbilityAvailability,
  encounterAvailability,
  encounterDistance,
  enemyIntentLabel,
  FORWARD_SP_COST,
  MAGIC_MANA_COST,
  MAP_SIZE,
  MELEE_RANGE,
  MELEE_STAMINA_COST,
  RANGED_RANGE,
  REST_SP_RECOVER,
  snareChanceBps,
  STYLE_PROFILES,
  type EncounterAction,
  type EncounterCommandResult,
} from '../simulation/encounters';
import type { CompanionAbilityId, GameState, SpeciesId } from '../simulation/state';
import { magicStaffPowerBonus } from '../simulation/characterProgression';
import { div, uiButton } from './controls';
import {BATTLE_TIMING} from '../presentation/combatTiming';
import {characterPortrait,setCharacterPortrait} from './portraits';

const STYLE_ICONS: Readonly<Record<CombatStyle, string>> = { melee: '⚔️', ranged: '🏹', magic: '✨' };
/** Impact/counter/outro pacing in ms — "quick with punch", under a second per round. */
const COUNTER_MS = BATTLE_TIMING.duration*BATTLE_TIMING.reply;
const UNLOCK_MS = BATTLE_TIMING.duration;
const OUTRO_MS = 1600;

interface BarParts { fill: HTMLDivElement; text: HTMLDivElement }

/**
 * Accessible battle controls, vitals and terminal messages over the 3D arena.
 * ThreeBattleStage owns the fighters and effects; the UI keeps round timing.
 */
export class EncounterPanel {
  private readonly root: HTMLDivElement;
  private readonly stage: HTMLDivElement;
  private readonly heading: HTMLDivElement;
  private readonly roundLabel: HTMLDivElement;
  private readonly message: HTMLDivElement;
  private readonly distanceLabel: HTMLDivElement;
  private readonly distanceTrack: HTMLDivElement;
  private readonly intentLabel: HTMLDivElement;
  private readonly openingLesson: HTMLDivElement;
  private readonly playerMarker: HTMLDivElement;
  private readonly creatureMarker: HTMLDivElement;

  private readonly companionRail: HTMLDivElement;
  private readonly creatureName: HTMLDivElement;
  private readonly creatureTraits: HTMLDivElement;
  private readonly outro: HTMLDivElement;
  private readonly buttons = new Map<EncounterAction, HTMLButtonElement>();
  private readonly bars = new Map<string, BarParts>();
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private renderedSpecies: SpeciesId | null = null;

  private animating = false;
  private outroActive = false;

  constructor(
    parent: HTMLElement,
    private readonly state: GameState,
    onAction: (action: EncounterAction) => void,
    private readonly onSelectAbility: (abilityId: CompanionAbilityId) => void,
  ) {
    ensureBattleStyles();
    this.root = div({
      position: 'absolute', inset: '0', zIndex: '30', display: 'none', flexDirection: 'column',
      overflow: 'hidden', pointerEvents: 'auto', backgroundColor: 'transparent',
    });
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-label', 'Wild creature encounter');
    this.root.classList.add('elaris-battle');

    const banner = div({ position: 'relative', zIndex: '2', textAlign: 'center', padding: '12px 16px 0', color: '#f2f7ee', textShadow: '0 2px 4px rgba(0,0,0,0.45)', font: '700 20px system-ui, sans-serif' });
    this.heading = div({ fontSize: 'clamp(18px, 3.4vw, 26px)', letterSpacing: '0.4px' });
    this.roundLabel = div({ fontSize: '13px', fontWeight: '600', opacity: '0.9', marginTop: '2px' });
    this.message = div({
      margin: '8px auto 0', maxWidth: 'min(560px, 90vw)', minHeight: '38px', padding: '7px 14px', borderRadius: '10px',
      background: 'rgba(9,20,14,0.72)', border: '1px solid rgba(255,255,255,0.16)',
      font: '600 13px/1.4 system-ui, sans-serif', color: '#e8f0ea',
    });
    this.message.setAttribute('aria-live', 'polite');
    this.distanceLabel = div({ margin: '6px auto 0', font: '700 12px system-ui, sans-serif', color: '#fff3bd' });
    this.distanceTrack = div({ position: 'relative', width: 'min(520px, 86vw)', height: '18px', margin: '5px auto 0', background: '#17231c', border: '2px solid #6f8a61', boxSizing: 'border-box' });
    const meleeBand = div({ position: 'absolute', right: '0', top: '0', bottom: '0', width: `${(MELEE_RANGE / MAP_SIZE) * 100}%`, background: 'rgba(189,92,82,.42)' });
    const rangedBand = div({ position: 'absolute', right: `${(MELEE_RANGE / MAP_SIZE) * 100}%`, top: '0', bottom: '0', width: `${((RANGED_RANGE - MELEE_RANGE) / MAP_SIZE) * 100}%`, background: 'rgba(213,174,88,.28)' });
    this.playerMarker = div({ position: 'absolute', top: '2px', width: '8px', height: '10px', transform: 'translateX(-50%)', background: '#f5ecd6', border: '1px solid #17231c' });
    this.creatureMarker = div({ position: 'absolute', top: '2px', width: '8px', height: '10px', transform: 'translateX(-50%)', background: '#5fb98a', border: '1px solid #17231c' });
    this.distanceTrack.append(meleeBand, rangedBand, this.playerMarker, this.creatureMarker);
    this.intentLabel = div({ margin: '5px auto 0', width: 'fit-content', padding: '4px 9px', borderRadius: '999px', background: 'rgba(122,63,63,.9)', font: '700 11px system-ui, sans-serif', color: '#fff3bd' });
    this.openingLesson = div({ margin: '5px auto 0', maxWidth: '540px', font: '600 12px system-ui,sans-serif', color: '#b5e7f0', display: 'none' });
    this.openingLesson.setAttribute('aria-label', 'Supply run combat lesson');
    banner.append(this.heading, this.roundLabel, this.message, this.intentLabel, this.openingLesson, this.distanceLabel, this.distanceTrack);

    this.stage = div({ position: 'relative', zIndex: '1', flex: '1', minHeight: '160px' });
    this.stage.classList.add('eb-stage');

    // Bottom bar: player plate · action grid · creature plate, S&S style.
    const bottom = div({
      position: 'relative', zIndex: '2', display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'stretch',
      justifyContent: 'center', padding: '10px 12px calc(env(safe-area-inset-bottom) + 12px)',
      background: 'linear-gradient(180deg, rgba(6,12,8,0.55), rgba(6,12,8,0.82))', backdropFilter: 'blur(3px)',
    });
    bottom.classList.add('eb-bottom');

    const playerPlate = this.buildPlate('You', '#3f7a4f');
    this.bars.set('playerHp', this.addBar(playerPlate, 'HP', '#d9534f'));
    this.bars.set('playerSp', this.addBar(playerPlate, 'SP', '#c9a227'));
    this.bars.set('playerMp', this.addBar(playerPlate, 'MP', '#5a8fd6'));

    const actions = div({ display: 'flex', flexDirection: 'column', gap: '8px', flex: '2 1 300px', maxWidth: '480px', justifyContent: 'center' });
    actions.classList.add('eb-actions');
    this.companionRail = div({ display: 'none', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '6px' });
    const attackRow = div({ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '8px' });
    const movementRow = div({ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '8px' });
    const tacticRow = div({ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '8px' });
    const attackEntries: Array<[EncounterAction, string]> = [['melee', 'Melee attack'], ['ranged', 'Ranged attack'], ['magic', 'Magic attack']];
    for (const [action, aria] of attackEntries) {
      const button = uiButton('', () => onAction(action));
      button.setAttribute('aria-label', aria);
      Object.assign(button.style, { minHeight: '52px', fontWeight: '700', background: '#7a3f3f', whiteSpace: 'nowrap' });
      this.buttons.set(action, button);
      attackRow.appendChild(button);
    }
    const movementEntries: Array<[EncounterAction, string, string]> = [
      ['backward', 'Move backward', '#3f617a'],
      ['forward', 'Move forward', '#3f617a'],
      ['rest', 'Rest', '#6b6332'],
    ];
    for (const [action, aria, color] of movementEntries) {
      const button = uiButton('', () => onAction(action));
      button.setAttribute('aria-label', aria);
      Object.assign(button.style, { minHeight: '44px', background: color, whiteSpace: 'nowrap' });
      this.buttons.set(action, button);
      movementRow.appendChild(button);
    }
    const tacticEntries: Array<[EncounterAction, string, string]> = [
      ['snare', 'Throw Snare', '#5c4a7d'],
      ['berry', 'Eat Berry', '#2f6b43'],
      ['flee', 'Flee', '#4a5560'],
    ];
    for (const [action, aria, color] of tacticEntries) {
      const button = uiButton('', () => onAction(action));
      button.setAttribute('aria-label', aria);
      Object.assign(button.style, { minHeight: '48px', background: color, whiteSpace: 'nowrap' });
      this.buttons.set(action, button);
      tacticRow.appendChild(button);
    }
    actions.append(this.companionRail, attackRow, movementRow, tacticRow);

    const creaturePlate = this.buildPlate('', '#7a5a3f');
    this.creatureName = creaturePlate.querySelector('.eb-fighter-name') as HTMLDivElement;
    this.bars.set('creatureHp', this.addBar(creaturePlate, 'HP', '#d9534f'));
    this.creatureTraits = div({ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '6px', font: '600 11px system-ui, sans-serif' });
    creaturePlate.appendChild(this.creatureTraits);

    bottom.append(playerPlate, actions, creaturePlate);

    this.outro = div({
      position: 'absolute', left: '50%', top: '38%', transform: 'translate(-50%, -50%)', zIndex: '3', display: 'none',
      padding: '16px 28px', borderRadius: '14px', background: 'rgba(9,20,14,0.92)', border: '2px solid rgba(255,224,138,0.7)',
      font: '800 clamp(20px, 4vw, 30px) system-ui, sans-serif', color: '#ffe08a', textAlign: 'center',
      boxShadow: '0 14px 44px rgba(0,0,0,0.5)', maxWidth: '86vw',
    });

    this.root.append(banner, this.stage, bottom, this.outro);
    parent.appendChild(this.root);
  }

  private buildPlate(name: string, nameColor: string): HTMLDivElement {
    const plate = div({
      flex: '1 1 170px', maxWidth: '230px', minWidth: '150px', padding: '9px 11px', borderRadius: '12px',
      background: 'rgba(9,20,14,0.9)', border: '1px solid rgba(255,255,255,0.2)', color: '#e8f0ea',
      font: '13px system-ui, sans-serif',
    });
    plate.classList.add('elaris-panel', 'eb-plate');
    const title = div({ padding: '3px 8px', marginBottom: '7px', borderRadius: '6px', background: nameColor, font: '700 13px system-ui, sans-serif', textAlign: 'center' });
    title.classList.add('eb-plate-title');
    const label=div({});label.className='eb-fighter-name';label.textContent=name;
    title.append(characterPortrait(name?'player':'tuftle',38),label);
    plate.appendChild(title);
    return plate;
  }

  private addBar(plate: HTMLDivElement, label: string, color: string): BarParts {
    const row = div({ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '5px' });
    const caption = div({ width: '52px', font: '700 10px system-ui, sans-serif', opacity: '0.85', textTransform: 'uppercase', letterSpacing: '0.4px' });
    caption.textContent = label;
    const track = div({ flex: '1', height: '14px', borderRadius: '7px', background: 'rgba(255,255,255,0.12)', overflow: 'hidden', border: '1px solid rgba(0,0,0,0.4)' });
    const fill = div({ height: '100%', width: '0%', background: color, transition: 'width 0.3s ease' });
    track.appendChild(fill);
    const text = div({ minWidth: '52px', textAlign: 'right', font: '700 11px system-ui, sans-serif' });
    row.append(caption, track, text);
    plate.appendChild(row);
    return { fill, text };
  }

  /** True while the battle screen owns the display, including the outro linger. */
  get isOpen(): boolean {
    return this.state.activeEncounter !== null || this.outroActive;
  }

  /** Sync the whole screen from state. Safe to call every HUD refresh tick. */
  refresh(): void {
    const encounter = this.state.activeEncounter;
    if (!encounter && !this.outroActive) { this.root.style.display = 'none'; return; }
    this.root.style.display = 'flex';
    if (!encounter) return; // outro is playing over the final frame

    const wild = this.state.wildCreatures.find((item) => item.id === encounter.wildCreatureId);
    const definition = wild ? creatureDefinition(wild.speciesId) : null;
    const name = definition?.displayName ?? 'Wild creature';
    this.heading.textContent = `Wild ${name}`;
    this.roundLabel.textContent = `Round ${encounter.round}`;
    this.message.textContent = encounter.message;
    this.intentLabel.textContent = `Intent: ${enemyIntentLabel(encounter.enemyIntent)}`;
    const guided = isOpeningGuardian(this.state, encounter.wildCreatureId);
    this.openingLesson.style.display = guided ? 'block' : 'none';
    if (guided) this.openingLesson.textContent = `${this.state.onboarding.supplyRun!.guardedDamage > 0 ? `Shell Guard prevented ${this.state.onboarding.supplyRun!.guardedDamage} damage. ` : ''}Read Intent before acting. Rest lets the creature approach. Shell Guard works when ready. Retreat is guaranteed; supplies do not require a win.`;
    this.distanceLabel.textContent = `Distance ${encounterDistance(encounter)} · Melee ≤${MELEE_RANGE} · Ranged ≤${RANGED_RANGE} · Magic ∞`;
    this.creatureName.textContent = name;
    if(wild)setCharacterPortrait(this.creatureName.previousElementSibling as HTMLElement,wild.speciesId);

    const companion = encounter.companionCreatureId
      ? this.state.ownedCreatures.find((creature) => creature.id === encounter.companionCreatureId)
      : null;
    this.companionRail.style.display = companion ? 'grid' : 'none';
    if (companion) {
      const bondLevel = creatureBondLevel(companion);
      const selectedId = encounter.selectedCompanionAbilityId;
      this.companionRail.replaceChildren(...creatureDefinition(companion.speciesId).encounter.battleAbilities.map((ability) => {
        const reason = companionAbilityAvailability(this.state, ability.id);
        const selected = selectedId === ability.id;
        const button = uiButton('', () => this.onSelectAbility(ability.id));
        const label = document.createElement('strong');
        label.textContent = ability.displayName;
        const status = document.createElement('small');
        status.textContent = reason ?? 'Ready';
        Object.assign(status.style, { display: 'block', marginTop: '2px', opacity: '0.78', fontSize: '9px' });
        button.append(label, status);
        Object.assign(button.style, { minWidth: '0', minHeight: '44px', padding: '5px 3px', fontSize: '10px', lineHeight: '1.15', background: selected ? '#2f6b43' : '#33483a', borderColor: selected ? '#ffe08a' : 'rgba(255,255,255,.16)' });
        button.disabled = this.animating || bondLevel < ability.unlockBondLevel;
        button.title = `${ability.description}${reason ? ` · ${reason}` : ''}`;
        button.setAttribute('aria-label', `${companion.name}: ${ability.displayName}. ${ability.description}. ${reason ?? 'Ready'}`);
        button.setAttribute('aria-pressed', selected ? 'true' : 'false');
        return button;
      }));
    } else {
      this.companionRail.replaceChildren();
    }

    if (wild && definition && this.renderedSpecies !== wild.speciesId) {
      this.renderedSpecies = wild.speciesId;
      this.root.dataset.habitat = definition.habitat;
      this.creatureTraits.replaceChildren(
        traitChip(`Weak: ${STYLE_ICONS[definition.encounter.weakTo]} ${STYLE_PROFILES[definition.encounter.weakTo].label}`, '#3f7a4f'),
        traitChip(`Resists: ${STYLE_ICONS[definition.encounter.resistTo]} ${STYLE_PROFILES[definition.encounter.resistTo].label}`, '#7a3f3f'),
      );
    }

    const player = this.state.player;
    this.setBar('playerHp', player.hp, player.maxHp);
    this.setBar('playerSp', player.stamina, player.maxStamina);
    this.setBar('playerMp', player.mana, player.maxMana);
    this.setBar('creatureHp', encounter.creatureHp, encounter.creatureMaxHp);
    this.playerMarker.style.left = `${(encounter.playerPos / MAP_SIZE) * 100}%`;
    this.creatureMarker.style.left = `${(encounter.creaturePos / MAP_SIZE) * 100}%`;

    for (const [action, button] of this.buttons) {
      const reason = encounterAvailability(this.state, action);
      button.disabled = this.animating || reason !== null;
      button.title = reason ?? '';
      button.style.opacity = button.disabled ? '0.55' : '1';
      if (action === 'melee' || action === 'ranged') {
        button.style.outline = reason?.startsWith('Too far') ? '2px solid #e3a45f' : 'none';
      }
    }
    const supplies = this.state.inventory;
    this.buttons.get('melee')!.textContent = `Melee · ${MELEE_STAMINA_COST} SP`;
    this.buttons.get('ranged')!.textContent = `Ranged (${supplies.arrow})`;
    const staffBonus = magicStaffPowerBonus(this.state);
    const magicButton = this.buttons.get('magic')!;
    magicButton.style.whiteSpace = staffBonus > 0 ? 'pre-line' : 'nowrap';
    magicButton.style.lineHeight = staffBonus > 0 ? '1.15' : '';
    magicButton.textContent = staffBonus > 0
      ? `Magic · ${MAGIC_MANA_COST} MP\nStaff +${staffBonus}`
      : `Magic · ${MAGIC_MANA_COST} MP`;
    this.buttons.get('backward')!.textContent = `◀ Backward · ${BACKWARD_SP_COST} SP`;
    this.buttons.get('forward')!.textContent = `Forward · ${FORWARD_SP_COST} SP ▶`;
    this.buttons.get('rest')!.textContent = `Rest +${REST_SP_RECOVER} SP`;
    // Weakening the creature raises the spec snare chance; show it live.
    this.buttons.get('snare')!.textContent = `Snare (${supplies['taming-snare']}) · ${Math.round(snareChanceBps(this.state) / 100)}%`;
    this.buttons.get('berry')!.textContent = `Berry (${supplies.berry})`;
    this.buttons.get('flee')!.textContent = 'Flee';
  }

  /** Replay one resolved round as a short animation, then unlock the buttons. */
  playResult(_action: EncounterAction, result: EncounterCommandResult): void {
    if (!result.ok) { this.refresh(); return; }
    this.animating = true;
    this.message.textContent = result.message;
    this.refresh();
    // ThreeBattleStage owns fighters, effects and movement. The accessible
    // controls retain the same round lock and terminal outro timings.
    if (result.ended) {
      this.outroActive = true;
      this.later(COUNTER_MS, () => this.showOutro(result));
      this.later(COUNTER_MS + OUTRO_MS, () => {
        this.outroActive=false; this.outro.style.display='none'; this.animating=false; this.refresh();
      });
    } else this.later(UNLOCK_MS, () => { this.animating=false; this.refresh(); });
  }

  private showOutro(result: EncounterCommandResult): void {
    let text: string;
    if (result.tamed) text = 'Captured!';
    else if (result.defeated) text = 'Victory!';
    else if (result.playerDefeated) text = 'Defeated…';
    else text = 'Escaped';
    const detail = div({ marginTop: '6px', font: '600 13px/1.4 system-ui, sans-serif', color: '#e8f0ea' });
    detail.textContent = result.message;
    this.outro.replaceChildren(document.createTextNode(text), detail);
    this.outro.style.display = 'block';
  }

  private setBar(key: string, value: number, max: number): void {
    const bar = this.bars.get(key)!;
    bar.fill.style.width = `${Math.max(0, Math.min(100, (value / Math.max(1, max)) * 100))}%`;
    bar.text.textContent = `${value}/${max}`;
  }

  private later(ms: number, run: () => void): void {
    const timer = setTimeout(() => { this.timers.delete(timer); run(); }, ms);
    this.timers.add(timer);
  }

  /** Immediately release the battle presentation when respawn takes over. */
  dismiss(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    this.outroActive = false;
    this.animating = false;
    this.outro.style.display = 'none';
    this.root.style.display = 'none';
  }

  destroy(): void {
    this.dismiss();
    this.root.remove();
  }
}

function traitChip(text: string, background: string): HTMLDivElement {
  const chip = div({ padding: '2px 7px', borderRadius: '999px', background, whiteSpace: 'nowrap' });
  chip.textContent = text;
  return chip;
}

function ensureBattleStyles(): void {
  if (document.getElementById('encounter-battle-styles')) return;
  const style = document.createElement('style');
  style.id = 'encounter-battle-styles';
  style.textContent = `
html[data-presentation="3d"] .elaris-battle {
  background-color: transparent !important;
  background-image: none !important;
}
html[data-presentation="3d"] .elaris-battle .eb-stage {
  opacity: 0;
  pointer-events: none;
}
@media (max-width: 600px) {
  .elaris-battle .eb-bottom { gap: 4px !important; padding: 6px 6px calc(env(safe-area-inset-bottom) + 6px) !important; }
  .elaris-battle .eb-plate { flex-basis: calc(50% - 4px) !important; min-width: 0 !important; max-width: none !important; padding: 5px 7px !important; }
  .elaris-battle .eb-actions { order: 3; flex-basis: 100% !important; max-width: none !important; gap: 4px !important; }
  .elaris-battle button { min-height: 44px !important; padding: 5px 3px !important; font-size: 11px !important; }
}
@media (max-height: 430px) {
  .elaris-battle .eb-plate { display: none !important; }
  .elaris-battle .eb-actions { max-width: 620px !important; }
}
`;
  document.head.appendChild(style);
}
