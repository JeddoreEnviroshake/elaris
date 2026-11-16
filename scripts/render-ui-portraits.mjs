import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from '@playwright/test';

// Run alongside the local Vite server. Portraits reuse the game's original sculpts.
const origin=process.argv[2]??'http://127.0.0.1:5173';
await mkdir('output/ui-portraits',{recursive:true});await mkdir('src/ui/assets',{recursive:true});
await writeFile('output/ui-portraits/render.html',`<!doctype html><meta charset="utf-8"><script type="module">
import * as THREE from '/node_modules/three/build/three.module.js';
import {createPlayerRig,createCreatureRig} from '/src/three/characterRigs.ts';
import {releaseArt} from '/src/three/quaterniusArt.ts';
const names=['player','tuftle','craghopper','glade-stag','snarlfox','masonmole','slingtail','bulwark-boar','quillfinch','mistmoth'];
const renderer=new THREE.WebGLRenderer({alpha:true,antialias:true,preserveDrawingBuffer:true});renderer.setSize(256,256);renderer.setClearColor(0,0);renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.04;
const scene=new THREE.Scene();scene.add(new THREE.HemisphereLight(0xe9f1dc,0x5c7760,2.1));
const sun=new THREE.DirectionalLight(0xffe4b8,3.0);sun.position.set(-3,5,5);scene.add(sun);
const rim=new THREE.DirectionalLight(0xc2eadf,1.3);rim.position.set(3,3,-4);scene.add(rim);
const atlas=document.createElement('canvas');atlas.width=1280;atlas.height=512;const context=atlas.getContext('2d');
for(let i=0;i<names.length;i++){
 const name=names[i],rig=name==='player'?createPlayerRig():createCreatureRig(name);
 if(name==='player')rig.setGatherTool('hands');rig.animate(0,'idle',true);rig.root.rotation.y=name==='player'?-.3:Math.PI-.3;
 scene.add(rig.root);rig.root.updateMatrixWorld(true);
 const box=new THREE.Box3();rig.root.traverse(part=>{if(!part.isMesh)return;let visible=true,ancestor=part;while(ancestor){if(!ancestor.visible)visible=false;ancestor=ancestor.parent;}if(visible)box.union(new THREE.Box3().setFromObject(part));});
 const center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3()),camera=new THREE.OrthographicCamera(-2,2,2,-2,.01,40);
 camera.position.copy(center).add(new THREE.Vector3(2.4,1.8,5));camera.lookAt(center);camera.updateMatrixWorld(true);
 const view=new THREE.Box3();for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z])view.expandByPoint(new THREE.Vector3(x,y,z).applyMatrix4(camera.matrixWorldInverse));
 const span=Math.max(view.max.x-view.min.x,view.max.y-view.min.y)*1.06;
 camera.left=-span/2;camera.right=span/2;camera.top=span/2;camera.bottom=-span/2;camera.updateProjectionMatrix();renderer.render(scene,camera);
 context.drawImage(renderer.domElement,(i%5)*256,Math.floor(i/5)*256);scene.remove(rig.root);releaseArt(rig.root);
}
window.__portraitAtlas=atlas.toDataURL('image/png').split(',')[1];renderer.dispose();
</script>`, 'utf8');
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`${origin}/output/ui-portraits/render.html`);await page.waitForFunction(()=>window.__portraitAtlas);
 if(errors.length)throw new Error(errors.join('\n'));
 await writeFile('src/ui/assets/portraits.png',Buffer.from(await page.evaluate(()=>window.__portraitAtlas),'base64'));
 console.log('Rendered ten original character portraits to src/ui/assets/portraits.png');
}finally{await browser.close();}
