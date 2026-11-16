import {afterEach,describe,it,expect,vi} from 'vitest';
import {InventoryPanel} from '../../src/ui/inventoryPanel';
import {createInitialState} from '../../src/simulation/state';

let menu:InventoryPanel|undefined;
afterEach(()=>{menu?.destroy();menu=undefined;document.body.replaceChildren();});
function journal(state=createInitialState(17)):InventoryPanel{
  const noop=():void=>{};
  menu=new InventoryPanel(document.body,state,{onEquipTool:noop,onRepairTool:noop,onDropTool:noop,onSplitStack:noop,onDropStack:noop,onOpened:noop});
  menu.registerTab('craft','Craft',document.createElement('section'));
  menu.registerTab('quests','Quests',document.createElement('section'));
  return menu;
}
describe('field journal navigation',()=>{
  it('connects each tab to its labelled panel and keeps a single tab in the keyboard sequence',()=>{
    const panel=journal();panel.openTab('bag');
    const tabs=Array.from(document.querySelectorAll<HTMLButtonElement>('[role=tab]'));
    for(const tab of tabs){
      const view=document.getElementById(tab.getAttribute('aria-controls')!);
      expect(view?.getAttribute('aria-labelledby')).toBe(tab.id);expect(view?.getAttribute('role')).toBe('tabpanel');
    }
    expect(tabs.filter(tab=>tab.tabIndex===0)).toHaveLength(1);
    expect(document.activeElement).toBe(tabs[0]);expect(document.documentElement.classList.contains('elaris-journal-open')).toBe(true);
  });
  it('navigates with arrows and Home/End without moving focus out of the journal',()=>{
    const panel=journal();panel.openTab('bag');
    const key=(value:string):void=>{document.activeElement!.dispatchEvent(new KeyboardEvent('keydown',{key:value,bubbles:true,cancelable:true}));};
    key('ArrowDown');expect(document.activeElement?.getAttribute('data-menu-tab')).toBe('craft');
    key('End');expect(document.activeElement?.getAttribute('data-menu-tab')).toBe('quests');
    key('Home');expect(document.activeElement?.getAttribute('data-menu-tab')).toBe('bag');
    expect(document.querySelectorAll('[role=tab][aria-selected=true]')).toHaveLength(1);
  });
  it('closes item actions before the journal and restores focus to Menu when dismissed',()=>{
    const panel=journal();panel.openTab('bag');
    document.querySelector<HTMLButtonElement>('.elaris-inventory-slot[data-item-kind=resource]')!.click();
    const action=document.querySelector<HTMLElement>('.elaris-item-backdrop')!;
    action.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
    expect(document.querySelector('.elaris-item-backdrop')).toBeNull();expect(panel.open).toBe(true);
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
    expect(panel.open).toBe(false);expect(document.activeElement?.getAttribute('aria-label')).toBe('Menu');
    expect(document.documentElement.classList.contains('elaris-journal-open')).toBe(false);
  });
  it('removes its resize listener and open-state styling when destroyed',()=>{
    const panel=journal(),remove=vi.spyOn(window,'removeEventListener');panel.openTab('bag');panel.destroy();
    expect(remove).toHaveBeenCalledWith('resize',expect.any(Function));
    expect(document.documentElement.classList.contains('elaris-journal-open')).toBe(false);remove.mockRestore();
  });
  it('retains focused inventory cells across unchanged HUD refreshes and updates changed stock',()=>{
    const state=createInitialState(17),panel=journal(state);panel.openTab('bag');
    const cell=document.querySelector<HTMLButtonElement>('[aria-label="Berry stack, 2"]')!;cell.focus();panel.refresh();panel.refresh();
    expect(document.activeElement).toBe(cell);expect(cell.isConnected).toBe(true);
    state.inventory.berry=3;panel.refresh();expect(document.querySelector('[aria-label="Berry stack, 3"]')).not.toBeNull();
  });
  it('focuses an available action when a one-item stack cannot be split',()=>{
    const state=createInitialState(17);state.inventory.berry=1;state.inventoryStacks.berry=[1];
    journal(state).openTab('bag');document.querySelector<HTMLButtonElement>('[aria-label="Berry stack, 1"]')!.click();
    expect(document.activeElement?.textContent).toBe('Drop');expect((document.activeElement as HTMLButtonElement).disabled).toBe(false);
  });
});
