import { producerForSpecies } from '../content/producers';
import { PADDOCK_STAGES, paddockMaterialBudget, paddockView, remainingPaddockStage } from '../simulation/openingPaddock';
import { batchCost, type BuildRequest } from '../simulation/batchBuilding';
import type { GameState } from '../simulation/state';
import type { ShelterSite } from '../simulation/openingShelter';
import type { InventoryPanel } from './inventoryPanel';
import { div, uiButton } from './controls';
import { stockedCostText } from './costs';

export class PaddockGuide {
  private readonly panel = div({ color: '#e8f0ea', font: '14px system-ui,sans-serif', lineHeight: '1.45' });
  private signature = '';
  private showFootprint = true;
  constructor(private readonly state: GameState, private readonly actions: {
    onPreview: (requests: BuildRequest[]) => void; onMove: (dx: number, dy: number) => void;
    onSupplies: () => void; onWork: () => void; onCollect: () => void; onFollow: () => void;
  }) { this.panel.setAttribute('aria-label', 'Paddock and Tuftle assignment'); }
  attachToMenu(menu: InventoryPanel): void { menu.registerTab('paddock', 'Paddock', this.panel, () => { this.refresh(); this.panel.scrollTop = 0; }); }
  refresh(): void {
    const chapter = this.state.onboarding; const production = chapter.production; const view = paddockView(this.state);
    const active = chapter.status !== 'legacy' && chapter.completedMilestoneIds.includes('weather-fog');
    const plan = production?.plan;
    const key = JSON.stringify([active, chapter.status, chapter.completedMilestoneIds, chapter.issuedRewardIds, production, view.status, view.creature?.name,
      view.creature?.role, view.creature?.housingId, view.housing?.id, view.capacity, view.area, view.bin, view.inReach, view.nextDeliverySeconds,
      this.state.inventory, this.state.currentArea.key, this.state.buildings, this.showFootprint]);
    if (key === this.signature) return;
    this.signature = key; this.panel.replaceChildren();
    const heading = document.createElement('h2'); heading.textContent = 'A place to work'; this.panel.append(heading);
    const intro = document.createElement('p');
    intro.textContent = !active ? 'Weather the first fog to unlock the paddock lesson. Existing housing and work remain available in Creatures.'
      : chapter.completedMilestoneIds.includes('return-to-follow') ? 'Ready to travel together. Your Tuftle’s housing is reserved, and its stored output stays safe. Open Supply Run to find the lost cart on Elaris’s west road.'
        : 'Give your Tuftle a home job, collect its first delivery, then choose Follow again. Work makes fiber at home; Follow helps you gather while travelling.';
    this.panel.append(intro);
    const checklist = document.createElement('ul');
    for (const [ok, label] of [[view.ready, `Qualifying work yard and housing (${view.area}/8 ground tiles)`],
      [chapter.completedMilestoneIds.includes('collect-production'), `Collected your Tuftle’s first output (${view.collectedFiber}/2 fiber)`],
      [chapter.completedMilestoneIds.includes('return-to-follow'), 'Follow chosen for the next adventure']] as const) {
      const row = document.createElement('li'); row.textContent = `${ok ? '✓' : '○'} ${label}`; row.style.color = ok ? '#b5edb5' : '#ffe4a6'; checklist.append(row);
    }
    this.panel.append(checklist);
    const card = div({ padding: '12px', border: '1px solid #8ca776', borderRadius: '6px', background: '#283f35' });
    card.setAttribute('aria-label', 'Tuftle assignment');
    const title = document.createElement('h3'); title.textContent = view.creature?.name ?? 'Your Tuftle'; title.style.margin = '0 0 6px';
    const status = document.createElement('p'); status.textContent = view.status; status.setAttribute('role', 'status');
    const housing = document.createElement('p'); housing.textContent = view.housing
      ? `Housing: ${view.housing.definitionId === 'barn' ? 'Barn' : 'Small Pen'} · ${view.capacity?.assigned ?? 0}/${view.capacity?.capacity ?? 0} slots reserved · X ${view.housing.tileX}, Y ${view.housing.tileY}`
      : 'Housing: build a Small Pen fully inside the enclosed ground cover.';
    const producer = producerForSpecies('tuftle')!;
    const output = document.createElement('p'); output.textContent = `Output: ${producer.outputPerCycle.fiber} fiber every ${producer.cycleMs / 1000} seconds · Bin ${view.bin}/${view.binCapacity}${view.working && !view.full ? ` · Next delivery in ${view.nextDeliverySeconds}s` : ''}`;
    for (const paragraph of [status, housing, output]) paragraph.style.margin = '6px 0';
    const buttons = div({ display: 'flex', flexWrap: 'wrap', gap: '8px' });
    buttons.style.marginTop = '8px';
    const work = uiButton(view.working ? 'Tuftle is working' : 'House Tuftle and start Work', this.actions.onWork);
    work.disabled = !active || !view.creature || !view.canReserve || view.away || view.working;
    const collect = uiButton(`Collect ${view.bin} fiber`, this.actions.onCollect);
    collect.setAttribute('aria-label', 'Collect Pen fiber'); collect.disabled = !active || view.bin === 0 || !view.inReach;
    const follow = uiButton('Bring Tuftle along · Follow', this.actions.onFollow);
    follow.disabled = !active || !view.creature || view.away || view.creature.role === 'follow';
    if (chapter.completedMilestoneIds.includes('collect-production')) buttons.append(follow, work, collect);
    else buttons.append(work, collect, follow);
    card.append(title, status, housing, output, buttons);
    if (view.bin > 0 && !view.inReach) { const near = document.createElement('p'); near.textContent = 'Walk near this Pen to collect its output.'; card.append(near); }
    this.panel.append(card);
    if (!active || view.ready && chapter.completedMilestoneIds.includes('build-paddock')) return;
    const budget = document.createElement('p'); budget.textContent = `Suggested eight-tile paddock: ${Object.entries(paddockMaterialBudget()).map(([id, amount]) => `${amount} ${id}`).join(' · ')}. The left half holds the Pen; leave the right half free for a future Garden Bed and a clear gate. Custom qualifying yards count equally.`;
    this.panel.append(budget);
    const supplies = uiButton(chapter.issuedRewardIds.includes('paddock-supplies') ? 'Paddock supplies collected' : 'Collect paddock supplies', this.actions.onSupplies);
    supplies.disabled = chapter.issuedRewardIds.includes('paddock-supplies') || chapter.status !== 'active'; this.panel.append(supplies);
    if (!plan) { const help = document.createElement('p'); help.textContent = 'Return to Elaris for a suggested clearing, or build a custom yard here.'; this.panel.append(help); return; }
    const position = document.createElement('p'); position.textContent = `Suggested paddock: ${plan.areaKey} · X ${plan.tileX}, Y ${plan.tileY}. Walk nearby to build. Moving the footprint never moves existing structures.`; this.panel.append(position);
    const controls = div({ display: 'flex', gap: '6px', flexWrap: 'wrap' });
    for (const [label, dx, dy] of [['Move north', 0, -1], ['Move west', -1, 0], ['Move east', 1, 0], ['Move south', 0, 1]] as const) {
      const button = uiButton(label, () => this.actions.onMove(dx, dy)); button.disabled = plan.areaKey !== this.state.currentArea.key; controls.append(button);
    }
    controls.append(uiButton(this.showFootprint ? 'Hide paddock footprint' : 'Show paddock footprint', () => { this.showFootprint = !this.showFootprint; this.refresh(); }));
    this.panel.append(controls);
    const stages = div({ display: 'grid', gap: '8px', marginTop: '12px' });
    for (const [index, label] of PADDOCK_STAGES.entries()) {
      const requests = remainingPaddockStage(this.state, plan, index);
      const button = uiButton(requests.length ? `Preview ${label} · ${stockedCostText(this.state, batchCost(requests))}` : `${label} placed`, () => this.actions.onPreview(requests));
      button.setAttribute('aria-label', `Preview paddock ${label}`); button.disabled = !requests.length || plan.areaKey !== this.state.currentArea.key; stages.append(button);
    }
    this.panel.append(stages);
  }
  get visibleSite(): ShelterSite | null {
    const chapter = this.state.onboarding; const plan = chapter.production?.plan;
    return this.showFootprint && chapter.status === 'active' && chapter.completedMilestoneIds.includes('weather-fog')
      && !chapter.completedMilestoneIds.includes('build-paddock') && plan?.areaKey === this.state.currentArea.key ? plan : null;
  }
  destroy(): void { this.panel.remove(); }
}
