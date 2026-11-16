import { supplyRunAvailable, supplyRunInReach, supplyRunRoute, supplyRunTarget, SUPPLY_RUN_ROAD } from '../simulation/openingSupplyRun';
import { knowsBlueprint } from '../simulation/blueprintKnowledge';
import { isElarisPublicWorkbenchServing, withinElarisPublicWorkbench } from '../simulation/elarisWorkbench';
import { FACILITY_INTERACTION_RANGE_PX } from '../simulation/gameplayCommands';
import type { GameState } from '../simulation/state';
import type { InventoryPanel } from './inventoryPanel';
import { div, uiButton } from './controls';

export class SupplyRunGuide {
  private readonly panel = div({ color: '#e8f0ea', font: '14px system-ui,sans-serif', lineHeight: '1.4' });
  private signature = '';
  private routeCache: { key: string; path: Array<{ tileX: number; tileY: number }> } | null = null;
  private waypoint: { tileX: number; tileY: number; label: string } | null = null;
  constructor(private readonly state: GameState, private readonly actions: {
    onRecover: () => void; onClaim: () => void; onSideCache: () => void;
  }) { this.panel.setAttribute('aria-label', 'Supply run directions and discovery'); }
  attachToMenu(menu: InventoryPanel): void { menu.registerTab('supply-run', 'Supply Run', this.panel, () => { this.refresh(); this.panel.scrollTop = 0; }); }
  refresh(): void {
    const state = this.state; const run = state.onboarding.supplyRun; const active = supplyRunAvailable(state);
    const companion = state.ownedCreatures.find((creature) => creature.id === state.onboarding.companionId);
    const tileX = Math.floor(state.player.x / 16); const tileY = Math.floor(state.player.y / 16);
    const known = knowsBlueprint(state, 'garden-bed');
    const atCart = supplyRunInReach(state); const atSide = supplyRunInReach(state, true); const atBench = withinElarisPublicWorkbench(state, FACILITY_INTERACTION_RANGE_PX);
    const key = JSON.stringify([active, run, tileX, tileY, state.currentArea.key, state.buildings.length, state.inventory, state.carriedBlueprints,
      companion?.role, companion?.name, state.expeditions.length, known, atCart, atSide, atBench]);
    if (key === this.signature) return;
    this.signature = key; this.panel.replaceChildren(); this.waypoint = null;
    const heading = document.createElement('h2'); heading.textContent = 'The lost supply cart'; this.panel.append(heading);
    if (!active || !run) { const note = document.createElement('p'); note.textContent = 'Complete the paddock lesson and bring your Tuftle back to Follow to begin this nearby supply run.'; this.panel.append(note); return; }
    const intro = document.createElement('p'); intro.textContent = run.suppliesRecovered
      ? run.blueprintClaimed ? known ? 'You know the Garden Bed recipe. Open Garden to build, harvest, and review your journey.' : 'Discovery recovered. Open Garden for the return trip, workbench registration, and your first harvest. Keep the paper safe until then.'
        : 'Supplies recovered. Your guaranteed Garden Bed blueprint is waiting safely; make one free bag space and collect it at the cart or Elaris public workbench.'
      : 'A supply cart was lost along Elaris’s west road. Recover its cargo together. Optional guard practice teaches arena combat; winning is never required to recover the supplies.';
    this.panel.append(intro);
    const list = document.createElement('ul');
    for (const [done, text] of [[run.discovered, 'Find the supply cart'], [run.suppliesRecovered, 'Recover the building supplies'], [run.blueprintClaimed, 'Collect the Garden Bed discovery']] as const) {
      const row = document.createElement('li'); row.textContent = `${done ? '✓' : '○'} ${text}`; row.style.color = done ? '#b5edb5' : '#ffe4a6'; list.append(row);
    }
    this.panel.append(list);
    const directions = div({ padding: '10px', border: '1px solid #8cbbbd', borderRadius: '6px', background: '#243d3b' });
    directions.setAttribute('aria-label', 'Supply run route');
    const target = supplyRunTarget(state);
    const routeKey = target ? `${state.currentArea.key}|${target.tileX},${target.tileY}|${state.buildings.length}` : '';
    const cached = this.routeCache?.key === routeKey ? this.routeCache.path : null;
    const index = cached?.findIndex((point) => point.tileX === tileX && point.tileY === tileY) ?? -1;
    const route = cached && index >= 0 ? cached.slice(index) : target ? supplyRunRoute(state, target) : null;
    if (route && target) this.routeCache = { key: routeKey, path: route };
    const road = run.site ? `Join the west road at X ${SUPPLY_RUN_ROAD.tileX}, Y ${SUPPLY_RUN_ROAD.tileY}; follow it west to the cart at X ${run.site.tileX}, Y ${run.site.tileY}.` : 'Return to Elaris to locate a clear cart site.';
    directions.textContent = state.currentArea.key !== '0,0' ? 'Return to Elaris. This supply run stays inside the starter region.'
      : run.blueprintDropId && target ? `Recover your discovery paper at X ${target.tileX}, Y ${target.tileY}. It will remain there for you.`
        : run.blueprintClaimed && known ? 'Supply run complete. The Garden Bed recipe is yours to keep.'
        : run.suppliesRecovered ? isElarisPublicWorkbenchServing(state) ? 'Return east along the road, through Elaris’s west gate, to the public workbench at X 84, Y 83. Bring the paper there to register it.'
        : 'The public workbench is in ruins. Register at your own Workbench instead.' : road;
    if (route) {
      const next = route[Math.min(6, route.length - 1)]!;
      this.waypoint = { ...next, label: route.length > 1 ? `To ${target!.label}` : target!.label };
      const steps = document.createElement('p'); steps.style.margin = '6px 0 0'; steps.textContent = `${route.length - 1} walking tiles remaining · Next marker X ${next.tileX}, Y ${next.tileY}.`; directions.append(steps);
    } else if (target && state.currentArea.key === '0,0') {
      const blocked = document.createElement('p'); blocked.textContent = 'No clear walking route from here. Check your doors, gates, and player-built obstructions; no property will be moved.'; directions.append(blocked);
      this.waypoint = target;
    }
    if (run.site) { const optional = document.createElement('p'); optional.style.margin = '6px 0 0'; optional.textContent = `Optional roadside log: X ${run.site.tileX - 4}, Y ${run.site.tileY} · three berries and a Cloth Mask.`; directions.append(optional); }
    this.panel.append(directions);
    const actions = div({ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '10px' });
    const recover = uiButton('Recover lost supplies', this.actions.onRecover); recover.disabled = run.suppliesRecovered || !supplyRunInReach(state) || !!state.pendingRespawn;
    const claim = uiButton(run.blueprintClaimed ? 'Discovery collected' : 'Collect Garden Bed blueprint', this.actions.onClaim);
    claim.disabled = !run.suppliesRecovered || run.blueprintClaimed || !atCart && !atBench || !!state.pendingRespawn;
    const cache = uiButton(run.sideCacheOpened ? 'Roadside log opened' : 'Open roadside log', this.actions.onSideCache); cache.disabled = run.sideCacheOpened || !supplyRunInReach(state, true);
    actions.append(run.suppliesRecovered ? claim : recover, cache); this.panel.append(actions);
    if (run.blueprintDropId) { const note = document.createElement('p'); note.textContent = 'Your discovery paper is on the ground where you dropped it or were defeated. It will remain there for recovery.'; this.panel.append(note); }
  }
  get visibleWaypoint() { return this.waypoint; }
  destroy(): void { this.panel.remove(); }
}
