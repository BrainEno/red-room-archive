import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import { initScene, world } from './scene';
import { initNeon } from './neon';

gsap.registerPlugin(ScrollTrigger);
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
initScene(document.querySelector<HTMLCanvasElement>('#gl')!);
const neon = initNeon(document.querySelector<HTMLCanvasElement>('#neon canvas')!);

// 1) Smooth scroll；把滚动速度交给窗帘物理
if (!reduce) {
  const lenis = new Lenis({ lerp: 0.085 });
  lenis.on('scroll', (l: any) => { ScrollTrigger.update(); world.sv = l.velocity; });
  gsap.ticker.add((t) => lenis.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);
  document.querySelectorAll<HTMLAnchorElement>('a[href^="#"]').forEach((a) =>
    a.addEventListener('click', (e) => { const id = a.getAttribute('href')!; if (id.length > 1) { e.preventDefault(); lenis.scrollTo(id, { duration: 1.6 }); } }));
}

// 2) 镜头关键帧：home(霓虹) → works → music → video → about → contact
const ids = ['home', 'works', 'music', 'video', 'about', 'contact'];
const K = [
  { px: 0,    py: 2,   pz: 10,  lx: 1.2, ly: 1.6, lz: 0,  open: 0,    ry: -0.5, lum: 0.1, st: 0 },
  { px: -1.5, py: 1.7, pz: 5.5, lx: 2.4, ly: 1.7, lz: 0,  open: 0.35, ry: 0.4,  lum: 1, st: 1 },
  { px: -3,   py: 1.2, pz: 6,   lx: 0,   ly: 2.4, lz: -2, open: 0.15, ry: 1.5,  lum: 1, st: 1 },
  { px: 4,    py: 3.2, pz: 8,   lx: 1,   ly: 1.8, lz: 0,  open: 1,    ry: 2.2,  lum: 1, st: 1 },
  { px: 0.5,  py: 11,  pz: 1.5, lx: 0.5, ly: 0,   lz: 0,  open: 1,    ry: 2.6,  lum: 1, st: 1 },
  { px: 0,    py: 1.4, pz: 13,  lx: 0,   ly: 2.2, lz: 0,  open: 0,    ry: Math.PI * 2 - 0.5, lum: 1, st: 1 },
];
Object.assign(world.cam, K[0]);
ids.slice(1).forEach((id, i) => gsap.fromTo(world.cam, K[i], {
  ...K[i + 1], ease: 'none', immediateRender: false,
  scrollTrigger: { trigger: `#${id}`, start: 'top bottom', end: 'top top', scrub: 0.8 },
}));
ids.forEach((id) => ScrollTrigger.create({ trigger: `#${id}`, start: 'top 50%', end: 'bottom 50%', toggleClass: { targets: `.bar a[href="#${id}"]`, className: 'on' } }));

// 3) 招牌：居中大尺寸 → 斜向缩小 → 停靠左上角当 logo。此时雕像才从地面升起，二者互不遮挡
const sign = document.querySelector<HTMLElement>('.sign')!, wrap = document.querySelector<HTMLElement>('#neon')!;
const signCv = sign.querySelector('canvas')!;
const dock = () => {
  const w0 = sign.offsetWidth, h0 = sign.offsetHeight, dw = Math.min(Math.max(innerWidth * 0.16, 130), 230);
  const m = (24 / 868) * dw, pad = Math.max(16, innerWidth * 0.03);          // 24/868：画布四周为辉光预留的边距
  return { x0: (innerWidth - w0) / 2, y0: (innerHeight - h0) / 2, x1: pad - m, y1: 14 - m, s1: dw / w0 };
};
gsap.set(sign, { transformOrigin: '0 0', autoAlpha: 1 });
gsap.timeline({ defaults: { ease: 'none' }, scrollTrigger: {
  trigger: '#works', start: 'top bottom', end: 'top top', scrub: 0.7, invalidateOnRefresh: true,
  onUpdate: (s) => { signCv.style.imageRendering = s.progress > 0.45 ? 'auto' : 'pixelated'; sign.classList.toggle('docked', s.progress > 0.98); } } })
  .fromTo(sign, { x: () => dock().x0 }, { x: () => dock().x1, ease: 'power2.inOut' }, 0)   // x、y 用不同缓动 → 弧线感的斜向移动
  .fromTo(sign, { y: () => dock().y0 }, { y: () => dock().y1, ease: 'power3.inOut' }, 0)
  .fromTo(sign, { scale: 1 }, { scale: () => dock().s1, ease: 'power2.inOut' }, 0)
  .to(wrap, { '--wash': 0 }, 0);
const nx = gsap.quickTo(signCv, 'x', { duration: 1, ease: 'power3' }), ny = gsap.quickTo(signCv, 'y', { duration: 1, ease: 'power3' });
addEventListener('pointermove', (e) => { nx((e.clientX / innerWidth - 0.5) * -16); ny((e.clientY / innerHeight - 0.5) * -10); });

// 4) 开场：计数 → 幕布上推 → 房间微亮 + 镜头推进 → 招牌依次点亮（频闪）
const count = document.querySelector('.count')!, n = { v: 0 };
const intro = gsap.timeline({ paused: true });
intro.to(n, { v: 100, duration: 2.2, ease: 'power2.inOut', onUpdate: () => (count.textContent = String(Math.round(n.v)).padStart(3, '0')) })
  .to('.loader', { yPercent: -100, duration: 1.1, ease: 'expo.inOut' }, '+=0.15')
  .to(world.fade, { v: 1, duration: 2.4, ease: 'power2.inOut' }, '<0.2')
  .to(world.dolly, { v: 1, duration: 3.2, ease: 'expo.out' }, '<')
  .add(() => neon.ignite(), '<0.5')
  .from('.bar', { autoAlpha: 0, yPercent: -100, duration: 1, ease: 'expo.out' }, '<0.6')
  .from('.meta span', { autoAlpha: 0, y: 16, stagger: 0.1, duration: 1, ease: 'expo.out' }, '<');
document.fonts.ready.then(() => (reduce ? intro.progress(1) : intro.play()));

// 5) 列表行：分隔线逐行画出；悬停时地板亮起；音频行点击内联播放
ScrollTrigger.batch('.row', { start: 'top 92%', once: true,
  onEnter: (rows) => gsap.fromTo(rows, { '--r': 0 }, { '--r': 1, duration: 1.2, ease: 'expo.out', stagger: 0.07 }) });
document.querySelectorAll('.row').forEach((r) => {
  r.addEventListener('pointerenter', () => gsap.to(world.hover, { v: 1, duration: 0.4 }));
  r.addEventListener('pointerleave', () => gsap.to(world.hover, { v: 0, duration: 0.8 }));
});
const au = new Audio(); let cur: HTMLElement | null = null;
au.onended = () => cur?.classList.remove('play');
document.querySelectorAll<HTMLElement>('[data-audio]').forEach((el) => el.addEventListener('click', (e) => {
  e.preventDefault();
  if (cur === el && !au.paused) { au.pause(); el.classList.remove('play'); return; }
  cur?.classList.remove('play'); cur = el; au.src = el.dataset.audio!; au.play(); el.classList.add('play');
}));
