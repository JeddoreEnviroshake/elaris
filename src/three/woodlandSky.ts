import * as THREE from 'three';
import { DANGER_PRESENTATION } from '../scenes/dangerPresentation';
import type { DangerThreat } from '../simulation/survivalCycle';

const THREAT_SLOT: Readonly<Record<DangerThreat, number>> = { fog: 0, raid: 1, storm: 2 };

/**
 * One unlit draw: the painted sky dome. Fair weather is a still gradient with
 * soft clouds; a danger phase paints its own sky over it — rolling poison murk,
 * a starlit raid night with a moon, or a slow violet storm vortex — so the sky
 * names the threat even from inside a sealed room.
 *
 * Event motion is slow drift only (the camera itself never moves the sky), and
 * frozen when the player prefers reduced motion.
 */
export class WoodlandSky {
  private readonly material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    uniforms: {
      horizon: { value: new THREE.Color() },
      zenith: { value: new THREE.Color() },
      cloud: { value: new THREE.Color() },
      daylight: { value: 1 },
      time: { value: 0 },
      // x poison, y raid night, z arcane storm; each 0..1.
      eventMix: { value: new THREE.Vector3() },
      fogAccent: { value: new THREE.Color(DANGER_PRESENTATION.fog.skyAccent) },
      raidAccent: { value: new THREE.Color(DANGER_PRESENTATION.raid.skyAccent) },
      stormAccent: { value: new THREE.Color(DANGER_PRESENTATION.storm.skyAccent) },
    },
    vertexShader: `varying vec3 vDirection;
      void main() {
        vDirection = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
      }`,
    fragmentShader: `varying vec3 vDirection;
      uniform vec3 horizon; uniform vec3 zenith; uniform vec3 cloud; uniform float daylight;
      uniform float time; uniform vec3 eventMix;
      uniform vec3 fogAccent; uniform vec3 raidAccent; uniform vec3 stormAccent;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float hash3(vec3 p) { return fract(sin(dot(p, vec3(127.1,311.7,74.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
        return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),
          mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);
      }
      float fbm(vec2 p) {
        return noise(p)*.5+noise(p*2.03+1.7)*.27+noise(p*4.07+3.1)*.15+noise(p*8.11+5.3)*.08;
      }
      void main() {
        vec3 d=normalize(vDirection);
        float up=max(d.y,0.);
        vec3 color=mix(horizon,zenith,smoothstep(0.,.85,up));
        // Project above the horizon so the cloud pattern has no longitude seam.
        vec2 p=d.xz/max(.14,d.y)*2.2;
        float calm=1.-max(eventMix.x,max(eventMix.y,eventMix.z));
        float n=noise(p)*.62+noise(p*2.1)*.26+noise(p*4.3)*.12;
        float clouds=smoothstep(.53,.76,n)*smoothstep(.07,.26,d.y);
        color=mix(color,cloud,clouds*.40*daylight*calm);
        vec3 sunDirection=normalize(vec3(-24.,34.,-18.));
        float glow=pow(max(dot(d,sunDirection),0.),40.);
        color+=vec3(.15,.10,.035)*glow*daylight*calm;

        // Poison: heavy murk banks that roll low over the horizon, lit sickly
        // from beneath, with a thinner green haze reaching up overhead.
        if (eventMix.x > 0.) {
          vec2 q=p*.45+vec2(time*.018,time*.011);
          float murk=fbm(q+vec2(fbm(q*1.4-time*.006),fbm(q*1.1+4.2)));
          float low=1.-smoothstep(.04,.62,up);
          float bank=smoothstep(.38,.72,murk)*(.35+.65*low);
          vec3 murkColor=mix(fogAccent*.16,fogAccent*.55,smoothstep(.45,.85,murk));
          color=mix(color,murkColor,bank*.78*eventMix.x);
          color+=fogAccent*.16*(1.-smoothstep(0.,.22,up))*eventMix.x;
        }

        // Raid night: a black sky with stars and a pale moon.
        if (eventMix.y > 0.) {
          vec3 cell=floor(d*140.);
          float h=hash3(cell);
          vec3 local=fract(d*140.)-.5;
          float star=step(.989,h)*smoothstep(.5,0.,length(local));
          float twinkle=.65+.35*sin(time*1.7+h*91.);
          color+=raidAccent*star*twinkle*smoothstep(.04,.28,up)*eventMix.y*.9;
          vec3 moonDirection=normalize(vec3(26.,30.,20.));
          float facing=dot(d,moonDirection);
          float disc=smoothstep(.9986,.9991,facing);
          float craters=.82+.18*noise(d.xz*260.);
          color=mix(color,raidAccent*craters,disc*eventMix.y);
          color+=raidAccent*(.10*pow(max(facing,0.),90.)+.03*pow(max(facing,0.),8.))*eventMix.y;
          // Slow ragged cloud shadows drifting across the stars.
          float rag=smoothstep(.55,.8,fbm(p*.6+vec2(time*.01,0.)))*smoothstep(.05,.3,up);
          color=mix(color,zenith*.6,rag*.7*eventMix.y);
        }

        // Arcane storm: a violet vortex turning slowly around the zenith, with
        // bright veins and an eye that breathes.
        if (eventMix.z > 0.) {
          float r=length(p);
          float a=1.9*log(1.+r)-time*.05;
          vec2 s=mat2(cos(a),-sin(a),sin(a),cos(a))*p;
          float swirl=fbm(s*.55+vec2(0.,time*.02));
          float veins=smoothstep(.6,.72,swirl)*(1.-smoothstep(.72,.9,swirl));
          float body=smoothstep(.3,.75,swirl);
          vec3 vortex=mix(stormAccent*.12,stormAccent*.42,body);
          float skyward=smoothstep(.02,.35,up);
          color=mix(color,vortex,body*.72*skyward*eventMix.z);
          color+=stormAccent*veins*.55*skyward*eventMix.z;
          float eye=exp(-r*.9)*(.75+.25*sin(time*.8));
          color+=stormAccent*eye*.32*eventMix.z;
          float flicker=pow(max(sin(time*.53)*sin(time*1.31+1.3),0.),8.);
          color+=stormAccent*flicker*.18*skyward*eventMix.z;
        }
        gl_FragColor=vec4(color,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  readonly mesh = new THREE.Mesh(new THREE.SphereGeometry(95, 32, 20), this.material);
  private readonly eventZenith = new THREE.Color();

  constructor() {
    this.mesh.name = 'first-person.woodland-sky';
    this.mesh.renderOrder = -1000;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  /**
   * @param horizon the distance-fog colour, so terrain fades seamlessly into sky
   * @param night 0 by day, 1 at full dark
   * @param threat the danger phase being painted, or null in fair weather
   * @param eventStrength how far that danger has settled in, 0..1
   * @param seconds animation clock; hold it still for reduced motion
   */
  update(
    camera: THREE.Camera,
    horizon: THREE.Color,
    night: number,
    threat: DangerThreat | null,
    eventStrength: number,
    seconds: number,
  ): void {
    const uniforms = this.material.uniforms;
    this.mesh.position.copy(camera.position);
    uniforms.horizon!.value.copy(horizon);
    const zenith = uniforms.zenith!.value as THREE.Color;
    zenith.copy(horizon).lerp(new THREE.Color(0x648fa5), .48 * (1 - night)).multiplyScalar(1 - night * .48);
    const strength = threat ? THREE.MathUtils.clamp(eventStrength, 0, 1) : 0;
    if (threat && strength > 0) {
      zenith.lerp(this.eventZenith.setHex(DANGER_PRESENTATION[threat].skyZenith), strength);
    }
    uniforms.cloud!.value.copy(horizon).lerp(new THREE.Color(0xf4ebd5), .55 * (1 - night));
    uniforms.daylight!.value = 1 - night;
    uniforms.time!.value = seconds;
    const mix = uniforms.eventMix!.value as THREE.Vector3;
    mix.set(0, 0, 0);
    if (threat) mix.setComponent(THREAT_SLOT[threat], strength);
  }

  dispose(): void { this.mesh.geometry.dispose(); this.material.dispose(); }
}
