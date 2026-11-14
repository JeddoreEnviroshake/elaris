import { creatureDefinition, type CombatStyle } from '../content/creatures';
import { creatureBondLevel } from '../content/companionAbilities';
import { isOpeningGuardian } from '../content/onboarding';
import { battleArenaPath } from '../art/battleArenas';
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
  type StrikeOutcome,
} from '../simulation/encounters';
import type { CompanionAbilityId, GameState, SpeciesId } from '../simulation/state';
import { magicStaffPowerBonus } from '../simulation/characterProgression';
import { div, uiButton } from './controls';

const STYLE_ICONS: Readonly<Record<CombatStyle, string>> = { melee: '⚔️', ranged: '🏹', magic: '✨' };
/** Impact/counter/outro pacing in ms — "quick with punch", under a second per round. */
const IMPACT_MS = 240;
const COUNTER_MS = 480;
const UNLOCK_MS = 1100;
const OUTRO_MS = 1600;

interface BarParts { fill: HTMLDivElement; text: HTMLDivElement }

/**
 * Fullscreen Swords-and-Sandals-style battle arena. The simulation resolves a
 * whole round atomically; this screen replays it as a short, punchy sequence —
 * lunges, projectiles, floating damage text — then unlocks the action bar.
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
  private readonly playerFighter: HTMLDivElement;
  private readonly creatureFighter: HTMLDivElement;
  private readonly companionFighter: HTMLDivElement;
  private readonly companionRail: HTMLDivElement;
  private readonly creatureName: HTMLDivElement;
  private readonly creatureTraits: HTMLDivElement;
  private readonly outro: HTMLDivElement;
  private readonly buttons = new Map<EncounterAction, HTMLButtonElement>();
  private readonly bars = new Map<string, BarParts>();
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private renderedSpecies: SpeciesId | null = null;
  private renderedCompanionId: string | null = null;
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
      overflow: 'hidden', pointerEvents: 'auto', backgroundColor: '#36543b',
      backgroundImage: 'linear-gradient(rgba(11,18,14,0.08), rgba(11,18,14,0.16)), url("/assets/battle/grassland-arena.png")',
      backgroundSize: 'cover', backgroundPosition: 'center', imageRendering: 'pixelated',
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
    this.playerFighter = div({ position: 'absolute', left: '33.2%', bottom: '6%', width: 'clamp(90px, 16vw, 150px)', transform: 'translateX(-50%)', transition: 'left 280ms ease-in-out' });
    this.companionFighter = div({ position: 'absolute', left: '20%', bottom: '5%', width: 'clamp(58px, 10vw, 92px)', transform: 'translateX(-50%)', transition: 'left 280ms ease-in-out', display: 'none' });
    this.creatureFighter = div({ position: 'absolute', left: '66.8%', bottom: '6%', width: 'clamp(90px, 16vw, 150px)', transform: 'translateX(-50%)', transition: 'left 280ms ease-in-out' });
    this.playerFighter.appendChild(createBattleFighterCanvas('player'));
    // Grounding shadows sell the side-view "arena floor" reading.
    for (const fighter of [this.playerFighter, this.creatureFighter]) {
      const shadow = div({ position: 'absolute', left: '10%', right: '10%', bottom: '-6px', height: '12px', borderRadius: '50%', background: 'rgba(10,20,12,0.35)', filter: 'blur(2px)' });
      fighter.appendChild(shadow);
    }
    this.stage.append(this.companionFighter, this.playerFighter, this.creatureFighter);

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
    this.creatureName = creaturePlate.firstElementChild as HTMLDivElement;
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
    title.textContent = name;
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

    const companion = encounter.companionCreatureId
      ? this.state.ownedCreatures.find((creature) => creature.id === encounter.companionCreatureId)
      : null;
    this.companionFighter.style.display = companion ? 'block' : 'none';
    this.companionRail.style.display = companion ? 'grid' : 'none';
    if (companion && this.renderedCompanionId !== companion.id) {
      this.renderedCompanionId = companion.id;
      this.companionFighter.replaceChildren(createBattleFighterCanvas(companion.speciesId));
      const shadow = div({ position: 'absolute', left: '10%', right: '10%', bottom: '-6px', height: '10px', borderRadius: '50%', background: 'rgba(10,20,12,0.35)', filter: 'blur(2px)' });
      this.companionFighter.appendChild(shadow);
    }
    if (!companion) this.renderedCompanionId = null;
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
      this.root.style.backgroundImage = `linear-gradient(rgba(11,18,14,0.08), rgba(11,18,14,0.16)), url("${battleArenaPath(definition.habitat)}")`;
      this.creatureFighter.replaceChildren(createBattleFighterCanvas(wild.speciesId));
      const shadow = div({ position: 'absolute', left: '10%', right: '10%', bottom: '-6px', height: '12px', borderRadius: '50%', background: 'rgba(10,20,12,0.35)', filter: 'blur(2px)' });
      this.creatureFighter.appendChild(shadow);
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
    if (!this.animating) {
      this.setFighterPosition(this.playerFighter, encounter.playerPos);
      this.setFighterPosition(this.creatureFighter, encounter.creaturePos);
    }
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
  playResult(action: EncounterAction, result: EncounterCommandResult): void {
    if (!result.ok) { this.refresh(); return; }
    this.animating = true;
    this.message.textContent = result.message;
    this.refresh();

    const isAttack = action === 'melee' || action === 'ranged' || action === 'magic';
    if (result.playerMove) {
      this.setFighterPosition(this.playerFighter, result.playerMove.from);
      requestAnimationFrame(() => this.setFighterPosition(this.playerFighter, result.playerMove!.to));
    } else if (action === 'melee') this.animate(this.playerFighter, 'eb-lunge-right');
    else if (isAttack) { this.animate(this.playerFighter, 'eb-hop'); this.fireProjectile(action as CombatStyle); }
    else this.animate(this.playerFighter, 'eb-hop');

    this.later(IMPACT_MS, () => {
      if (result.playerStrike) this.showStrike(this.creatureFighter, result.playerStrike, true);
      if (result.snareFailed) this.float(this.creatureFighter, 'SNARE SLIPS', '#d9b3ff');
      if (action === 'berry') this.float(this.playerFighter, 'HP restored', '#9fe6a8');
      if (action === 'rest') this.float(this.playerFighter, `+${REST_SP_RECOVER} SP`, '#ffe08a');
    });

    if (result.companionAbility && !result.ended) this.later(IMPACT_MS + 120, () => {
      const support = result.companionAbility!;
      this.animate(this.companionFighter, 'eb-hop');
      if (support.healed) this.float(this.playerFighter, `+${support.healed} HP`, '#9fe6a8');
      else if (support.recoveredStamina) this.float(this.playerFighter, `+${support.recoveredStamina} SP`, '#ffe08a');
      else if (support.guardedDamage) this.float(this.playerFighter, `BLOCK ${support.guardedDamage}`, '#9fd4ff');
      else if (support.damage) this.float(this.creatureFighter, `-${support.damage}`, '#ffd18a');
      else this.float(this.companionFighter, support.displayName.toUpperCase(), '#d9b3ff');
      if (support.enemyMove) this.setFighterPosition(this.creatureFighter, support.enemyMove.to);
      if (support.playerMove) this.setFighterPosition(this.playerFighter, support.playerMove.to);
    });

    if (result.creatureMove && !result.ended) {
      this.later(COUNTER_MS, () => {
        this.setFighterPosition(this.creatureFighter, result.creatureMove!.to);
        if (!result.creatureStrike) this.float(this.creatureFighter, result.creatureMove!.to < result.creatureMove!.from ? 'ADVANCE' : 'RETREAT', '#fff3bd');
      });
    }
    if (result.creatureStrike && !result.ended) this.later(COUNTER_MS + (result.creatureMove ? 300 : 0), () => {
      this.animate(this.creatureFighter, 'eb-lunge-left');
      this.later(140, () => this.showStrike(this.playerFighter, result.creatureStrike!, false));
    });

    if (result.ended) {
      this.outroActive = true;
      this.later(COUNTER_MS, () => this.showOutro(result));
      this.later(COUNTER_MS + OUTRO_MS, () => {
        this.outroActive = false;
        this.outro.style.display = 'none';
        this.animating = false;
        this.refresh();
      });
    } else {
      this.later(UNLOCK_MS, () => { this.animating = false; this.refresh(); });
    }
  }

  private showStrike(target: HTMLDivElement, strike: StrikeOutcome, creatureIsTarget: boolean): void {
    if (strike.outcome === 'miss') { this.float(target, 'MISS', '#cfd8dc'); return; }
    if (strike.outcome === 'dodge') { this.float(target, 'DODGE', '#9fe6a8'); this.animate(target, 'eb-hop'); return; }
    const color = strike.outcome === 'crit'
      ? '#ffd166'
      : creatureIsTarget ? '#eef2f5' : '#ff5f57';
    this.float(target, strike.outcome === 'crit' ? `CRIT ${strike.damage}!` : `-${strike.damage}`, color);
    this.animate(target, 'eb-hit');
    if (!creatureIsTarget) this.animate(this.root, 'eb-screenshake');
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
    this.animate(this.outro, 'eb-pop');
  }

  private fireProjectile(style: CombatStyle): void {
    const projectile = div({
      position: 'absolute', bottom: '18%', left: '24%', zIndex: '2', pointerEvents: 'none',
      font: '20px system-ui, sans-serif',
      color: style === 'magic' ? '#c792ea' : '#e0d7c0',
      textShadow: style === 'magic' ? '0 0 8px #a06bd4' : 'none',
    });
    projectile.textContent = style === 'magic' ? '✦' : '➳';
    projectile.style.animation = `eb-shot ${IMPACT_MS}ms linear forwards`;
    this.stage.appendChild(projectile);
    this.later(IMPACT_MS + 60, () => projectile.remove());
  }

  private float(fighter: HTMLDivElement, text: string, color: string): void {
    const label = div({
      position: 'absolute', left: '50%', top: '-14px', transform: 'translateX(-50%)', pointerEvents: 'none',
      font: '800 clamp(15px, 2.6vw, 21px) system-ui, sans-serif', color, whiteSpace: 'nowrap',
      textShadow: '0 2px 3px rgba(0,0,0,0.65)', animation: 'eb-float 0.8s ease-out forwards', zIndex: '3',
    });
    label.textContent = text;
    fighter.appendChild(label);
    this.later(850, () => label.remove());
  }

  private animate(element: HTMLElement, name: string): void {
    element.style.animation = 'none';
    void element.offsetWidth; // restart the animation from frame zero
    element.style.animation = `${name} 0.36s ease-out`;
  }

  private setBar(key: string, value: number, max: number): void {
    const bar = this.bars.get(key)!;
    bar.fill.style.width = `${Math.max(0, Math.min(100, (value / Math.max(1, max)) * 100))}%`;
    bar.text.textContent = `${value}/${max}`;
  }

  private setFighterPosition(fighter: HTMLDivElement, position: number): void {
    const clamped = Math.max(0, Math.min(MAP_SIZE, position));
    fighter.style.left = `${8 + clamped * 0.84}%`;
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
@keyframes eb-lunge-right { 0% { transform: translateX(-50%); } 45% { transform: translateX(calc(-50% + clamp(28px, 6vw, 60px))); } 100% { transform: translateX(-50%); } }
@keyframes eb-lunge-left { 0% { transform: translateX(-50%); } 45% { transform: translateX(calc(-50% + clamp(-60px, -6vw, -28px))); } 100% { transform: translateX(-50%); } }
@keyframes eb-hop { 0% { transform: translateX(-50%); } 40% { transform: translate(-50%, -12px); } 100% { transform: translateX(-50%); } }
@keyframes eb-hit { 0% { filter: brightness(2.4); transform: translateX(calc(-50% + 6px)); } 40% { transform: translateX(calc(-50% - 5px)); } 70% { transform: translateX(calc(-50% + 3px)); } 100% { filter: none; transform: translateX(-50%); } }
@keyframes eb-screenshake { 0% { transform: translate(3px, 1px); } 30% { transform: translate(-3px, -2px); } 60% { transform: translate(2px, 2px); } 100% { transform: none; } }
@keyframes eb-float { 0% { opacity: 0; transform: translate(-50%, 6px) scale(0.8); } 20% { opacity: 1; transform: translate(-50%, -4px) scale(1.08); } 100% { opacity: 0; transform: translate(-50%, -34px) scale(1); } }
@keyframes eb-shot { from { left: 24%; opacity: 1; } to { left: 70%; opacity: 1; } }
@keyframes eb-pulse { 0% { box-shadow: 0 0 0 0 rgba(160,107,212,0.8); } 100% { box-shadow: 0 0 0 9px rgba(160,107,212,0); } }
@keyframes eb-pop { 0% { transform: translate(-50%, -50%) scale(0.6); opacity: 0; } 100% { transform: translate(-50%, -50%) scale(1); opacity: 1; } }
.elaris-battle canvas { image-rendering: pixelated; image-rendering: crisp-edges; }
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

/** Exact-pixel battle sprites. Canvas keeps the battle and overworld silhouettes aligned. */
function createBattleFighterCanvas(kind: SpeciesId | 'player'): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 48;
  canvas.height = 64;
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, { width: '100%', imageRendering: 'pixelated', display: 'block' } satisfies Partial<CSSStyleDeclaration>);
  const context = canvas.getContext('2d');
  if (!context) return canvas;
  context.imageSmoothingEnabled = false;
  const pixel = (color: string, x: number, y: number, width: number, height: number) => {
    context.fillStyle = color;
    context.fillRect(x, y, width, height);
  };
  // Crisp unblurred grounding shadow.
  pixel('rgba(11,18,14,.28)', 8, 57, 32, 4);
  if (kind === 'player') {
    pixel('#17231c', 15, 13, 18, 16); pixel('#d0a466', 17, 15, 14, 12); pixel('#513a29', 15, 11, 18, 7);
    pixel('#17231c', 12, 28, 23, 23); pixel('#36543b', 14, 29, 19, 20); pixel('#557a45', 15, 30, 17, 7);
    pixel('#d5ae58', 14, 42, 19, 3); pixel('#2b2119', 15, 49, 6, 9); pixel('#2b2119', 27, 49, 6, 9);
    pixel('#cbd0c6', 36, 18, 3, 23); pixel('#d5ae58', 32, 36, 11, 3); pixel('#17231c', 27, 18, 2, 2);
  } else if (kind === 'tuftle') {
    pixel('#17231c', 7, 24, 35, 25); pixel('#397052', 9, 25, 31, 22); pixel('#5fb98a', 13, 27, 23, 14);
    pixel('#8dd0a2', 12, 28, 13, 4); pixel('#35643f', 21, 23, 4, -11); pixel('#4d8a55', 25, 20, 10, -9);
    pixel('#17231c', 12, 34, 3, 3); pixel('#f5ecd6', 12, 34, 1, 1); pixel('#294a37', 12, 47, 7, 8); pixel('#294a37', 29, 47, 7, 8);
  } else if (kind === 'craghopper') {
    pixel('#17231c', 4, 43, 16, 9); pixel('#17231c', 29, 42, 15, 10);
    pixel('#454e50', 7, 42, 12, 7); pixel('#454e50', 30, 41, 11, 8);
    pixel('#17231c', 6, 25, 37, 25); pixel('#454e50', 8, 26, 33, 21); pixel('#697375', 9, 27, 27, 13);
    pixel('#929b96', 10, 28, 19, 5);
    pixel('#8f4f32', 16, 19, 5, 9); pixel('#d08b54', 22, 13, 6, 15); pixel('#e6b85c', 29, 18, 6, 11);
    pixel('#17231c', 10, 34, 4, 4); pixel('#f5ecd6', 10, 34, 1, 1);
    pixel('#d0a466', 10, 49, 9, 6); pixel('#d0a466', 30, 49, 10, 6);
  } else if (kind === 'glade-stag') {
    // Slender golden runner with pale face, lifted neck, and a broad antler crown.
    pixel('#17231c', 13, 34, 30, 16); pixel('#a9794a', 15, 35, 27, 12); pixel('#d0a466', 16, 36, 17, 6);
    pixel('#6f513b', 17, 46, 4, 12); pixel('#6f513b', 35, 46, 4, 12);
    pixel('#2b2119', 15, 57, 7, 2); pixel('#2b2119', 34, 57, 7, 2);
    pixel('#a9794a', 10, 22, 8, 18); pixel('#17231c', 5, 16, 15, 13); pixel('#a9794a', 7, 18, 12, 10);
    pixel('#f5ecd6', 6, 19, 9, 6); pixel('#17231c', 7, 20, 3, 3); pixel('#f5ecd6', 7, 20, 1, 1);
    pixel('#513a29', 11, 15, 8, 4); pixel('#78a365', 40, 36, 5, 3);
    pixel('#d9c38f', 10, 5, 3, 13); pixel('#d9c38f', 16, 4, 3, 14);
    pixel('#d9c38f', 4, 5, 9, 3); pixel('#d9c38f', 2, 9, 10, 3);
    pixel('#d9c38f', 18, 5, 9, 3); pixel('#d9c38f', 18, 10, 11, 3);
  } else {
    const body = '#bd5c52';
    const light = '#d58a4a';
    pixel('#17231c', 6, 24, 36, 25); pixel(body, 8, 25, 32, 21); pixel(light, 9, 26, 19, 8);
    pixel('#17231c', 10, 32, 3, 3); pixel('#f5ecd6', 10, 32, 1, 1); pixel(body, 11, 47, 7, 10); pixel(body, 31, 47, 7, 10);
    if (kind === 'snarlfox') { pixel(body, 38, 37, 8, 9); pixel('#f5ecd6', 44, 38, 4, 5); }
  }
  return canvas;
}

// Retained only as a development fallback for browsers without a 2D canvas.
void playerSvg;
void creatureSvg;

/** Side-view hero fallback. */
function playerSvg(): string {
  return `<svg viewBox="0 0 100 130" width="100%" aria-hidden="true">
    <ellipse cx="50" cy="126" rx="26" ry="4" fill="rgba(0,0,0,0.001)"/>
    <rect x="40" y="96" width="8" height="28" rx="3" fill="#3b4a5a"/>
    <rect x="52" y="96" width="8" height="28" rx="3" fill="#2f3d4b"/>
    <rect x="36" y="52" width="28" height="48" rx="9" fill="#3f7a4f"/>
    <rect x="36" y="76" width="28" height="8" fill="#8a6a3a"/>
    <circle cx="50" cy="36" r="16" fill="#e8b98a"/>
    <path d="M34 34 A16 16 0 0 1 66 34 L66 28 A16 16 0 0 0 34 28 Z" fill="#8f9aa6"/>
    <path d="M42 20 Q50 6 58 20 Z" fill="#c0392b"/>
    <circle cx="56" cy="36" r="2.2" fill="#20232a"/>
    <rect x="60" y="56" width="9" height="26" rx="4" fill="#e8b98a" transform="rotate(-32 64 58)"/>
    <rect x="74" y="26" width="5" height="34" rx="2" fill="#cfd8dc" transform="rotate(18 76 43)"/>
    <rect x="68" y="52" width="14" height="6" rx="2" fill="#8a6a3a" transform="rotate(18 75 55)"/>
    <ellipse cx="30" cy="70" rx="12" ry="16" fill="#8a6a3a" stroke="#5f4726" stroke-width="3"/>
    <circle cx="30" cy="70" r="4" fill="#cfa25a"/>
  </svg>`;
}

/** Side-view creature portraits, facing the hero. Shapes stay species-driven. */
function creatureSvg(speciesId: SpeciesId): string {
  if (speciesId === 'craghopper') {
    return `<svg viewBox="0 0 120 110" width="100%" aria-hidden="true">
      <path d="M20 84 Q14 46 44 34 Q78 20 100 46 Q112 62 100 80 Q84 96 48 92 Q26 92 20 84 Z" fill="#7d8894"/>
      <path d="M42 40 L54 26 L60 42 Z" fill="#8f9aa6"/>
      <path d="M72 30 L84 18 L88 36 Z" fill="#6b7682"/>
      <circle cx="38" cy="58" r="6" fill="#2b2f36"/><circle cx="36.5" cy="56.5" r="2" fill="#e8f0ea"/>
      <path d="M24 70 Q32 76 40 72" stroke="#4d5763" stroke-width="3" fill="none"/>
      <path d="M88 82 Q104 86 108 100 L92 100 Q84 92 82 84 Z" fill="#6b7682"/>
      <path d="M30 88 Q26 100 34 104 L44 100 Q38 94 38 88 Z" fill="#6b7682"/>
    </svg>`;
  }
  if (speciesId === 'glade-stag') {
    return `<svg viewBox="0 0 130 130" width="100%" aria-hidden="true">
      <path d="M30 22 Q22 6 12 8 M30 22 Q34 8 26 2 M30 22 Q40 12 38 4" stroke="#8a6a3a" stroke-width="4" fill="none" stroke-linecap="round"/>
      <circle cx="34" cy="36" r="13" fill="#c9995f"/>
      <circle cx="27" cy="34" r="2.2" fill="#20232a"/>
      <path d="M42 44 Q64 38 88 50 Q106 60 102 78 Q98 92 78 92 L52 92 Q36 88 36 70 Q34 52 42 44 Z" fill="#b8874e"/>
      <rect x="48" y="88" width="7" height="32" rx="3" fill="#8a6a3a"/>
      <rect x="88" y="88" width="7" height="32" rx="3" fill="#8a6a3a"/>
      <rect x="60" y="90" width="7" height="30" rx="3" fill="#7d5c32"/>
      <rect x="98" y="90" width="7" height="28" rx="3" fill="#7d5c32"/>
      <circle cx="104" cy="66" r="5" fill="#e8dcc8"/>
    </svg>`;
  }
  if (speciesId === 'snarlfox') {
    return `<svg viewBox="0 0 130 110" width="100%" aria-hidden="true">
      <path d="M18 44 L26 22 L38 40 Z" fill="#c25e2e"/>
      <path d="M52 40 L60 20 L70 38 Z" fill="#c25e2e"/>
      <path d="M14 58 Q28 38 56 42 Q84 46 96 62 Q104 74 94 84 Q78 94 48 90 Q22 86 14 72 Z" fill="#d4713a"/>
      <path d="M14 58 Q6 62 4 72 Q12 76 20 70 Z" fill="#e8dcc8"/>
      <circle cx="28" cy="56" r="5" fill="#20232a"/><circle cx="26.5" cy="54.5" r="1.6" fill="#fff"/>
      <path d="M10 68 L16 72 L10 74 Z" fill="#fff"/>
      <path d="M92 78 Q118 72 124 52 Q128 68 116 84 Q104 94 90 88 Z" fill="#b0521f"/>
      <path d="M116 60 Q122 54 124 52 Q126 60 122 66 Z" fill="#e8dcc8"/>
      <rect x="34" y="86" width="7" height="22" rx="3" fill="#b0521f"/>
      <rect x="72" y="86" width="7" height="22" rx="3" fill="#b0521f"/>
    </svg>`;
  }
  // tuftle — the gentle starter puffball
  return `<svg viewBox="0 0 110 110" width="100%" aria-hidden="true">
    <path d="M52 18 Q46 2 34 6 Q44 10 46 20 Z" fill="#4f9e6b"/>
    <path d="M56 18 Q62 4 74 8 Q64 12 60 20 Z" fill="#3f8a58"/>
    <circle cx="55" cy="62" r="40" fill="#5fb98a"/>
    <circle cx="55" cy="62" r="40" fill="none" stroke="#4f9e6b" stroke-width="5" stroke-dasharray="6 9"/>
    <circle cx="38" cy="54" r="6.5" fill="#20232a"/><circle cx="36" cy="52" r="2.4" fill="#fff"/>
    <path d="M28 74 Q38 82 48 76" stroke="#2e5c40" stroke-width="3.5" fill="none" stroke-linecap="round"/>
    <ellipse cx="30" cy="66" rx="5" ry="3.5" fill="rgba(255,150,150,0.55)"/>
    <rect x="36" y="98" width="10" height="10" rx="4" fill="#4f9e6b"/>
    <rect x="62" y="98" width="10" height="10" rx="4" fill="#4f9e6b"/>
  </svg>`;
}
