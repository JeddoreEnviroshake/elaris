import * as THREE from 'three';

/** Two soft hinges retain the painted, merged limb and its single draw call. */
export class SoftJoints {
  readonly angles = new THREE.Vector2();
  readonly hinges: THREE.Vector2;
  readonly softness = new THREE.Vector2(.045, .025);

  constructor(mesh: THREE.Mesh, upperHinge: number, lowerHinge = -100, private readonly coordinate:'y'|'z'='y') {
    this.hinges = new THREE.Vector2(upperHinge, lowerHinge);
    mesh.geometry.computeBoundingSphere();
    mesh.geometry.boundingSphere!.radius+=.18;
    const material = mesh.material as THREE.Material;
    this.install(material);
    mesh.customDepthMaterial = new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking,side:THREE.DoubleSide});
    mesh.customDistanceMaterial = new THREE.MeshDistanceMaterial({side:THREE.DoubleSide});
    this.install(mesh.customDepthMaterial);
    this.install(mesh.customDistanceMaterial);
    mesh.userData.softJoints = this;
  }

  private install(material: THREE.Material): void {
    material.onBeforeCompile = shader => {
      shader.uniforms.uFlexAngles = {value:this.angles};
      shader.uniforms.uFlexHinges = {value:this.hinges};
      shader.uniforms.uFlexSoftness = {value:this.softness};
      const pivot=(hinge:string):string=>this.coordinate==='y'?`vec3(0.,${hinge},0.)`:`vec3(0.,0.,${hinge})`;
      shader.vertexShader = `
        uniform vec2 uFlexAngles, uFlexHinges, uFlexSoftness;
        vec3 flexRotate(vec3 p, float a) {
          float c=cos(a), s=sin(a); return vec3(p.x,c*p.y-s*p.z,s*p.y+c*p.z);
        }
        vec2 flexWeights(float y) {
          return 1.-smoothstep(uFlexHinges-uFlexSoftness,uFlexHinges+uFlexSoftness,vec2(y));
        }
        vec3 flexPosition(vec3 p) {
          vec2 w=flexWeights(p.${this.coordinate});
          p=mix(p,flexRotate(p-${pivot('uFlexHinges.y')},uFlexAngles.y)+${pivot('uFlexHinges.y')},w.y);
          return mix(p,flexRotate(p-${pivot('uFlexHinges.x')},uFlexAngles.x)+${pivot('uFlexHinges.x')},w.x);
        }
        ${shader.vertexShader}`
        .replace('#include <begin_vertex>','#include <begin_vertex>\ntransformed=flexPosition(transformed);')
        .replace('#include <beginnormal_vertex>',`#include <beginnormal_vertex>
          vec2 fw=flexWeights(position.${this.coordinate});
          objectNormal=flexRotate(flexRotate(objectNormal,uFlexAngles.y*fw.y),uFlexAngles.x*fw.x);`);
    };
    material.customProgramCacheKey = () => `elaris-soft-joints-v1:${this.coordinate}`;
    material.needsUpdate = true;
  }

  /** CPU equivalent for foot-contact checks and conservative pose inspection. */
  transformPoint(point: THREE.Vector3): THREE.Vector3 {
    const coordinate=point[this.coordinate];
    for(const index of [1,0] as const) {
      const hinge=this.hinges.getComponent(index),band=this.softness.getComponent(index);
      const weight=1-THREE.MathUtils.smoothstep(coordinate,hinge-band,hinge+band);
      const a=this.angles.getComponent(index),hy=this.coordinate==='y'?hinge:0,hz=this.coordinate==='z'?hinge:0;
      const py=point.y-hy,pz=point.z-hz;
      point.y=THREE.MathUtils.lerp(point.y,Math.cos(a)*py-Math.sin(a)*pz+hy,weight);
      point.z=THREE.MathUtils.lerp(point.z,Math.sin(a)*py+Math.cos(a)*pz+hz,weight);
    }
    return point;
  }
}

export function disposeJointMaterials(mesh: THREE.Mesh): void {
  mesh.customDepthMaterial?.dispose();mesh.customDistanceMaterial?.dispose();
}
