import { type Page } from '@playwright/test';
import { OrthographicCamera, Vector3 } from 'three';
import { ELARIS_CAMERA_DEFAULT_TENTHS, cameraOrientationFromTenths, elarisCameraOffset } from '../../src/three/cameraControls';
import { readSavedState } from './save';

/** Project actual world coordinates through the visible 3D camera. */
export async function worldPoint(page: Page, world: { x: number; y: number }, player?: { x: number; y: number }): Promise<{x:number;y:number}> {
  const actual = await page.evaluate(point => {
    const renderer = (globalThis as any).__renderer3d;
    if (!renderer) return null;
    renderer.camera.updateMatrixWorld();
    const projected = renderer.camera.position.clone().set(point.x / 16, 0, point.y / 16).project(renderer.camera);
    const bounds = document.querySelector('#elaris-three-canvas')!.getBoundingClientRect();
    return { x: bounds.left + (projected.x + 1) * bounds.width / 2, y: bounds.top + (1 - projected.y) * bounds.height / 2 };
  }, world);
  if (actual) return actual;
  // Production has no debug handles. Stationary fixtures can use the published
  // camera once its establishing reveal settles.
  const elapsed = await page.evaluate(() => performance.now());
  if (elapsed < 5000) await page.waitForTimeout(5000 - elapsed);
  const box = await page.locator('#elaris-three-canvas').boundingBox();
  if (!box) throw new Error('3D canvas is not visible');
  const saved = await readSavedState(page);
  const at = player ?? saved?.player;
  if (!at) throw new Error('No player position available');
  const viewHeight = Math.min(box.width, box.height) <= 480 ? 23 : Math.min(box.width, box.height) <= 900 ? 25 : 27;
  const aspect = box.width / box.height;
  const camera = new OrthographicCamera(-viewHeight * aspect / 2, viewHeight * aspect / 2, viewHeight / 2, -viewHeight / 2, .1, 160);
  const offset = elarisCameraOffset(cameraOrientationFromTenths(ELARIS_CAMERA_DEFAULT_TENTHS));
  camera.position.set(at.x / 16 + offset.x, offset.y, at.y / 16 + offset.z);
  camera.lookAt(at.x / 16, 0, at.y / 16);
  camera.updateMatrixWorld();
  const point = new Vector3(world.x / 16, 0, world.y / 16).project(camera);
  return { x: box.x + (point.x + 1) * box.width / 2, y: box.y + (1 - point.y) * box.height / 2 };
}

export async function tapWorld(page: Page, world: {x:number;y:number}, player?: {x:number;y:number}): Promise<void> {
  const point = await worldPoint(page, world, player);
  await page.mouse.click(point.x, point.y);
}

export async function tapCanvasCenter(page: Page): Promise<void> {
  const saved = await readSavedState(page);
  if (!saved) throw new Error('No saved player position available');
  await tapWorld(page, saved.player);
}
