import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export type Point = readonly [number, number, number];
export type Pigment = number | ((point: THREE.Vector3, uv: THREE.Vector2) => number);
export type Ring = readonly [number, number, number, number?];
export type SculptDetail = 'full'|'compact';
const UP = new THREE.Vector3(0, 1, 0);

/** Original, vertex-painted character surfaces, merged once per moving joint. */
export class Sculpt {
  private readonly parts: THREE.BufferGeometry[] = [];
  constructor(private readonly detail:SculptDetail='full') {}

  add(geometry: THREE.BufferGeometry, pigment: Pigment, position: Point = [0,0,0],
    scale: Point = [1,1,1], rotation: Point = [0,0,0]): this {
    const source = geometry.index ? geometry.toNonIndexed() : geometry;
    if (source !== geometry) geometry.dispose();
    if (!source.getAttribute('normal')) source.computeVertexNormals();
    const vertices = source.getAttribute('position'), normals = source.getAttribute('normal');
    const uv = source.getAttribute('uv');
    const colors = new Float32Array(vertices.count * 3);
    const p = new THREE.Vector3(), texel = new THREE.Vector2(), color = new THREE.Color();
    for (let i=0; i<vertices.count; i++) {
      p.fromBufferAttribute(vertices,i);
      texel.set(uv?.getX(i) ?? 0,uv?.getY(i) ?? 0);
      color.setHex(typeof pigment === 'number' ? pigment : pigment(p,texel));
      // Painted volume and very quiet mottling, independent of world lighting.
      const grain=Math.sin(p.x*63+p.y*41+p.z*29)*Math.sin(p.y*91-p.z*47)*.018;
      color.multiplyScalar(.94+normals.getY(i)*.055+grain);
      colors.set([color.r,color.g,color.b],i*3);
    }
    source.setAttribute('color',new THREE.BufferAttribute(colors,3));
    if (!uv) source.setAttribute('uv',new THREE.BufferAttribute(new Float32Array(vertices.count*2),2));
    source.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...position),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),new THREE.Vector3(...scale)));
    this.parts.push(source);
    return this;
  }

  ellipsoid(position: Point, radii: Point, pigment: Pigment, rotation: Point = [0,0,0]): this {
    const radius=Math.max(...radii),compact=this.detail==='compact';
    const width=compact?(radius<.15?6:8):radius<.07?8:radius<.15?10:14;
    const height=compact?(radius<.15?4:6):radius<.07?6:radius<.15?8:10;
    return this.add(new THREE.SphereGeometry(1,width,height),pigment,position,radii,rotation);
  }

  /** Variable cross sections make continuous bellies, shoulders, snouts and boots. */
  loft(rings: readonly Ring[], pigment: Pigment, position: Point = [0,0,0], axis: 'y'|'z' = 'y', sides=14): this {
    if(this.detail==='compact')sides=Math.min(sides,8);
    const vertices:number[]=[], uv:number[]=[], indices:number[]=[];
    for(let r=0;r<rings.length;r++) {
      const [distance,width,depth,offset=0]=rings[r]!;
      for(let s=0;s<=sides;s++) {
        const a=s/sides*Math.PI*2;
        vertices.push(Math.cos(a)*width,axis==='y'?distance:offset+Math.sin(a)*depth,
          axis==='y'?offset+Math.sin(a)*depth:distance);
        uv.push(s/sides,r/(rings.length-1));
        if(r<rings.length-1&&s<sides) {
          const k=r*(sides+1)+s;
          // Cross-section winding differs between vertical and longitudinal lofts.
          if(axis==='y')indices.push(k,k+sides+1,k+1,k+1,k+sides+1,k+sides+2);
          else indices.push(k,k+1,k+sides+1,k+1,k+sides+2,k+sides+1);
        }
      }
    }
    return this.add(surface(vertices,uv,indices),pigment,position);
  }

  tube(points: readonly Point[], radii: readonly number[], pigment: Pigment, segments=14, sides=7): this {
    if(this.detail==='compact'){segments=Math.max(3,Math.ceil(segments*.5));sides=Math.min(sides,5);}
    const curve=new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p)));
    const frames=curve.computeFrenetFrames(segments,false);
    const vertices:number[]=[], uv:number[]=[], indices:number[]=[];
    for(let i=0;i<=segments;i++) {
      const t=i/segments,at=curve.getPointAt(t), r=t*(radii.length-1),lo=Math.floor(r);
      const radius=THREE.MathUtils.lerp(radii[lo]!,radii[Math.min(lo+1,radii.length-1)]!,r-lo);
      for(let s=0;s<=sides;s++) {
        const a=s/sides*Math.PI*2;
        const point=at.clone().addScaledVector(frames.normals[i]!,Math.cos(a)*radius)
          .addScaledVector(frames.binormals[i]!,Math.sin(a)*radius);
        vertices.push(point.x,point.y,point.z);uv.push(s/sides,t);
        if(i<segments&&s<sides) {
          const k=i*(sides+1)+s;indices.push(k,k+1,k+sides+1,k+1,k+sides+2,k+sides+1);
        }
      }
    }
    return this.add(surface(vertices,uv,indices),pigment);
  }

  leaf(start: Point, end: Point, width: number, pigment: Pigment, curl=.06): this {
    const direction=new THREE.Vector3(...end).sub(new THREE.Vector3(...start)),length=direction.length();
    const vertices:number[]=[],uv:number[]=[],indices:number[]=[];
    const rows=this.detail==='compact'?6:10,columns=this.detail==='compact'?3:4;
    for(let r=0;r<=rows;r++)for(let c=0;c<=columns;c++) {
      const t=r/rows,u=c/columns*2-1;
      const w=Math.pow(Math.sin(Math.PI*t),.82)*width*(1+.06*Math.sin(t*35));
      vertices.push(u*w,t*length,curl*Math.sin(t*Math.PI)-Math.abs(u)*width*.15);
      uv.push(c/columns,t);
      if(r<rows&&c<columns){const k=r*(columns+1)+c;indices.push(k,k+1,k+columns+1,k+1,k+columns+2,k+columns+1);}
    }
    const geometry=surface(vertices,uv,indices);
    geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP,direction.normalize()));
    return this.add(geometry,pigment,start);
  }

  finish(parent: THREE.Group, name: string, roughness=.88, emissive?: number): THREE.Mesh {
    if(!this.parts.length)throw new Error(`Empty character surface: ${name}`);
    const geometry=mergeGeometries(this.parts,false)!;
    for(const part of this.parts)part.dispose();this.parts.length=0;
    geometry.computeBoundingSphere();
    const material=new THREE.MeshStandardMaterial({color:0xffffff,vertexColors:true,
      roughness,side:THREE.DoubleSide,emissive:emissive??0,emissiveIntensity:emissive===undefined?0:.35});
    const mesh=new THREE.Mesh(geometry,material);mesh.name=name;mesh.castShadow=true;mesh.receiveShadow=true;
    parent.add(mesh);return mesh;
  }
}

export function surface(vertices: number[], uv: number[], indices: number[]): THREE.BufferGeometry {
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  geometry.setIndex(indices);geometry.computeVertexNormals();return geometry;
}

export function joint(parent: THREE.Group,name: string,position: Point): THREE.Group {
  const root=new THREE.Group();root.name=name;root.position.set(...position);parent.add(root);return root;
}

/** Almond sockets, irises and catchlights occupy one draw and blink together. */
export function sculptEyes(parent: THREE.Group, direction: number, spread: number, y: number, z: number,
  size=.052, iris=0x87683d,detail:SculptDetail='full'): void {
  const face=joint(parent,'expressive-eyes',[0,0,0]);
  const sculpt=new Sculpt(detail);
  for(const side of [-1,1]) {
    const x=side*spread;
    sculpt.ellipsoid([x,y,z],[size*1.13,size*.86,size*.39],0x233331);
    sculpt.ellipsoid([x,y+.002,z+direction*size*.18],[size*.91,size*.70,size*.34],0xece7cb);
    sculpt.ellipsoid([x+side*size*.08,y,z+direction*size*.42],[size*.48,size*.60,size*.24],iris);
    sculpt.ellipsoid([x+side*size*.08,y,z+direction*size*.55],[size*.24,size*.46,size*.16],0x101d24);
    sculpt.ellipsoid([x-size*.15,y+size*.24,z+direction*size*.65],[size*.15,size*.16,size*.1],0xfffae5);
  }
  const eyes=sculpt.finish(face,'painted-eye-surfaces',.4);eyes.castShadow=false;
}

/** A compact, tapered leg and an actual foot, all attached to the original hip. */
export function paw(parent: THREE.Group,name: string,position: Point,length: number,width: number,
  coat: number,footColor=coat,hoof=false): THREE.Group {
  const root=joint(parent,name,position),sculpt=new Sculpt();
  sculpt.loft([[-length+.09,0,0],[-length+.11,width*.65,width*.7],[-length*.55,width*.55,width*.65,.025],
    [-length*.30,width*.82,width*.85,.015],[-.05,width,width], [.035,0,0]],coat);
  sculpt.ellipsoid([0,-length+.075,-width*.48],[width*.95,.075,width*1.52],footColor);
  if(hoof) {
    sculpt.tube([[0,-length+.02,-width*1.8],[0,-length+.1,-width*1.4]], [.008,.007],0x292e29,3,4);
  } else for(const x of [-.45,0,.45]) {
    sculpt.tube([[x*width,-length+.07,-width*1.65],[x*width,-length+.09,-width*1.2]], [.006,.004],0x394335,3,4);
  }
  sculpt.finish(root,`${name}.sculpt`);return root;
}
