import * as THREE from 'three';
import type { TownBuildingId } from '../content/townBuildings';

export const SETTLEMENT_ROOFS: Readonly<Record<TownBuildingId,number>> = {
  weaponsmith:0xb77b50,church:0x637f8e,market:0x748968,tavern:0x925b59,
  armoury:0x536b73,'magic-shop':0x79678c,farm:0xa38656,arena:0x8c7555,
};

/** Recolor tile pigment while retaining the authored wear, normals and timber. */
export function finishRoof(root: THREE.Object3D, hex: number): void {
  const hue=new THREE.Color(hex);
  const luminance=hue.r*.2126+hue.g*.7152+hue.b*.0722;
  hue.multiplyScalar(.95/Math.max(.01,luminance));
  const rgb=`vec3(${hue.r.toFixed(5)},${hue.g.toFixed(5)},${hue.b.toFixed(5)})`;
  root.traverse(child=>{
    if(!(child instanceof THREE.Mesh))return;
    for(const material of Array.isArray(child.material)?child.material:[child.material]){
      if(!(material instanceof THREE.MeshStandardMaterial)||!/RoundTiles/i.test(material.name))continue;
      material.onBeforeCompile=shader=>{
        shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`#include <map_fragment>
          float tileValue=dot(diffuseColor.rgb,vec3(.2126,.7152,.0722));
          diffuseColor.rgb=mix(diffuseColor.rgb,tileValue*${rgb},.94);`);
      };
      material.customProgramCacheKey=()=>`elaris-roof:${hex}`;material.needsUpdate=true;
    }
  });
}
