import gsap from 'gsap';

// 设计坐标：内容区 820×420；四周各留 P 的边距给辉光，避免被画布边缘裁切（之前 G 被切掉就是这个原因）。
// 先烘焙到低分辨率缓冲（S 倍），再由 CSS 放大 → 像素化的电子霓虹质感。
const W = 820, H = 420, P = 24, S = 0.6;
const BW = Math.round((W + 2 * P) * S), BH = Math.round((H + 2 * P) * S);
type Ctx = CanvasRenderingContext2D;
const buf = () => Object.assign(document.createElement('canvas'), { width: BW, height: BH });
const poly = (c: Ctx, p: number[][], close = false) => { c.beginPath(); p.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); if (close) c.closePath(); c.stroke(); };
const F = (w: number, px: number) => `${w} ${px}px Archivo, "Arial Black", Helvetica, sans-serif`;

// 每组灯管独立闪烁；rate 越大越“不稳定”。BANG 右对齐到 x=806，保证 G 完整。
const defs = [
  { delay: 0, rate: 1, draw: (c: Ctx) => {
    poly(c, [[498,112],[215,66],[150,84],[112,120],[70,200],[22,285],[34,302],[100,298],[160,232],[240,224],[292,176],[310,152],[430,152],[498,128]], true);
    poly(c, [[150,84],[170,122],[222,114],[262,150]]); poly(c, [[236,226],[262,196]]); } },
  { delay: .25, rate: 1, draw: (c: Ctx) => { c.save(); c.translate(26, 130); c.rotate(-.17); c.font = 'italic 700 60px "Snell Roundhand","Brush Script MT","Segoe Script",cursive'; c.strokeText('The', 0, 0); c.restore(); } },
  { delay: .5, rate: .7, draw: (c: Ctx) => { c.font = F(800, 150); c.strokeText('BAR', 258, 312); } },
  { delay: .8, rate: 1, draw: (c: Ctx) => { poly(c, [[520,118],[806,34]]); poly(c, [[520,128],[812,186]]); poly(c, [[520,146],[790,372]]); } },
  { delay: 1.05, rate: 1.6, draw: (c: Ctx) => { c.font = F(400, 64); c.textAlign = 'right'; c.strokeText('BANG', 806, 146); } },
  { delay: 1.25, rate: 2.4, draw: (c: Ctx) => { c.font = F(400, 68); c.textAlign = 'right'; c.strokeText('BANG', 806, 240); } },
];
const hash = (n: number) => { const x = Math.sin(n * 127.1) * 43758.5453; return x - Math.floor(x); };

function bake(draw: (c: Ctx) => void) {
  const mk = (f: (c: Ctx) => void) => { const b = buf(), c = b.getContext('2d')!; c.scale(S, S); c.translate(P, P); c.lineJoin = c.lineCap = 'round'; f(c); return b; };
  return {
    glow: mk((c) => { c.strokeStyle = '#ff2414'; c.shadowColor = '#ff1a0a'; c.shadowBlur = 16; c.lineWidth = 8; draw(c); draw(c); }),
    core: mk((c) => { c.strokeStyle = '#ff5a3a'; c.lineWidth = 3.6; draw(c); c.strokeStyle = '#ffe6d4'; c.lineWidth = 1.3; draw(c); }),
  };
}

export function initNeon(cv: HTMLCanvasElement) {
  cv.width = BW; cv.height = BH;
  const ctx = cv.getContext('2d')!; ctx.imageSmoothingEnabled = false;
  const wrap = cv.closest('.neon') as HTMLElement;
  let t0 = -1, lastLvl = -1, groups: any[] = [], lamps: HTMLCanvasElement;

  const init = () => {
    groups = defs.map((d, i) => ({ ...d, ...bake(d.draw), seed: i * 7.3, next: 0, until: 0, dbl: false }));
    lamps = buf(); const c = lamps.getContext('2d')!; c.scale(S, S); c.translate(P, P);
    [[200, 376], [238, 380], [612, 378], [650, 376]].forEach(([x, y]) => {         // 招牌下方两组壁灯：柔和径向光
      const g = c.createRadialGradient(x, y, 0, x, y, 18);
      g.addColorStop(0, 'rgba(255,240,205,1)'); g.addColorStop(.3, 'rgba(255,190,110,.55)'); g.addColorStop(1, 'rgba(255,120,40,0)');
      c.fillStyle = g; c.beginPath(); c.arc(x, y, 18, 0, 7); c.fill();
    });
  };
  Promise.all([document.fonts.load(F(800, 150)), document.fonts.load(F(400, 64))]).catch(() => {}).finally(init);

  const level = (g: any, t: number) => {
    const e = t - t0 - g.delay;
    if (t0 < 0 || e < 0) return 0;
    if (e < 1.2) { const r = hash(Math.floor(e * 18) + g.seed); return r > .45 ? .25 + .75 * r : .03; }   // 点亮时的频闪
    if (t > g.next) { g.until = t + .05 + Math.random() * .14; g.dbl = Math.random() < .5; g.next = t + (1.5 + Math.random() * 7) / g.rate; }
    const dark = t < g.until && (!g.dbl || ((t * 28) | 0) % 2 === 0);                                     // 掉电 / 双闪
    return (dark ? .08 : 1) * (.94 + .06 * Math.sin(t * 110 + g.seed));                                    // 交流嗡鸣
  };
  const surge = (t: number) => { const p = t % 13; return p > 12.4 ? .35 + .4 * hash(Math.floor(t * 30)) : 1; }; // 整体电压骤降

  gsap.ticker.add(() => {
    if (!groups.length) return;
    const t = performance.now() / 1000, sg = surge(t);
    ctx.globalCompositeOperation = 'source-over'; ctx.clearRect(0, 0, BW, BH);
    ctx.globalCompositeOperation = 'lighter';
    let sum = 0;
    for (const g of groups) {
      const a = level(g, t) * sg; sum += a;
      if (a < .02) continue;
      ctx.globalAlpha = a * .85; ctx.drawImage(g.glow, 0, 0);
      ctx.globalAlpha = a; ctx.drawImage(g.core, 0, 0);
    }
    if (t0 > 0 && t - t0 > .6) { ctx.globalAlpha = .9; ctx.drawImage(lamps, 0, 0); }
    ctx.globalAlpha = 1;
    const lvl = sum / groups.length;
    if (Math.abs(lvl - lastLvl) > .02) { wrap.style.setProperty('--lvl', lvl.toFixed(2)); lastLvl = lvl; }
  });
  return { ignite: () => { t0 = performance.now() / 1000; } };
}
