import gsap from 'gsap';

// 设计坐标：内容区 820×420；四周各留 P 的边距给辉光，避免被画布边缘裁切。
// 先烘焙到低分辨率缓冲（S 倍），再由 CSS 放大 → 像素化的电子霓虹质感。
const W = 820, H = 420, P = 24, S = 0.6;
const BW = Math.round((W + 2 * P) * S), BH = Math.round((H + 2 * P) * S);
type Ctx = CanvasRenderingContext2D;
const buf = () => Object.assign(document.createElement('canvas'), { width: BW, height: BH });
const poly = (c: Ctx, p: number[][], close = false) => { c.beginPath(); p.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); if (close) c.closePath(); c.stroke(); };
const F = (w: number, px: number) => `${w} ${px}px "Archivo Variable", Archivo, "Arial Black", Helvetica, sans-serif`;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

// 每组灯管独立闪烁；rate 越大越“不稳定”。delay 拉长：灯管一根一根从黑暗里亮起来。
const defs = [
  { delay: 0, rate: 1, draw: (c: Ctx) => {
    poly(c, [[498,112],[215,66],[150,84],[112,120],[70,200],[22,285],[34,302],[100,298],[160,232],[240,224],[292,176],[310,152],[430,152],[498,128]], true);
    poly(c, [[150,84],[170,122],[222,114],[262,150]]); poly(c, [[236,226],[262,196]]); } },
  { delay: .45, rate: 1, draw: (c: Ctx) => { c.save(); c.translate(26, 130); c.rotate(-.17); c.font = 'italic 700 60px "Snell Roundhand","Brush Script MT","Segoe Script",cursive'; c.strokeText('The', 0, 0); c.restore(); } },
  { delay: .9, rate: .7, draw: (c: Ctx) => { c.font = F(800, 150); c.strokeText('BAR', 258, 312); } },
  { delay: 1.45, rate: 1, draw: (c: Ctx) => { poly(c, [[520,118],[806,34]]); poly(c, [[520,128],[812,186]]); poly(c, [[520,146],[790,372]]); } },
  { delay: 1.9, rate: 1.6, draw: (c: Ctx) => { c.font = F(400, 64); c.textAlign = 'right'; c.strokeText('BANG', 806, 146); } },
  { delay: 2.3, rate: 2.4, draw: (c: Ctx) => { c.font = F(400, 68); c.textAlign = 'right'; c.strokeText('BANG', 806, 240); } },
];
const hash = (n: number) => { const x = Math.sin(n * 127.1) * 43758.5453; return x - Math.floor(x); };

function bake(draw: (c: Ctx) => void) {
  const mk = (f: (c: Ctx) => void) => { const b = buf(), c = b.getContext('2d')!; c.scale(S, S); c.translate(P, P); c.lineJoin = c.lineCap = 'round'; f(c); return b; };
  return {
    glow: mk((c) => { c.strokeStyle = '#ff2414'; c.shadowColor = '#ff1a0a'; c.shadowBlur = 16; c.lineWidth = 8; draw(c); draw(c); }),
    core: mk((c) => { c.strokeStyle = '#ff5a3a'; c.lineWidth = 3.6; draw(c); c.strokeStyle = '#ffe6d4'; c.lineWidth = 1.3; draw(c); }),
    ghost: mk((c) => { c.strokeStyle = '#5a1a14'; c.lineWidth = 3.4; draw(c); }),   // 熄灭的玻璃管：暗红的一道轮廓
  };
}

export function initNeon(cv: HTMLCanvasElement) {
  cv.width = BW; cv.height = BH;
  const ctx = cv.getContext('2d')!; ctx.imageSmoothingEnabled = false;
  const frame = buf(), fc = frame.getContext('2d')!;      // 先合成到离屏帧，再带特效地贴到可见画布
  const wrap = cv.closest('.neon') as HTMLElement;
  /**
   * 供 main.ts 用 GSAP 补间的“镜头特效”：
   * power  整体电源 1→0（飞过镜头时灯牌抽搐着断电）
   * smear  开场镜头甩动的拖影（方向性残影）
   * wob    水平扫描线错位抖动（图里那种扭曲拉丝的质感）
   * mv     滚动飞行时的运动模糊（和 smear/wob 取最大值）
   */
  const fx = { power: 1, smear: 0, wob: 0, mv: 0 };
  let t0 = -1, lastLvl = -1, paused = false, groups: any[] = [], lamps: HTMLCanvasElement;

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
    if (e < 1.3) { const r = hash(Math.floor(e * 18) + g.seed), ramp = .3 + .7 * Math.min(1, e / 1.3); return r > .45 ? (.25 + .75 * r) * ramp : .03; }   // 点亮时的频闪，亮度逐步爬升
    if (t > g.next) { g.until = t + .05 + Math.random() * .14; g.dbl = Math.random() < .5; g.next = t + (1.5 + Math.random() * 7) / g.rate; }
    const dark = t < g.until && (!g.dbl || ((t * 28) | 0) % 2 === 0);                                     // 掉电 / 双闪
    return (dark ? .08 : 1) * (.94 + .06 * Math.sin(t * 110 + g.seed));                                    // 交流嗡鸣
  };
  const surge = (t: number) => { const p = t % 13; return p > 12.4 ? .35 + .4 * hash(Math.floor(t * 30)) : 1; }; // 整体电压骤降

  // 把离屏帧贴到可见画布；wob>0 时按水平条带错位，形成扭曲拉丝
  const blit = (t: number, dx: number, dy: number, alpha: number, wob: number) => {
    ctx.globalAlpha = alpha;
    const ox = Math.round(dx), oy = Math.round(dy);
    if (wob < .02) { ctx.drawImage(frame, ox, oy); return; }
    const strip = 5;
    for (let y = 0; y < BH; y += strip) {
      const h = Math.min(strip, BH - y);
      const w = Math.round((Math.sin(y * .11 + t * 8) * 4 + Math.sin(y * .037 - t * 3) * 6) * wob);
      ctx.drawImage(frame, 0, y, BW, h, ox + w, oy + y, BW, h);
    }
  };

  gsap.ticker.add(() => {
    if (paused || !groups.length) return;
    const t = performance.now() / 1000, sg = surge(t), pw = fx.power;
    // 断电时的抽搐：电源在 0~1 之间时亮度随机塌陷
    const stutter = pw > .005 && pw < .995 ? (hash(Math.floor(t * 20) + 3) > .38 ? 1 : .25) : 1;
    const master = pw * stutter;

    fc.globalCompositeOperation = 'source-over'; fc.clearRect(0, 0, BW, BH);
    fc.globalCompositeOperation = 'lighter';
    let sum = 0;
    for (const g of groups) {
      const a = level(g, t) * sg * master; sum += a;
      const gh = t0 > 0 ? clamp01((t - t0 - g.delay + .6) / .6) : 0;   // 点亮前 0.6s，灯管轮廓先在黑暗里隐约浮现
      if (gh > 0 && a < 1) { fc.globalAlpha = gh * (1 - Math.min(1, a)) * .5 * pw; fc.drawImage(g.ghost, 0, 0); }
      if (a < .02) continue;
      fc.globalAlpha = a * .85; fc.drawImage(g.glow, 0, 0);
      fc.globalAlpha = a; fc.drawImage(g.core, 0, 0);
    }
    if (t0 > 0 && t - t0 > 1.2) { fc.globalAlpha = .9 * master; fc.drawImage(lamps, 0, 0); }
    fc.globalAlpha = 1;

    const sm = Math.max(fx.smear, fx.mv), wb = Math.max(fx.wob, fx.mv * .8);
    ctx.globalCompositeOperation = 'source-over'; ctx.clearRect(0, 0, BW, BH);
    ctx.globalCompositeOperation = 'lighter';
    blit(t, 0, 0, 1, wb);
    if (sm > .02) [.5, .34, .22, .12].forEach((al, i) => blit(t, -sm * (i + 1) * 3.4, sm * (i + 1) * 1.4, al * Math.min(1, sm), wb));   // 沿镜头甩动方向的残影
    ctx.globalAlpha = 1;

    const lvl = sum / groups.length;
    if (Math.abs(lvl - lastLvl) > .02) { wrap.style.setProperty('--lvl', lvl.toFixed(2)); lastLvl = lvl; }
  });

  return {
    ignite: () => { t0 = performance.now() / 1000; },
    pause: (v: boolean) => { paused = v; if (v) { ctx.clearRect(0, 0, BW, BH); wrap.style.setProperty('--lvl', '0'); lastLvl = 0; } },
    fx,
  };
}
