import {expect,test} from '@playwright/test';
import {openApp,waitForDebugHandles} from './app';

for(const viewport of [{name:'desktop',width:1440,height:1000},{name:'phone',width:390,height:844},{name:'landscape',width:844,height:390}]){
  test(`journal fits ${viewport.name} and keeps every section reachable`,async({page})=>{
    const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    await page.setViewportSize(viewport);await openApp(page,'render=3d');await waitForDebugHandles(page);
    await page.getByRole('button',{name:'Menu',exact:true}).click();
    const menu=page.getByRole('dialog',{name:'Game menu',exact:true});await expect(menu).toBeVisible();
    await expect(page.getByRole('button',{name:'Admin',exact:true})).toBeHidden();
    const rect=await menu.boundingBox();expect(rect!.x).toBeGreaterThanOrEqual(0);expect(rect!.y).toBeGreaterThanOrEqual(0);
    expect(rect!.x+rect!.width).toBeLessThanOrEqual(viewport.width);expect(rect!.y+rect!.height).toBeLessThanOrEqual(viewport.height);
    for(const name of ['Bag','Craft','Blueprints','Quests','Creatures','Character']){
      const tab=menu.getByRole('tab',{name,exact:true});await tab.click();await expect(tab).toHaveAttribute('aria-selected','true');
      const content=page.locator(`#${await tab.getAttribute('aria-controls')}`);await expect(content).toBeVisible();
      expect(await content.evaluate(element=>element.scrollWidth<=element.clientWidth+1)).toBe(true);
    }
    await menu.getByRole('button',{name:'Close',exact:true}).click();await expect(menu).toBeHidden();
    await expect(page.getByRole('button',{name:'Menu',exact:true})).toBeFocused();expect(errors).toEqual([]);
  });
}

test('journal keyboard navigation, focus containment, and item cards remain usable',async({page})=>{
  await openApp(page,'render=3d');await waitForDebugHandles(page);
  await page.getByRole('button',{name:'Menu',exact:true}).click();
  const menu=page.getByRole('dialog',{name:'Game menu',exact:true});
  await expect(menu.getByRole('tab',{name:'Bag',exact:true})).toBeFocused();
  await page.keyboard.press('ArrowDown');await expect(menu.getByRole('tab',{name:'Craft',exact:true})).toBeFocused();
  await page.keyboard.press('Home');await expect(menu.getByRole('tab',{name:'Bag',exact:true})).toBeFocused();
  await menu.locator('.elaris-inventory-slot[data-item-kind=resource]').first().click();
  const card=menu.locator('.elaris-item-backdrop');await expect(card).toBeVisible();
  const last=card.getByRole('button',{name:'Cancel',exact:true});await last.focus();await page.keyboard.press('Tab');
  await expect(card.getByRole('button').first()).toBeFocused();
  await page.keyboard.press('Escape');await expect(card).toBeHidden();await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');await expect(menu).toBeHidden();
});

test('portraits load locally and reduced-motion navigation stays still',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce',contrast:'more'});await openApp(page,'render=3d');await waitForDebugHandles(page);
  await page.getByRole('button',{name:'Menu',exact:true}).click();
  const menu=page.getByRole('dialog',{name:'Game menu',exact:true});await menu.getByRole('tab',{name:'Character',exact:true}).click();
  const portrait=menu.locator('.elaris-portrait');await expect(portrait).toBeVisible();
  const image=await portrait.evaluate(async element=>{
    const url=getComputedStyle(element).backgroundImage.match(/url\("?([^"\)]+)/)![1]!;
    const bitmap=new Image();bitmap.src=url;await bitmap.decode();return {width:bitmap.naturalWidth,height:bitmap.naturalHeight};
  });
  expect(image).toEqual({width:1280,height:512});
  const duration=await menu.getByRole('tab',{name:'Character',exact:true}).evaluate(element=>getComputedStyle(element).transitionDuration);
  expect(duration.split(',').every(value=>parseFloat(value)<=.001)).toBe(true);
});

test('journal clears the side cutout on a landscape phone',async({page})=>{
  await page.setViewportSize({width:844,height:390});await openApp(page,'render=3d');await waitForDebugHandles(page);
  await page.evaluate(()=>document.documentElement.style.setProperty('--ui-safe-left','44px'));
  await page.getByRole('button',{name:'Menu',exact:true}).click();
  const menu=page.getByRole('dialog',{name:'Game menu',exact:true}),rect=await menu.boundingBox();
  expect(rect!.x).toBeGreaterThanOrEqual(44);expect(rect!.x+rect!.width).toBeLessThanOrEqual(844);
  await menu.getByRole('button',{name:'Close',exact:true}).click();await expect(menu).toBeHidden();
});
