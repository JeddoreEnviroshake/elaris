import { expect, test } from '@playwright/test';
import { createInitialState } from '../../src/simulation/state';
import { storageBoxContents } from '../../src/simulation/storageBox';
import { createOpeningChapter } from '../../src/content/onboarding';
import { openApp, waitForDebugHandles } from './app';

test('existing equipment, inventory, storage and companions survive a 2D preference upgrade', async ({ page }) => {
  await openApp(page, 'render=2d');
  await waitForDebugHandles(page);
  const fixture = createInitialState(42);
  fixture.onboarding = createOpeningChapter(42, true);
  fixture.inventory.wood = 17;
  fixture.inventory.fiber = 23;
  fixture.tools.push({instanceId:'preserved-axe',definitionId:'wooden-axe',durability:7,maxDurability:30,powerRank:0,speedRank:0,durabilityRank:0});
  fixture.equippedToolId = 'preserved-axe';
  fixture.buildings.push({id:'preserved-storage',definitionId:'field-cache',tileX:81,tileY:81,storage:{...fixture.inventory,wood:12}});
  storageBoxContents(fixture.buildings.at(-1)!);
  fixture.ownedCreatures.push({id:'preserved-tuftle',speciesId:'tuftle',name:'Moss',role:'follow',assignment:null,worksiteId:null,nextWorkTick:0,bondXp:0,selectedBattleAbilityId:'tuftle-guard'});
  await page.evaluate(async state => {
    const debug = globalThis as any;
    const scene = debug.__game.scene.getScene('world');
    Object.assign(scene.state,state);
    scene.snapRenderPoseToState();
    await debug.__controller.saveCritical();
    await debug.__controller.flushAndRelease();
    localStorage.setItem('elaris.presentation-mode','2d');
  },fixture);
  await page.reload();
  await waitForDebugHandles(page);
  await expect(page.locator('#elaris-three-canvas')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-presentation','3d');
  const retained = await page.evaluate(() => {
    const state = (globalThis as any).__game.scene.getScene('world').state;
    return {wood:state.inventory.wood,fiber:state.inventory.fiber,tool:state.tools.find((tool:any)=>tool.instanceId==='preserved-axe'),equipped:state.equippedToolId,storage:state.buildings.find((building:any)=>building.id==='preserved-storage')?.storage.wood,companion:state.ownedCreatures.find((creature:any)=>creature.id==='preserved-tuftle')?.name};
  });
  expect(retained).toMatchObject({wood:17,fiber:23,tool:{instanceId:'preserved-axe',durability:7},equipped:'preserved-axe',storage:12,companion:'Moss'});
});

