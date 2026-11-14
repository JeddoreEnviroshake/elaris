import { createInitialState } from '../../src/simulation/state';
import { actOpeningTrust, beginOpeningTrust } from '../../src/simulation/onboarding';
import { recordOpeningGatherAssistance } from '../../src/simulation/onboardingProgress';
import { reconcileOpeningShelter, shelterLayout } from '../../src/simulation/openingShelter';
import { advanceOpeningFog } from '../../src/simulation/openingFog';
import { paddockLayout, startOpeningWork, collectOpeningOutput, followOpeningCompanion } from '../../src/simulation/openingPaddock';
import { settleWorkerProduction } from '../../src/simulation/workerHousing';
import { placeBuildBatch } from '../../src/simulation/batchBuilding';
import { reconcileQuestProgress } from '../../src/simulation/progression';
import { claimAllBlueprintGrants } from '../../src/simulation/blueprintGrants';
import { recoverOpeningSupplies } from '../../src/simulation/openingSupplyRun';
import { elarisPublicWorkbenchCenterPx } from '../../src/simulation/elarisWorkbench';

/** A real prior-phase journey shared by simulation and browser acceptance checks. */
export function readySupplyRun(seed = 42) {
  const state = createInitialState(seed);
  state.player.x = 82 * 16; state.player.y = 82 * 16;
  beginOpeningTrust(state); for (let i = 0; i < 4; i++) actOpeningTrust(state, 'steady');
  recordOpeningGatherAssistance(state, state.onboarding.companionId!, 1); reconcileOpeningShelter(state);
  const home = state.onboarding.shelterPlan!;
  state.player.x = (home.tileX + 1.5) * 16; state.player.y = (home.tileY + 3) * 16;
  state.inventory.fiber = 300; state.inventory.wood = 300; state.inventory.stone = 100;
  for (const stage of shelterLayout(home)) if (!placeBuildBatch(state, stage).ok) throw new Error('Shelter fixture placement failed');
  state.player.y = (home.tileY + 1.5) * 16; reconcileQuestProgress(state);
  state.tick = state.onboarding.firstThreat!.fogStartsAtTick!;
  for (let i = 0; i < 60; i++) { advanceOpeningFog(state); state.tick++; }
  state.tick = state.onboarding.firstThreat!.fogEndsAtTick!; reconcileQuestProgress(state);
  state.onboarding.firstThreat!.aftermathAcknowledged = true;
  const plan = state.onboarding.production!.plan!;
  state.player.x = (plan.tileX + 2.5) * 16; state.player.y = (plan.tileY + 3) * 16;
  for (const stage of paddockLayout(plan)) if (!placeBuildBatch(state, stage).ok) throw new Error('Paddock fixture placement failed');
  reconcileQuestProgress(state); startOpeningWork(state); settleWorkerProduction(state, 15_000); collectOpeningOutput(state); followOpeningCompanion(state); reconcileQuestProgress(state);
  state.inventory.fiber = 20; state.inventory.wood = 10; state.inventory.stone = 0;
  state.claimedQuestRewardIds = [...state.completedQuestIds]; claimAllBlueprintGrants(state);
  return state;
}

/** A recovered, unregistered discovery at a real workbench. */
export function readyGarden(seed = 42) {
  const state = readySupplyRun(seed); const site = state.onboarding.supplyRun!.site!;
  state.player.x = (site.tileX + .5) * 16; state.player.y = (site.tileY + .5) * 16;
  if (!recoverOpeningSupplies(state).ok) throw new Error('Supply fixture recovery failed');
  const bench = elarisPublicWorkbenchCenterPx(); state.player.x = bench.x; state.player.y = bench.y;
  reconcileQuestProgress(state);
  state.claimedQuestRewardIds = [...state.completedQuestIds]; claimAllBlueprintGrants(state);
  return state;
}
