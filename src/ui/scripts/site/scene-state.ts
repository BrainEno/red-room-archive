/**
 * Lightweight, framework-free scene state shared with GSAP before Three.js is
 * loaded. Keeping this separate lets the first screen render without downloading
 * the 3D renderer or model.
 */
export const world = {
  cam: { px: 0, py: 2, pz: 10, lx: 0.3, ly: 1.6, lz: 0, open: 0, ry: -0.3, lum: 0, st: 0 },
  fade: { v: 0 }, dolly: { v: 0 }, hover: { v: 0 }, sv: 0,
};
