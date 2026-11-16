import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import type { GameState } from '../simulation/state';
import { TILE_SIZE } from '../config/platform';

/** A restrained photographic finish; DOM text and controls remain sharp. */
export class SceneFinish {
  readonly stats = {drawCalls:0,triangles:0};
  private readonly composer: EffectComposer;
  private readonly output = new OutputPass();
  private readonly renderPass: RenderPass;
  private readonly foregroundPass: RenderPass;

  constructor(private readonly renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera,
    foreground: { scene: THREE.Scene; camera: THREE.Camera }) {
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 2 });
    this.composer = new EffectComposer(renderer, target);
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);
    // Composite hands into the same graded image, retaining their own depth so
    // nearby walls cannot slice a tool in half. No extra framebuffer is needed.
    this.foregroundPass = new RenderPass(foreground.scene, foreground.camera);
    this.foregroundPass.clear = false;
    this.foregroundPass.clearDepth = true;
    this.foregroundPass.enabled = false;
    this.composer.addPass(this.foregroundPass);
    // Grade linear light in the output pass, before its standard tone mapping.
    // This avoids a separate full-screen pass and its framebuffer bandwidth.
    this.output.material.fragmentShader = this.output.material.fragmentShader.replace(
      'gl_FragColor = texture2D( tDiffuse, vUv );', `
          vec4 frame=texture2D(tDiffuse,vUv);
          vec3 c=frame.rgb; float l=dot(c,vec3(.2126,.7152,.0722));
          c=mix(vec3(l),c,1.065);
          c+=vec3(.014,.006,-.006)*smoothstep(.15,.8,l);
          c+=vec3(-.005,.004,.009)*(1.-smoothstep(.0,.4,l));
          vec2 p=(vUv-.5)*vec2(1.,.85);
          c*=1.-.2*smoothstep(.12,.65,dot(p,p));
          gl_FragColor=vec4(max(c,vec3(0.)),frame.a);`);
    this.composer.addPass(this.output);
    // Keep the existing colour-pass budget comparable across views, adding
    // the hands' draw cost when their foreground pass actually runs.
    scene.onAfterRender = () => {
      this.stats.drawCalls = renderer.info.render.calls + 1;
      this.stats.triangles = renderer.info.render.triangles + 2;
    };
    foreground.scene.onAfterRender = () => {
      this.stats.drawCalls += renderer.info.render.calls;
      this.stats.triangles += renderer.info.render.triangles;
    };
  }

  resize(width: number, height: number): void {
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(width, height);
  }

  /** Draw through a different camera (first person swaps in a perspective one). */
  setCamera(camera: THREE.Camera): void { this.renderPass.camera = camera; }
  setForegroundEnabled(enabled: boolean): void { this.foregroundPass.enabled = enabled; }

  render(): void { this.renderer.info.reset(); this.composer.render(); }
  dispose(): void { this.output.dispose(); this.composer.dispose(); }
}

/** Soft, inexpensive grounding for the whole roster in one instanced draw. */
export class ContactShadows {
  readonly mesh: THREE.InstancedMesh;
  private readonly transform = new THREE.Object3D();
  private index = 0;

  constructor() {
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1,1).rotateX(-Math.PI/2),
      new THREE.ShaderMaterial({
        transparent:true,depthWrite:false,
        vertexShader:'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.);}',
        fragmentShader:`varying vec2 vUv; void main(){float d=length((vUv-.5)*2.);
          float a=exp(-d*d*4.5)*(1.-smoothstep(.65,1.,d))*.29;
          gl_FragColor=vec4(.055,.07,.045,a);}`,
      }),1024);
    this.mesh.name='world.contact-shadows';this.mesh.frustumCulled=false;this.mesh.renderOrder=1;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  }

  update(state: GameState, actors: readonly THREE.Object3D[] = [], playerPosition: Pick<GameState['player'], 'x' | 'y'> = state.player): void {
    this.index=0;
    this.add(playerPosition.x/TILE_SIZE,playerPosition.y/TILE_SIZE,.7,.46);
    for(const node of state.resourceNodes) if(node.hp>0) this.add(node.x/TILE_SIZE,node.y/TILE_SIZE,
      node.kind==='tree'?1.35:node.kind==='stone'||node.kind==='metal'?1.25:.65,node.kind==='tree'?.8:.55);
    for(const creature of state.wildCreatures) this.add(creature.x/TILE_SIZE,creature.y/TILE_SIZE,.95,.65);
    for(const actor of actors) this.add(actor.position.x,actor.position.z,.8,.55);
    this.mesh.count=this.index;this.mesh.instanceMatrix.needsUpdate=true;
  }

  private add(x:number,z:number,width:number,depth:number): void {
    if(this.index>=1024)return;
    this.transform.position.set(x,.014,z);this.transform.scale.set(width,1,depth);this.transform.updateMatrix();
    this.mesh.setMatrixAt(this.index++,this.transform.matrix);
  }
}
