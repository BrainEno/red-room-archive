import * as THREE from 'three';
import gsap from 'gsap';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { world } from './scene-state.ts';
import { publicPath } from '../lib/public-path.ts';

// sv = 滚动速度（Lenis），驱动窗帘物理。cam.ry 是雕像相对镜头的朝向偏移；
// 雕像始终自动转向镜头，ry 只在此基础上做小幅侧转。
const SX = 2.4;
/** 如果你的 GLB 默认脸朝后（背对镜头），把它改成 Math.PI；侧着就改 ±Math.PI/2 */
const MODEL_YAW = 0;
/** 服务端在 canvas[data-model] 上给出唯一地址（后台上传的 /uploads/venus.glb?v=… 或仓库内 /models/venus.glb），
 *  不再盲目请求可能 404 的上传地址；加载失败时依次退回仓库内文件 → 占位雕像 */
const BUNDLED_MODEL = publicPath('/models/venus.glb');
const modelUrls = (canvas: HTMLCanvasElement) => [...new Set([canvas.dataset.model || BUNDLED_MODEL, BUNDLED_MODEL])];

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
  col *= mix(.4, 1., smoothstep(-6., -4.2, p.y));   // 窗帘下沿的接地暗角：帘脚落在地上，而不是浮在地面线上
  col *= 1. + uHover*.5;
  gl_FragColor = vec4(col*uFade, 1.);
}`;

// 窗帘：顶部固定、下摆自由。uSway = 弹簧摆动，uRip/uPh = 沿高度传播的涟漪
const CURTAIN_V = `uniform float uT, uSway, uRip, uPh;
varying float vH; varying vec2 vUv; varying vec3 vN, vV;
void main(){
  vUv = uv; vec3 p = position;
  float hang = clamp((8. - p.y)/16., 0., 1.);
  float amp = .38*(1. + .5*uRip);
  float a = p.x*3.2 + sin(p.y*.4 + uT*.5)*.7 + sin(p.x*.9 + uT*.3)*.5;
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
const CURTAIN_F = `uniform float uFade, uT; varying float vH; varying vec2 vUv; varying vec3 vN, vV;
float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
void main(){
  vec3 N = normalize(vN), V = normalize(vV);
  float diff = max(dot(N, normalize(vec3(.3,.7,.65))), 0.);
  float sheen = pow(1. - abs(dot(N, V)), 3.);
  float ao = mix(.35, 1., vH*.5 + .5);
  float fiber = n(vec2(vUv.x*700., vUv.y*40.))*.5 + n(vUv*vec2(90., 9.))*.5;
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
  renderer.localClippingEnabled = true;                    // 雕像从地面“长出来”靠裁剪面实现
  renderer.toneMapping = THREE.ACESFilmicToneMapping;      // 只影响大理石（自定义 Shader 不受影响），高光不再死白
  renderer.toneMappingExposure = 1.05;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0506);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);

  const uT = { value: 0 }, uFade = { value: 0 }, uHover = { value: 0 }, uS = { value: 0 };
  const uSway = { value: 0 }, uRip = { value: 0 }, uPh = { value: 0 };

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 80),
    new THREE.ShaderMaterial({ vertexShader: FLOOR_V, fragmentShader: FLOOR_F, uniforms: { uT, uFade, uHover } }));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  const cg = new THREE.PlaneGeometry(18, 16, 180, 8);
  const cm = new THREE.ShaderMaterial({ vertexShader: CURTAIN_V, fragmentShader: CURTAIN_F, uniforms: { uT, uFade, uSway, uRip, uPh }, side: THREE.DoubleSide });
  const L = new THREE.Mesh(cg, cm), R = new THREE.Mesh(cg, cm);
  L.position.set(-9, 7, -6); R.position.set(9, 7, -6);
  R.scale.x = -1;                                          // 右帘是左帘的镜像：褶皱、摆动左右严格对称
  scene.add(L, R);

  const marble = new THREE.MeshStandardMaterial({ color: 0xeeeae2, roughness: 0.45 });
  marble.clippingPlanes = [new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)];   // 地面以下不绘制
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
    transparent: true, depthWrite: false, uniforms: { uS },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `varying vec2 vUv; uniform float uS; void main(){ gl_FragColor = vec4(0.,0.,0., .7*uS*smoothstep(1., 0., length(vUv-.5)*2.)); }`,
  }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.01;
  statue.add(shadow);

  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const onLoad = (g: any) => {
    const m = g.scene;
    m.traverse((o: THREE.Object3D) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = marble; });
    m.rotation.y = MODEL_YAW;
    const box = new THREE.Box3().setFromObject(m);
    m.scale.setScalar(2.6 / (box.max.y - box.min.y));
    box.setFromObject(m);
    const c = box.getCenter(new THREE.Vector3());
    m.position.set(-c.x, 0.6 - box.min.y, -c.z);
    statue.remove(placeholder); statue.add(m);
  };
  const tryModel = (urls: string[]) => { const [u, ...rest] = urls; if (!u) return console.info('[scene] using placeholder statue'); loader.load(u, onLoad, undefined, () => tryModel(rest)); };
  tryModel(modelUrls(canvas));

  // —— 灯光：博物馆式“跟拍主光” + 红色环境底光 + 背后红边光 ——
  // 主光始终跟着镜头走（从镜头左上方打向雕像），所以无论雕像朝哪，被看到的那一面都是亮的。
  scene.add(new THREE.HemisphereLight(0xffe4dc, 0x4a1014, 1.7));
  const aim = new THREE.Object3D(); aim.position.set(SX, 1.4, 0); scene.add(aim);
  const key = new THREE.SpotLight(0xfff0dc, 100, 0, 0.42, 0.85, 1);   // distance=0 不截断；decay=1，强度每帧按距离补偿
  key.target = aim; scene.add(key);
  const fill = new THREE.PointLight(0xff3040, 22, 14, 2);             // 地面红光反弹，给暗部染上房间的颜色
  fill.position.set(SX - 3.2, 0.8, 3.2); scene.add(fill);
  const rim = new THREE.PointLight(0xff1a2a, 70, 22);                 // 背后红色轮廓光
  rim.position.set(SX, 2.5, -4); scene.add(rim);
  const KEY_E = 4.2;   // 主光在雕像上的照度：嫌亮/暗就改这个数

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
  let phase = 0, yaw = 0, yawInit = false;

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

    // 雕像：首页隐藏；随引言滚动从地面“升起”（裁剪面把地下部分切掉）
    const s = c.st * c.st * (3 - 2 * c.st);
    statue.visible = s > 0.01;
    statue.position.y = -(1 - s) * 3.6;
    uS.value = s;

    // 朝向：永远转向镜头 + 指针牵引 + 缓慢摇摆，不再整圈自转（避免背对屏幕）
    const target = Math.atan2(camera.position.x - SX, camera.position.z) + c.ry + ptr.x * 0.3 + Math.sin(t * 0.35) * 0.25;
    if (!yawInit) { yaw = target; yawInit = true; }
    const d = THREE.MathUtils.euclideanModulo(target - yaw + Math.PI, Math.PI * 2) - Math.PI;
    yaw += d * (1 - Math.exp(-dt * 3));
    statue.rotation.y = yaw;

    // 主光跟拍
    key.position.set(camera.position.x - 1.4, camera.position.y + 2.2, camera.position.z + 0.5);
    key.intensity = KEY_E * key.position.distanceTo(aim.position);

    // 首页是纯黑背景 + 霓虹招牌，此时不渲染 3D，省 GPU
    if (c.lum > 0.003 || statue.visible) renderer.render(scene, camera);
  });
}
