import { buildableById } from '../content/buildingParts';
import { shelterChecklist, shelterLayout, shelterMaterialBudget, SHELTER_STAGE_LABELS, type ShelterSite } from '../simulation/openingShelter';
import { batchCost, type BuildRequest } from '../simulation/batchBuilding';
import { effectiveBoundaryEdge } from '../simulation/buildingGeometry';
import type { GameState } from '../simulation/state';
import { stockedCostText } from './costs';
import { div, uiButton } from './controls';
import type { InventoryPanel } from './inventoryPanel';
import { openingFogGuidance } from '../simulation/openingFog';

export function remainingShelterStage(state: GameState, site: ShelterSite, index: number): BuildRequest[] {
  return (shelterLayout(site)[index] ?? []).filter((request) => !state.buildings.some((building) => {
    if (building.tileX !== request.tileX || building.tileY !== request.tileY) return false;
    const def = buildableById(building.definitionId); const wanted = buildableById(request.definitionId);
    if (wanted.layer === 'boundary') return def.layer === 'boundary' && effectiveBoundaryEdge(building) === request.boundaryEdge
      && (wanted.boundaryClass === 'wall' ? def.boundaryClass === 'wall' || def.boundaryClass === 'door' : def.boundaryClass === 'door');
    return wanted.layer === 'surface' ? def.surfaceKind === 'floor' : building.definitionId === request.definitionId;
  }));
}

export class ShelterGuide {
  private readonly panel = div({ color: '#e8f0ea', font: '14px system-ui,sans-serif', lineHeight: '1.45' });
  private signature = '';
  guideVisible = true;
  constructor(private readonly state: GameState, private readonly actions: {
    onPreview: (requests: BuildRequest[]) => void;
    onMove: (dx: number, dy: number) => void;
    onSupplies: () => void;
    onFogAcknowledged?: () => void;
  }) {
    this.panel.setAttribute('aria-label', 'Shelter checklist and layout');
  }
  attachToMenu(menu: InventoryPanel): void { menu.registerTab('shelter', 'Shelter', this.panel, () => { this.refresh(); this.panel.scrollTop = 0; }); }
  refresh(): void {
    const check = shelterChecklist(this.state);
    const chapter = this.state.onboarding;
    const site = chapter.shelterPlan;
    const fog = openingFogGuidance(this.state);
    const key = JSON.stringify([fog, check.area, check.floor, check.enclosed, check.entrance, check.purifier, check.storage, check.breathable, check.protectedHere, check.gaps, site, chapter.status, chapter.completedMilestoneIds, chapter.issuedRewardIds, this.state.inventory, this.state.currentArea.key, this.state.buildings.length, this.guideVisible]);
    if (key === this.signature) return;
    this.signature = key;
    this.panel.replaceChildren();
    if (fog) {
      const lesson = div({ padding: '10px', background: '#283f35', border: '1px solid #8ca776', borderRadius: '6px' });
      lesson.setAttribute('aria-label', 'First fog lesson');
      const title = document.createElement('h3'); title.textContent = fog.title; title.style.margin = '0 0 6px';
      const detail = document.createElement('p'); detail.textContent = fog.detail; detail.style.margin = '0';
      lesson.append(title, detail);
      if (fog.notice) lesson.append(uiButton('Continue', () => this.actions.onFogAcknowledged?.()));
      this.panel.append(lesson);
    }
    const heading = document.createElement('h2'); heading.textContent = 'A home together';
    const summary = document.createElement('p');
    summary.textContent = check.ready ? 'Shelter ready: a usable entrance, storage, and a breathable enclosed room.' : 'Build your own layout or use the optional four-by-two suggestion. Every part uses normal materials.';
    summary.setAttribute('role', 'status');
    this.panel.append(heading, summary);
    const list = document.createElement('ul');
    for (const [ok, text] of [[check.floor, `Eight floor tiles (${check.area}/8)`], [check.enclosed, 'Enclosed room'], [check.entrance, 'Usable entrance'], [check.purifier, 'Air Purifier inside'], [check.storage, 'Storage inside'], [check.breathable, 'Entire room protected']] as const) {
      const row = document.createElement('li'); row.textContent = `${ok ? '✓' : '○'} ${text}`; row.style.color = ok ? '#b5edb5' : '#ffe4a6'; list.append(row);
    }
    this.panel.append(list);
    const help = document.createElement('p');
    const gap = check.gaps[0];
    help.textContent = gap ? `Close the ${gap.edge} edge at X ${gap.tileX}, Y ${gap.tileY}${gap.reason === 'wrong-boundary' ? ' with a wall or door' : ''}.`
      : !check.floor ? 'Choose Floor area in Build to preview several tiles at once.'
        : !check.enclosed ? 'Enclose connected floors with a solid two-by-two block, using at most one room marker.'
        : !check.entrance ? 'Put a door on the perimeter and keep both sides clear.'
          : !check.purifier ? 'Place an Air Purifier on a floor tile inside the room.' : !check.storage ? 'Place a Storage Box inside the same room.' : '';
    this.panel.append(help);
    const air = document.createElement('p'); air.textContent = check.protectedHere ? 'You are protected here.' : 'You are outside purified air.'; air.setAttribute('role', 'status'); this.panel.append(air);
    if (check.ready) return;
    const budget = document.createElement('p'); budget.textContent = `Suggested home total: ${Object.entries(shelterMaterialBudget()).map(([id, amount]) => `${amount} ${id}`).join(' · ')}. A one-time bundle provides 16 fiber, 4 wood, and 2 stone; nearby plants supply the remaining fiber.`; this.panel.append(budget);
    const active = chapter.status === 'active' && chapter.completedMilestoneIds.includes('gather-together');
    const supplies = uiButton(chapter.issuedRewardIds.includes('shelter-supplies') ? 'Building supplies collected' : 'Collect building supplies', this.actions.onSupplies);
    supplies.disabled = !active || chapter.issuedRewardIds.includes('shelter-supplies');
    this.panel.append(supplies);
    if (!site) {
      const note = document.createElement('p'); note.textContent = active ? 'Return to Elaris to see a suggested clearing; a custom shelter anywhere counts.' : 'The optional footprint becomes available after gathering with your Tuftle. Your own shelter always counts.'; this.panel.append(note); return;
    }
    const position = document.createElement('p'); position.textContent = `Suggested footprint: ${site.areaKey} · X ${site.tileX}, Y ${site.tileY}. Walk close enough to build. Moving this guide never moves existing structures.`; this.panel.append(position);
    const moveRow = div({ display: 'flex', gap: '6px', flexWrap: 'wrap' });
    for (const [label, dx, dy] of [['Move north', 0, -1], ['Move west', -1, 0], ['Move east', 1, 0], ['Move south', 0, 1]] as const) {
      const button = uiButton(label, () => this.actions.onMove(dx, dy)); button.disabled = !active || site.areaKey !== this.state.currentArea.key; moveRow.append(button);
    }
    const toggle = uiButton(this.guideVisible ? 'Hide footprint' : 'Show footprint', () => { this.guideVisible = !this.guideVisible; this.refresh(); });
    moveRow.append(toggle); this.panel.append(moveRow);
    const stages = div({ display: 'grid', gap: '8px', marginTop: '12px' });
    for (const [index, label] of SHELTER_STAGE_LABELS.entries()) {
      const requests = remainingShelterStage(this.state, site, index);
      const button = uiButton(requests.length ? `Preview ${label} · ${stockedCostText(this.state, batchCost(requests))}` : `${label} placed`, () => this.actions.onPreview(requests));
      button.setAttribute('aria-label', `Preview ${label}`);
      button.disabled = !active || !requests.length || site.areaKey !== this.state.currentArea.key;
      stages.append(button);
    }
    this.panel.append(stages);
  }
  get visibleSite(): ShelterSite | null {
    const chapter = this.state.onboarding;
    return this.guideVisible && chapter.status === 'active' && chapter.completedMilestoneIds.includes('gather-together')
      && !chapter.completedMilestoneIds.includes('build-shelter')
      && chapter.shelterPlan?.areaKey === this.state.currentArea.key ? chapter.shelterPlan : null;
  }
  destroy(): void { this.panel.remove(); }
}
