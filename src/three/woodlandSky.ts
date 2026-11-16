import * as THREE from 'three';

/** One unlit draw: a still painted sky, with no textures or camera animation. */
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
    },
    vertexShader: `varying vec3 vDirection;
      void main() {
        vDirection = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
      }`,
    fragmentShader: `varying vec3 vDirection;
      uniform vec3 horizon; uniform vec3 zenith; uniform vec3 cloud; uniform float daylight;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
        return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),
          mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);
      }
      void main() {
        vec3 d=normalize(vDirection);
        vec3 color=mix(horizon,zenith,smoothstep(0.,.85,max(d.y,0.)));
        // Project above the horizon so the cloud pattern has no longitude seam.
        vec2 p=d.xz/max(.14,d.y)*2.2;
        float n=noise(p)*.62+noise(p*2.1)*.26+noise(p*4.3)*.12;
        float clouds=smoothstep(.53,.76,n)*smoothstep(.07,.26,d.y);
        color=mix(color,cloud,clouds*.40*daylight);
        vec3 sunDirection=normalize(vec3(-24.,34.,-18.));
        float glow=pow(max(dot(d,sunDirection),0.),40.);
        color+=vec3(.15,.10,.035)*glow*daylight;
        gl_FragColor=vec4(color,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  readonly mesh = new THREE.Mesh(new THREE.SphereGeometry(95, 32, 20), this.material);

  constructor() {
    this.mesh.name = 'first-person.woodland-sky';
    this.mesh.renderOrder = -1000;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  update(camera: THREE.Camera, horizon: THREE.Color, night: number): void {
    this.mesh.position.copy(camera.position);
    this.material.uniforms.horizon!.value.copy(horizon);
    this.material.uniforms.zenith!.value.copy(horizon).lerp(new THREE.Color(0x648fa5), .48 * (1 - night))
      .multiplyScalar(1 - night * .48);
    this.material.uniforms.cloud!.value.copy(horizon).lerp(new THREE.Color(0xf4ebd5), .55 * (1 - night));
    this.material.uniforms.daylight!.value = 1 - night;
  }

  dispose(): void { this.mesh.geometry.dispose(); this.material.dispose(); }
}
