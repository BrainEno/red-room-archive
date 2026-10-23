import * as THREE from 'three';
import gsap from 'gsap';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

/** 可被 GSAP 补间的状态；sv = 滚动速度（Lenis），驱动窗帘物理 */
export const world = {
  cam: { px: 0, py: 2, pz: 10, lx: 1.2, ly: 1.6, lz: 0, open: 0, ry: -0.5, lum: 0.1, st: 0 },
  fade: { v: 0 }, dolly: { v: 0 }, hover: { v: 0 }, sv: 0,
};
const SX = 2.4;
const MODEL_URLS = ['/uploads/venus.glb', '/models/venus.glb']; // 后台上传 → 仓库内文件 → 占位雕像

const FLOOR_V = `varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`;
const FLOOR_F = `varying vec3 vW; uniform float uT, uFade, uHover;
void main(){
  vec2 p = vW.xz;
  float zig = abs(fract(p.x/2.) - .5)*2.;
  float s = abs(fract((p.y + zig)/1.6 + uT*.02)*2. - 1.);
  float aa = fwidth(s) + 1e-4;
  vec3 col = mix(vec3(.06,.04,.04), vec3(.93,.9,.84), smoothstep(.5-aa, .5+aa, s));
  col *= mix(.08, 1., smoothstep(13., 1.5, length(p - vec2(${SX}, 0.))));
  col = mix(col, col*vec3(1.,.25,.25), .8*smoothstep(1., -7., p.y));
  col *= 1. + uHover*.5;
  gl_FragColor = vec4(col*uFade, 1.);
}`;

// 窗帘：顶部固定、下摆自由。uSway = 弹簧摆动，uRip/uPh = 沿高度传播的涟漪
// 左右两片是同一张布：折痕位移用整张布的坐标 sx（uSide = -1 / +1）计算，而不是各自的局部 x，
// 否则两片的接缝处相位不同 → 深度不同 → 镜头移动/转向时屏幕上出现纵向错位。
const CURTAIN_V = `uniform float uT, uSway, uRip, uPh, uSide;
varying float vH, vS; varying vec2 vUv; varying vec3 vN, vV;
void main(){
  vUv = uv; vec3 p = position;
  float hang = clamp((8. - p.y)/16., 0., 1.);
  float amp = .38*(1. + .5*uRip);
  float sx = p.x + uSide*9.;                      // 整张布 x：左片 -18..0，右片 0..18
  vS = (sx + 18.)/36.;
  float a = sx*3.2 + sin(p.y*.4 + uT*.5)*.7 + sin(sx*.9 + uT*.3)*.5;
  float dz = cos(a)*3.2*amp;
  p.z += sin(a)*amp*(1. - hang*.25);
  p.z += uSway*hang*hang*.55 + sin(hang*5. - uPh)*uRip*hang*.35;
  p.x += uSway*hang*.12;
  vH = sin(a);
  vec4 mv = modelViewMatrix*vec4(p,1.);
  vN = normalize(normalMatrix*normalize(vec3(-dz, 0., 1.)));
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix*mv;
}`;
// 丝绒质感：褶皱内侧遮蔽 + 漫反射 + 掠射角丝光 + 纤维/染色噪声 + 细颗粒
const CURTAIN_F = `uniform float uFade, uT; varying float vH, vS; varying vec2 vUv; varying vec3 vN, vV;
float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
void main(){
  vec3 N = normalize(vN), V = normalize(vV);
  float diff = max(dot(N, normalize(vec3(.3,.7,.65))), 0.);
  float sheen = pow(1. - abs(dot(N, V)), 3.);
  float ao = mix(.35, 1., vH*.5 + .5);
  float fiber = n(vec2(vS*1400., vUv.y*40.))*.5 + n(vec2(vS*180., vUv.y*9.))*.5;
  vec3 col = vec3(.62,.04,.08)*(.85 + .3*fiber)*(.12 + 1.05*diff*ao) + vec3(.9,.22,.18)*sheen*.55*ao;
  col *= mix(.4, 1., smoothstep(0., .55, vUv.y))*mix(1., .5, smoothstep(.6, 1., vUv.y));
  col += (h(vUv*vec2(1200., 700.) + uT) - .5)*.03;
  gl_FragColor = vec4(col*uFade, 1.);
}`;

type Spring = { x: number; v: number };
const spring = (s: Spring, target: number, k: number, c: number, dt: number, force = 0) => { s.v += (k * (target - s.x) - c * s.v + force) * dt; s.x += s.v * dt; };

export function initScene(canvas: HTMLCanvasElement) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0506);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);

  const uT = { value: 0 }, uFade = { value: 0 }, uHover = { value: 0 };
  const uSway = { value: 0 }, uRip = { value: 0 }, uPh = { value: 0 };

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 80),
    new THREE.ShaderMaterial({ vertexShader: FLOOR_V, fragmentShader: FLOOR_F, uniforms: { uT, uFade, uHover } }));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  const cg = new THREE.PlaneGeometry(18, 16, 180, 8);
  const curtainMat = (side: number) => new THREE.ShaderMaterial({ vertexShader: CURTAIN_V, fragmentShader: CURTAIN_F,
    uniforms: { uT, uFade, uSway, uRip, uPh, uSide: { value: side } }, side: THREE.DoubleSide });
  const L = new THREE.Mesh(cg, curtainMat(-1)), R = new THREE.Mesh(cg, curtainMat(1));
  L.position.set(-9, 7, -6); R.position.set(9, 7, -6);
  scene.add(L, R);

  const marble = new THREE.MeshStandardMaterial({ color: 0xeeeae2, roughness: 0.45 });
  const statue = new THREE.Group();
  statue.position.set(SX, 0, 0);
  scene.add(statue);
  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.65, 0.6, 48), marble);
  plinth.position.y = 0.3;
  const prof = [[0,0],[.38,.02],[.42,.9],[.30,1.25],[.2,1.55],[.26,1.85],[.17,2.1],[.09,2.2],[.12,2.35],[.1,2.5],[0,2.55]].map(([x, y]) => new THREE.Vector2(x, y));
  const placeholder = new THREE.Mesh(new THREE.LatheGeometry(prof, 64), marble);
  placeholder.position.y = 0.6;
  statue.add(plinth, placeholder);
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(1.4, 48), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `varying vec2 vUv; void main(){ gl_FragColor = vec4(0.,0.,0., .7*smoothstep(1., 0., length(vUv-.5)*2.)); }`,
  }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.01;
  statue.add(shadow);

  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const onLoad = (g: any) => {
    const m = g.scene;
    m.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = marble; });
    const box = new THREE.Box3().setFromObject(m);
    m.scale.setScalar(2.6 / (box.max.y - box.min.y));
    box.setFromObject(m);
    const c = box.getCenter(new THREE.Vector3());
    m.position.set(-c.x, 0.6 - box.min.y, -c.z);
    statue.remove(placeholder); statue.add(m);
  };
  const tryModel = (urls: string[]) => { const [u, ...rest] = urls; if (!u) return console.info('[scene] using placeholder statue'); loader.load(u, onLoad, undefined, () => tryModel(rest)); };
  tryModel(MODEL_URLS);

  scene.add(new THREE.HemisphereLight(0xffd6d0, 0x300000, 0.5));
  const spot = new THREE.SpotLight(0xfff1e0, 140, 30, 0.55, 0.6, 1);
  spot.position.set(SX + 3, 8, 6); spot.target = statue; scene.add(spot);
  const rim = new THREE.PointLight(0xff1a2a, 70, 22);
  rim.position.set(SX, 2.5, -4); scene.add(rim);

  const ptr = { x: 0, y: 0 }, tgt = { x: 0, y: 0 };
  addEventListener('pointermove', (e) => { tgt.x = (e.clientX / innerWidth) * 2 - 1; tgt.y = (e.clientY / innerHeight) * 2 - 1; });
  const resize = () => {
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = innerWidth / innerHeight;
    camera.fov = camera.aspect < 1 ? 62 : 40;
    camera.updateProjectionMatrix();
  };
  addEventListener('resize', resize); resize();

  // 物理状态：拉开位置（欠阻尼，会有惯性过冲）、摆动（滚动速度和拉动速度作为外力）
  const gapS: Spring = { x: 9, v: 0 }, sway: Spring = { x: 0, v: 0 };
  let phase = 0;

  gsap.ticker.add((t, dtMs) => {
    const dt = Math.min(dtMs / 1000, 1 / 30), c = world.cam;
    const sv = THREE.MathUtils.clamp(world.sv / 40, -1.5, 1.5);
    spring(gapS, 9 + c.open * 14, 14, 3.2, dt);
    spring(sway, 0, 9, 1.6, dt, -sv * 10 - gapS.v * 0.3);
    sway.x = THREE.MathUtils.clamp(sway.x, -2, 2);
    const rip = Math.min(Math.abs(sv) + Math.abs(sway.v) * 0.3 + Math.abs(gapS.v) * 0.05, 1.2);
    phase += dt * (2 + 4 * rip);
    uSway.value = sway.x; uRip.value = rip; uPh.value = phase;

    uT.value = t; uFade.value = world.fade.v * c.lum; uHover.value = world.hover.v;
    ptr.x += (tgt.x - ptr.x) * 0.05; ptr.y += (tgt.y - ptr.y) * 0.05;
    camera.position.set(c.px + ptr.x * 0.5, c.py - ptr.y * 0.3, c.pz + (1 - world.dolly.v) * 5);
    camera.lookAt(c.lx, c.ly, c.lz);
    L.position.x = -gapS.x; R.position.x = gapS.x;
    statue.rotation.y = c.ry + t * 0.1;
    const st = c.st * c.st * (3 - 2 * c.st);   // 首页隐藏，随招牌缩小从地面升起
    statue.visible = st > 0.01; statue.scale.setScalar(Math.max(st, 0.001));
    renderer.render(scene, camera);
  });
}
