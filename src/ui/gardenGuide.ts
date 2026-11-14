import { OPENING_NEXT_GOALS, type OpeningNextGoal } from '../content/onboarding';
import { GARDEN_BED_GROW_TICKS, GARDEN_BED_READY_CAP, GARDEN_BED_YIELD_FIBER } from '../config/balance';
import { openingGardenAvailable, openingGardenBuildRequest, openingGardenTarget, openingGardenView, openingNextGoal, OPENING_GOAL_LABELS } from '../simulation/openingGarden';
import { supplyRunRoute } from '../simulation/openingSupplyRun';
import { checkBuildBatch, type BuildRequest } from '../simulation/batchBuilding';
import type { ShelterSite } from '../simulation/openingShelter';
import type { GameState } from '../simulation/state';
import type { InventoryPanel } from './inventoryPanel';
import { div, uiButton } from './controls';

export class GardenGuide {
  private readonly panel = div({ color: '#e8f0ea', font: '14px system-ui,sans-serif', lineHeight: '1.45' });
  private signature = '';
  private section = '';
  private growthStatus: HTMLParagraphElement | null = null;
  private growthRules: HTMLParagraphElement | null = null;
  private harvestButton: HTMLButtonElement | null = null;
  private showFootprint = true;
  private waypoint: { tileX: number; tileY: number; label: string } | null = null;
  private routeCache: { key: string; path: Array<{ tileX: number; tileY: number }> | null } | null = null;
  constructor(private readonly state: GameState, private readonly actions: {
    onRegister: () => void; onPreview: (requests: BuildRequest[]) => void; onMove: (dx: number, dy: number) => void;
    onHarvest: () => void; onContinue: (goal: OpeningNextGoal | null) => void;
  }) { this.panel.setAttribute('aria-label', 'Garden and journey'); }
  attachToMenu(menu: InventoryPanel): void { menu.registerTab('garden', 'Garden', this.panel, () => { this.refresh(); this.panel.scrollTop = 0; }); }
  refresh(): void {
    const state = this.state; const chapter = state.onboarding; const garden = chapter.garden;
    const active = openingGardenAvailable(state); const view = openingGardenView(state);
    this.refreshGrowth(view);
    const geometry = state.buildings.map((building) => [building.id, building.tileX, building.tileY, building.boundaryEdge, building.rotated]);
    const tileX = Math.floor(state.player.x / 16); const tileY = Math.floor(state.player.y / 16);
    const key = JSON.stringify([active, garden, chapter.status, chapter.completedMilestoneIds, chapter.supplyRun?.blueprintDropId, state.currentArea.key,
      tileX, tileY, view.bed?.id, view.paper?.instanceId, view.stored?.id, view.known, view.canRegister, view.inReach,
      state.inventory, state.activeEncounter?.wildCreatureId, !!state.pendingRespawn, geometry, state.ownedCreatures.map((creature) => [creature.id, creature.name, creature.role]), Object.keys(state.visitedAreas), this.showFootprint]);
    if (key === this.signature) return;
    const scrollTop = this.panel.scrollTop;
    const section = `${active}|${view.known}|${view.bed?.id ?? ''}|${chapter.status}`;
    this.signature = key; this.panel.replaceChildren(); this.waypoint = null;
    this.growthStatus = null; this.growthRules = null; this.harvestButton = null;
    try {
    const heading = document.createElement('h2'); heading.textContent = chapter.status === 'complete' && active ? 'A home and a companion' : 'Room to grow'; this.panel.append(heading);
    if (!active || !garden) { this.paragraph('Bring home the Garden Bed discovery from the supply cart to begin this lesson.'); return; }
    if (chapter.status === 'complete') { this.renderRecap(); return; }
    this.paragraph(view.known ? 'Your Garden Bed recipe is permanent. Return to the paddock and turn the recovered materials into a renewable fiber supply.'
      : 'A discovery is a paper in your bag until you register it at a workbench. Registration keeps the recipe safe through drops and defeat.');
    const checklist = document.createElement('ul');
    for (const [id, label] of [['register-discovery', 'Register the Garden Bed discovery'], ['build-garden', 'Build a Garden Bed in Elaris'], ['harvest-garden', 'Collect the first garden harvest']] as const) {
      const done = chapter.completedMilestoneIds.includes(id); const row = document.createElement('li'); row.textContent = `${done ? '✓' : '○'} ${label}`; row.style.color = done ? '#b5edb5' : '#ffe4a6'; checklist.append(row);
    }
    this.panel.append(checklist);
    const target = openingGardenTarget(state);
    const routeCard = div({ padding: '10px', border: '1px solid #8cbbbd', borderRadius: '6px', background: '#243d3b' }); routeCard.setAttribute('aria-label', 'Garden journey directions');
    routeCard.textContent = state.currentArea.key !== '0,0' ? 'Return to Elaris to finish your home garden.'
      : !view.known ? chapter.supplyRun?.blueprintDropId ? 'Recover your dropped discovery paper before visiting a workbench.'
        : view.stored ? `Take the discovery paper from your storage at X ${view.stored.tileX}, Y ${view.stored.tileY}, then bring it to a workbench.`
          : target ? `Bring the Garden Bed paper to ${target.label} at X ${target.tileX}, Y ${target.tileY}. Register it here or from its Bag action card when nearby.`
            : 'The public workbench is unavailable. Build your own Workbench and register the paper nearby.'
        : target ? `Return to your garden at X ${target.tileX}, Y ${target.tileY}. The suggested bed leaves the paddock gate clear. Custom gardens in Elaris count equally.`
          : 'Choose a clear two-by-one spot in Elaris through Build. No existing structures or resources will be moved.';
    if (target) {
      const routeKey = JSON.stringify([target, geometry]);
      const cached = this.routeCache?.key === routeKey ? this.routeCache.path : null;
      const index = cached?.findIndex((point) => point.tileX === tileX && point.tileY === tileY) ?? -1;
      const blockedKey = `${routeKey}|${tileX},${tileY}`;
      const route = cached && index >= 0 ? cached.slice(index) : this.routeCache?.key === blockedKey ? null : supplyRunRoute(state, target);
      this.routeCache = { key: route ? routeKey : blockedKey, path: route };
      const line = document.createElement('p'); line.style.margin = '6px 0 0';
      if (route) { const next = route[Math.min(6, route.length - 1)]!; this.waypoint = { ...next, label: `To ${target.label}` }; line.textContent = `${route.length - 1} walking tiles remaining · Next marker X ${next.tileX}, Y ${next.tileY}.`; }
      else { this.waypoint = target; line.textContent = 'No clear walking route from here. Check doors, gates, and player-built obstructions.'; }
      routeCard.append(line);
    }
    this.panel.append(routeCard);
    if (!view.known) {
      const register = uiButton('Register Garden Bed discovery', this.actions.onRegister);
      register.disabled = !view.paper || !view.canRegister || !!state.activeEncounter || !!state.pendingRespawn; this.panel.append(register);
      return;
    }
    if (!view.bed) {
      const requests = openingGardenBuildRequest(state);
      this.paragraph(`Garden Bed: 4 wood + 2 fiber · Bag: ${state.inventory.wood} wood, ${state.inventory.fiber} fiber. The supply cart provided this construction cost; gather replacements if you spent or stored it.`);
      if (garden.bedId) this.paragraph('Your previous Garden Bed is gone. Rebuild anywhere clear in Elaris; the registered recipe and earned progress remain yours.');
      if (!garden.plan || garden.plan.areaKey !== state.currentArea.key) return;
      this.paragraph(`Suggested bed: X ${garden.plan.tileX}, Y ${garden.plan.tileY} · two tiles wide, one tile deep. Preview first, then confirm Build 1.`);
      const preview = uiButton('Preview Garden Bed', () => this.actions.onPreview(requests)); preview.disabled = !requests.length || !!state.activeEncounter || !!state.pendingRespawn; this.panel.append(preview);
      const check = requests.length ? checkBuildBatch(state, requests) : null;
      if (check && !check.ok) this.paragraph(check.message);
      const moves = div({ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '10px' });
      for (const [label, dx, dy] of [['Move garden north', 0, -1], ['Move garden west', -1, 0], ['Move garden east', 1, 0], ['Move garden south', 0, 1]] as const) moves.append(uiButton(label, () => this.actions.onMove(dx, dy)));
      moves.append(uiButton(this.showFootprint ? 'Hide garden footprint' : 'Show garden footprint', () => { this.showFootprint = !this.showFootprint; this.refresh(); })); this.panel.append(moves);
      return;
    }
    const growth = div({ padding: '12px', border: '1px solid #8ca776', borderRadius: '6px', background: '#283f35', marginTop: '12px' }); growth.setAttribute('aria-label', 'Garden growth and harvest');
    const status = document.createElement('p'); status.setAttribute('role', 'status'); this.growthStatus = status;
    const rules = document.createElement('p'); this.growthRules = rules;
    const harvest = uiButton('Collect garden fiber', this.actions.onHarvest); this.harvestButton = harvest;
    this.refreshGrowth(view);
    growth.append(status, rules, harvest);
    if (!view.inReach) { const reach = document.createElement('p'); reach.textContent = 'Walk beside the bed to collect its fiber.'; growth.append(reach); }
    this.panel.append(growth);
    this.paragraph('Your Tuftle can stay on Follow to help you gather, or Work at its Pen for separate fiber deliveries. The garden grows either way. Ordinary threats continue while you wait; use purified air during fog.');
    } finally {
      this.panel.scrollTop = this.section === section ? scrollTop : 0;
      this.section = section;
    }
  }
  /** Timer ticks update in place so scrolling, focus, and touch targets remain stable. */
  private refreshGrowth(view: ReturnType<typeof openingGardenView>): void {
    if (this.growthStatus) this.growthStatus.textContent = view.status;
    if (this.growthRules) this.growthRules.textContent = `${GARDEN_BED_YIELD_FIBER} fiber every ${GARDEN_BED_GROW_TICKS / 60} seconds · Stored ${view.readyFiber}/${GARDEN_BED_READY_CAP}. No creature assignment is needed. Full output pauses growth; collecting makes room without losing partial progress.`;
    if (this.harvestButton) this.harvestButton.disabled = view.readyFiber === 0 || !view.inReach || !!this.state.activeEncounter || !!this.state.pendingRespawn;
  }
  private paragraph(text: string): void { const p = document.createElement('p'); p.textContent = text; this.panel.append(p); }
  private renderRecap(): void {
    const state = this.state; const garden = state.onboarding.garden!;
    const companion = state.ownedCreatures.find((creature) => creature.id === state.onboarding.companionId);
    const recap = div({ padding: '12px', border: '1px solid #a4c980', borderRadius: '6px', background: '#283f35' }); recap.setAttribute('aria-label', 'First journey recap');
    const intro = document.createElement('p'); intro.textContent = 'You made a home, a partnership, and a reason to return. Your first chapter is complete.';
    const list = document.createElement('ul');
    const achievements = [`Befriended ${companion?.name ?? 'your Tuftle'} and gathered together.`, 'Built a shelter and weathered the first fog.',
      'Housed your Tuftle, collected its first delivery, and travelled together again.', 'Recovered the lost supplies and made the Garden Bed recipe permanent.', 'Built a garden and collected its first fiber harvest.'];
    if ((state.onboarding.supplyRun?.guardedDamage ?? 0) > 0) achievements.push(`Shell Guard prevented ${state.onboarding.supplyRun!.guardedDamage} damage during optional practice.`);
    for (const achievement of achievements) { const row = document.createElement('li'); row.textContent = achievement; list.append(row); }
    recap.append(intro, list); this.panel.append(recap);
    this.paragraph('Follow helps you gather on the road. Work supplies the Pen at home. The garden renews fiber independently. Your recipes and completed lessons stay saved.');
    const next = openingNextGoal(state);
    this.paragraph(next ? `Next direction: ${next.title}${next.complete ? ' · achieved' : ''}. ${next.objective}` : 'Choose what interests you next, or keep playing freely. You can change this direction here at any time.');
    const choices = div({ display: 'flex', flexWrap: 'wrap', gap: '8px' });
    for (const goal of OPENING_NEXT_GOALS) { const button = uiButton(OPENING_GOAL_LABELS[goal], () => this.actions.onContinue(goal)); button.setAttribute('aria-pressed', String(garden.nextGoal === goal)); choices.append(button); }
    choices.append(uiButton('Keep playing freely', () => this.actions.onContinue(null))); this.panel.append(choices);
  }
  get visibleWaypoint() { return this.waypoint; }
  get visibleSite(): ShelterSite | null { return this.showFootprint && openingGardenAvailable(this.state) && this.state.onboarding.status === 'active' && !openingGardenView(this.state).bed && this.state.onboarding.garden?.plan?.areaKey === this.state.currentArea.key ? this.state.onboarding.garden.plan : null; }
  destroy(): void { this.panel.remove(); }
}
