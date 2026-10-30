import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import { initScene, world } from './scene.ts';
import { initNeon } from './neon.ts';

gsap.registerPlugin(ScrollTrigger);
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s)!;

// 刷新时回到顶部，保证每次都从“黑暗中的招牌”开场
history.scrollRestoration = 'manual';
if (!location.hash) scrollTo(0, 0);

// 切换语言 = 带 ?lang= 重新加载页面。点击时记下滚动位置，新页面跳过开场、回到原处，
// 读者不会因为换语言而被送回招牌、重看一遍开场动画
const RESUME_KEY = 'rra:resume';
const resumeY = (() => {
  try {
    const saved = JSON.parse(sessionStorage.getItem(RESUME_KEY) ?? 'null') as { y: number; at: number } | null;
    sessionStorage.removeItem(RESUME_KEY);
    return saved && Date.now() - saved.at < 15_000 ? saved.y : null;
  } catch { return null; }
})();
document.querySelectorAll<HTMLAnchorElement>('[data-lang-switch]').forEach((a) =>
  a.addEventListener('click', () => {
    try { sessionStorage.setItem(RESUME_KEY, JSON.stringify({ y: scrollY, at: Date.now() })); } catch { /* private mode */ }
  }));

// The content and navigation must remain usable when WebGL is unavailable.
try { initScene($<HTMLCanvasElement>('#gl')); }
catch (error) { console.warn('[scene] WebGL unavailable; showing the static page', error); }
const neon = initNeon($<HTMLCanvasElement>('#neon canvas'));
const fx = neon.fx;
world.fade.v = 1; world.dolly.v = 1;   // 开场不再用 3D 房间做“亮起”，首页由纯黑 + 招牌承担；房间在滚动中显现

// 1) Smooth scroll；把滚动速度交给窗帘物理。开场招牌点亮前先锁住滚动
let lenis: Lenis | null = null;
if (!reduce) {
  const L = (lenis = new Lenis({ lerp: 0.085 }));
  L.on('scroll', (l: any) => { ScrollTrigger.update(); world.sv = l.velocity; });
  gsap.ticker.add((t) => L.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);
  document.querySelectorAll<HTMLAnchorElement>('a[href^="#"]').forEach((a) =>
    a.addEventListener('click', (e) => { const id = a.getAttribute('href')!; if (id.length > 1) { e.preventDefault(); L.scrollTo(id, { duration: 1.6 }); } }));
  L.stop();
}

// 2) 镜头关键帧
//    设计原则：镜头基本正对窗帘墙（|lx-px| 很小，偏航角 < 4°），用“机位 x”而不是“扭头”来把雕像放到画面右侧。
//    之前镜头大幅偏航（最大约 35°），透视会让左帘下沿在屏幕上斜着翘起来，看起来左右帘长度不一致。
//    ry = 雕像相对镜头的侧转偏移；lum = 房间亮度；st = 雕像升起进度；open = 窗帘拉开程度
const K = {
  home:     { px: 0,    py: 2,   pz: 10,  lx: 0.3,  ly: 1.6, lz: 0, open: 0,    ry: -0.3,  lum: 0,   st: 0 },
  intro:    { px: 0,    py: 1.9, pz: 8.2, lx: 0.4,  ly: 1.7, lz: 0, open: 0.1,  ry: -0.2,  lum: 0.9, st: 0 },
  introEnd: { px: 0.6,  py: 1.8, pz: 6.6, lx: 1.0,  ly: 1.8, lz: 0, open: 0.22, ry: 0.15,  lum: 1,   st: 1 },
  latest:   { px: -0.3, py: 1.6, pz: 6.5, lx: -0.1, ly: 1.7, lz: 0, open: 0.35, ry: 0.3,   lum: 1,   st: 1 },
  featured: { px: 0.5,  py: 0.9, pz: 5,   lx: 0.6,  ly: 2.0, lz: 0, open: 0.15, ry: -0.45, lum: 1,   st: 1 },   // 低机位仰拍
  topics:   { px: -1.5, py: 3,   pz: 9,   lx: -1.4, ly: 1.6, lz: 0, open: 1,    ry: 0.5,   lum: 1,   st: 1 },   // 窗帘全开的大全景
  more:     { px: 0,    py: 1.4, pz: 13,  lx: 0,    ly: 2.2, lz: 0, open: 0,    ry: 0,     lum: 1,   st: 1 },   // 拉远、窗帘合上：谢幕
};
type Key = typeof K.home;
Object.assign(world.cam, K.home);
// 相邻两个关键帧之间的补间；lum 单独一条，可以用不同缓动（首页→引言时让房间“最后才亮起”）
const seg = (a: Key, b: Key, trigger: string, start: string, end: string, lumEase = 'none') => {
  const { lum: la, ...ra } = a, { lum: lb, ...rb } = b;
  const st = { trigger, start, end, scrub: 0.8 };
  gsap.fromTo(world.cam, { ...ra }, { ...rb, ease: 'none', immediateRender: false, scrollTrigger: st });
  gsap.fromTo(world.cam, { lum: la }, { lum: lb, ease: lumEase, immediateRender: false, scrollTrigger: { ...st } });
};
seg(K.home, K.intro, '#intro', 'top bottom', 'top top', 'power3.in');   // 招牌飞过镜头的同一段滚动里，房间从黑暗中浮现
seg(K.intro, K.introEnd, '#intro', 'top top', 'bottom bottom');          // 引言停留期间，雕像从地面升起
seg(K.introEnd, K.latest, '#latest', 'top bottom', 'top top');
seg(K.latest, K.featured, '#featured', 'top bottom', 'top top');
seg(K.featured, K.topics, '#topics', 'top bottom', 'top top');
seg(K.topics, K.more, '#more', 'top bottom', 'top top');   // 全景 → 正面收束（原 about 俯拍段随 about 一起移除；原 contact 段改名 more）

['intro', 'latest', 'featured', 'topics', 'more'].forEach((id) =>
  ScrollTrigger.create({ trigger: `#${id}`, start: 'top 50%', end: 'bottom 50%', toggleClass: { targets: `.bar a[href="#${id}"]`, className: 'on' } }));

// 3) 招牌：三层 —— .sign（滚动飞行）→ .cam（开场镜头姿态/对焦）→ canvas（指针视差）
//    静止姿态：靠左对齐瑞士网格，略高于视觉中心，带轻微 3D 倾斜（左近右远）。
//    退场：不再停靠。随滚动朝镜头飞来、放大、虚化、抽搐断电，最后从屏幕上方穿过去，同一段滚动里房间亮起、引言接上。
const sign = $('.sign'), cam = $('.sign .cam'), cv = $<HTMLCanvasElement>('.sign canvas'), wrap = $('#neon'), brand = $('.brand');
const POSE = { rotationY: 11, rotationX: 3, rotation: -2.5, scale: 1, x: 0 };   // 静止镜头姿态，想改倾斜感就调这里
const rest = () => {
  const w = sign.offsetWidth, h = sign.offsetHeight, m = (24 / 868) * w, pad = Math.max(16, innerWidth * 0.03);   // 24/868：画布四周为辉光预留的边距
  return innerWidth < 720
    ? { x: (innerWidth - w) / 2, y: innerHeight * 0.4 - h / 2 }
    : { x: pad - m, y: innerHeight * 0.46 - h / 2 };
};
gsap.set(sign, { transformPerspective: 1400, transformOrigin: '50% 50%', autoAlpha: 1 });
gsap.set(cam, { transformPerspective: 1100, transformOrigin: '50% 50%', ...POSE });
gsap.set(cv, { transformPerspective: 900 });

let gone = false;
const setGone = (g: boolean) => { if (g === gone) return; gone = g; gsap.set(sign, { autoAlpha: g ? 0 : 1 }); neon.pause(g); };
const flightTrigger = (onUpdate: (s: ScrollTrigger) => void) => ({ trigger: '#intro', start: 'top bottom', end: 'top top', scrub: 0.6, invalidateOnRefresh: true, onUpdate });

if (reduce) {
  gsap.timeline({ scrollTrigger: flightTrigger((s) => brand.classList.toggle('on', s.progress > 0.6)) })
    .fromTo(sign, { x: () => rest().x, y: () => rest().y }, { x: () => rest().x, y: () => rest().y, duration: 1, ease: 'none' }, 0)
    .fromTo(sign, { autoAlpha: 1 }, { autoAlpha: 0, duration: 0.4, ease: 'none' }, 0.3);
} else {
  gsap.timeline({ defaults: { duration: 1, ease: 'none' }, scrollTrigger: flightTrigger((s) => {
      const p = s.progress;
      setGone(p > 0.985);
      brand.classList.toggle('on', p > 0.85);
      cv.style.imageRendering = p > 0.25 ? 'auto' : 'pixelated';
    }) })
    .fromTo(sign, { x: () => rest().x }, { x: () => rest().x - innerWidth * 0.1, ease: 'power2.in' }, 0)
    .fromTo(sign, { y: () => rest().y }, { y: () => rest().y - innerHeight * 0.55, ease: 'power3.in' }, 0)    // x、y 不同缓动 → 弧线
    .fromTo(sign, { scale: 1 }, { scale: 3.4, ease: 'power3.in' }, 0)
    .fromTo(sign, { rotationY: 0, rotationX: 0 }, { rotationY: -26, rotationX: 12, ease: 'power2.inOut' }, 0)  // 从招牌下方仰视掠过
    .fromTo(sign, { '--b2': '0px' }, { '--b2': '16px', duration: 0.65, ease: 'power2.in' }, 0.35)
    .fromTo(fx, { mv: 0 }, { mv: 1, duration: 0.7 }, 0.3)
    .fromTo(fx, { power: 1 }, { power: 0, duration: 0.35 }, 0.55)           // 抽搐着断电
    .fromTo(wrap, { '--wash': 1 }, { '--wash': 0, duration: 0.5 }, 0.45);   // 辉光随之退去
}

// 指针视差 + 待机时的轻微镜头漂移，让静止的招牌也有 3D 呼吸感
let mx = 0, my = 0;
addEventListener('pointermove', (e) => { mx = e.clientX / innerWidth - 0.5; my = e.clientY / innerHeight - 0.5; });
const q = (p: string) => gsap.quickTo(cv, p, { duration: 1.2, ease: 'power3' });
const qx = q('x'), qy = q('y'), qry = q('rotationY'), qrx = q('rotationX');
gsap.ticker.add((t) => {
  if (gone) return;
  qx(mx * -18); qy(my * -10);
  qry(mx * 6 + (reduce ? 0 : Math.sin(t * 0.45) * 1.6));
  qrx(my * -4 + (reduce ? 0 : Math.cos(t * 0.37) * 1.1));
});

// 4) 引言：逐词“点亮”。每个词先是霓虹红 + 辉光，再冷却成正文色，像灯管通电后稳定下来；
//    起点卡在招牌飞行的后半程，所以文字是在招牌熄灭的同时被点亮的
//    中文没有空格：按 Intl.Segmenter 的词切分（标点并入前一个词），不支持时退回逐字
const tokens = (text: string, lang: string): { word: string; space: boolean }[] => {
  if (!/[\u3400-\u9fff\uf900-\ufaff]/.test(text)) return text.split(/(\s+)/).filter(Boolean).map((w) => ({ word: w, space: /^\s+$/.test(w) }));
  const out: { word: string; space: boolean }[] = [];
  const Segmenter = (Intl as any).Segmenter;
  const parts: { segment: string; isWordLike?: boolean }[] = Segmenter
    ? [...new Segmenter(lang || 'zh-CN', { granularity: 'word' }).segment(text)]
    : Array.from(text, (c) => ({ segment: c, isWordLike: !/[\s\p{P}]/u.test(c) }));
  for (const { segment, isWordLike } of parts) {
    const space = /^\s+$/.test(segment), prev = out[out.length - 1];
    if (!space && !isWordLike && prev && !prev.space) prev.word += segment;   // “，。——”贴着前一个词，不单独亮起
    else out.push({ word: segment, space });
  }
  return out;
};
const lede = $('.lede');
if (!reduce) {
  const text = lede.textContent!.trim(), words: HTMLElement[] = [];
  lede.setAttribute('aria-label', text);
  lede.textContent = '';
  for (const { word, space } of tokens(text, lede.lang || document.documentElement.lang)) {
    if (space) { lede.append(' '); continue; }
    const s = document.createElement('span');
    s.className = 'w'; s.setAttribute('aria-hidden', 'true'); s.textContent = word;
    lede.append(s); words.push(s);
  }
  const per = 0.22, gap = (1 - per) / Math.max(words.length - 1, 1);   // 总时长归一化为 1，对应一段滚动
  gsap.fromTo(words,
    { opacity: 0.08, color: '#ff3a26', textShadow: '0 0 22px rgba(255,40,20,.95)' },
    { opacity: 1, color: '#f1eee6', textShadow: '0 0 0px rgba(255,40,20,0)', ease: 'none', duration: per, stagger: gap,
      scrollTrigger: { trigger: '#intro', start: 'top 45%', end: 'top -60%', scrub: 0.5 } });
  gsap.fromTo('.facts > div', { '--r': 0, opacity: 0 }, { '--r': 1, opacity: 1, ease: 'none', stagger: 0.3, duration: 0.6,
    scrollTrigger: { trigger: '#intro', start: 'top -25%', end: 'top -70%', scrub: 0.5 } });
}

// 5) 开场：计数 → 幕布上推，露出纯黑 → 镜头从斜侧方甩入对焦，灯管依次从黑暗中点亮 → 导航与元信息淡入
const count = $('.count'), n = { v: 0 };
const intro = gsap.timeline({ paused: true });
intro.to(n, { v: 100, duration: 2.2, ease: 'power2.inOut', onUpdate: () => (count.textContent = String(Math.round(n.v)).padStart(3, '0')) })
  .to('.loader', { yPercent: -100, duration: 1.1, ease: 'expo.inOut' }, '+=0.15')
  .add(() => neon.ignite(), '>-0.3')
  .fromTo(cam, { rotationY: 46, rotationX: 14, rotation: -13, scale: 1.2, x: innerWidth * 0.06 }, { ...POSE, duration: 3.4, ease: 'expo.out' }, '<')
  .fromTo(cam, { '--b1': '10px' }, { '--b1': '0px', duration: 2.6, ease: 'power2.out' }, '<')                // 对焦
  .fromTo(fx, { smear: 1, wob: 1.1 }, { smear: 0, wob: 0, duration: 3, ease: 'power2.out' }, '<')          // 拖影 / 扭曲逐渐消散
  .add(() => lenis?.start(), '<1.2')
  .from('.bar', { autoAlpha: 0, yPercent: -100, duration: 1, ease: 'expo.out' }, '<1.8')
  .from('.meta span', { autoAlpha: 0, y: 16, stagger: 0.1, duration: 1, ease: 'expo.out' }, '<0.2');
document.fonts.ready.then(() => {
  if (reduce || resumeY !== null) { intro.progress(1); neon.ignite(); } else intro.play();
  if (resumeY !== null) requestAnimationFrame(() => {
    lenis?.start();
    if (lenis) lenis.scrollTo(resumeY, { immediate: true, force: true }); else scrollTo(0, resumeY);
    ScrollTrigger.update();
  });
});

// 6) 列表行：分隔线逐行画出；悬停时地板亮起
ScrollTrigger.batch('.row', { start: 'top 92%', once: true,
  onEnter: (rows) => gsap.fromTo(rows, { '--r': 0 }, { '--r': 1, duration: 1.2, ease: 'expo.out', stagger: 0.07 }) });
document.querySelectorAll('.row').forEach((r) => {
  r.addEventListener('pointerenter', () => gsap.to(world.hover, { v: 1, duration: 0.4 }));
  r.addEventListener('pointerleave', () => gsap.to(world.hover, { v: 0, duration: 0.8 }));
});
