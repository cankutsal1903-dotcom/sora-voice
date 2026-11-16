// Positions are relative to the scene width; six authored poses form each gift's story.
export const GIFT_EFFECT_PHASES = [0, 0.16, 0.34, 0.56, 0.8, 1];

const scene = (color, accent, motion, particles, hero, extra = {}) => ({
  color, accent, motion, particles, hero, duration: 2900, ...extra,
});

export const GIFT_EFFECT_RECIPES = {
  minik_kalp: scene("#FF5D91", "#FFD5E8", "heartbeat", "hearts", {
    x: [0, 0, 0, 0, 0, 0], y: [0.14, 0, -0.02, 0, -0.04, -0.12],
    scale: [0.15, 1.05, 0.9, 1.17, 1, 0.76], rotate: [-9, 0, -3, 3, 0, 0],
  }, { rings: 2, count: 10 }),
  gulumseme: scene("#FFBD4A", "#FFF1A7", "bounce", "confetti", {
    x: [-0.09, 0.02, -0.02, 0.02, 0, 0], y: [0.22, -0.08, 0.03, -0.05, 0, -0.03],
    scale: [0.3, 1.15, 0.95, 1.05, 1, 0.75], rotate: [-24, 11, -9, 5, 0, 0],
  }),
  kahve_molasi: scene("#D59865", "#FFF0D2", "steam", "steam", {
    x: [-0.1, 0, 0, 0, 0, 0], y: [0.16, 0, 0, -0.01, 0, 0.02],
    scale: [0.45, 1.03, 1, 1, 1, 0.92], rotate: [-12, 2, 0, 0, 0, 0],
  }, { count: 7, duration: 3200 }),
  renkli_balon: scene("#62B8FF", "#FFA4D0", "balloons", "bubbles", {
    x: [-0.05, 0.04, -0.04, 0.03, -0.02, 0.04], y: [0.52, 0.15, 0, -0.1, -0.24, -0.64],
    scale: [0.6, 0.9, 1, 1, 0.97, 0.8], rotate: [-10, 7, -6, 5, -4, 2],
  }, { count: 10, duration: 3400 }),
  sans_kurabiyesi: scene("#EDAC42", "#FFF1A8", "fortune", "diamonds", {
    x: [0, 0, -0.01, 0.01, 0, 0], y: [0.1, 0, 0, -0.04, -0.03, -0.1],
    scale: [0.2, 0.97, 1.12, 0.96, 1, 0.8], rotate: [-20, 0, -8, 8, 0, 0],
  }, { beams: true, count: 12 }),
  parilti: scene("#6AE8FF", "#FFF5C2", "prism", "stars", {
    x: [0, 0, 0, 0, 0, 0], y: [0.08, 0, -0.02, -0.02, 0, -0.08],
    scale: [0.05, 0.9, 1.12, 0.98, 1.04, 0.4], rotate: [-50, -8, 6, -6, 0, 24],
  }, { rings: 1, count: 16 }),
  ucan_opucuk: scene("#FC6C9D", "#FFCCE1", "kiss", "hearts", {
    x: [-0.34, -0.12, 0.02, 0.1, 0.22, 0.6], y: [0.13, -0.04, 0, -0.04, -0.13, -0.35],
    scale: [0.35, 0.85, 1.08, 1, 0.9, 0.45], rotate: [-20, -10, 4, -3, 8, 20],
  }, { count: 11 }),
  tatli_kedi: scene("#B19AFF", "#FFD5EC", "kitten", "paws", {
    x: [-0.2, 0, 0.03, -0.03, 0, 0.07], y: [0.24, 0, -0.09, 0.02, 0, 0.03],
    scale: [0.3, 1, 1.06, 0.97, 1, 0.9], rotate: [-17, 0, 8, -8, 0, 8],
  }, { count: 8, duration: 3100 }),
  dinleyici_destegi: scene("#57D5F2", "#C0F9FF", "listening", "notes", {
    x: [0, 0, 0, 0, 0, 0], y: [0.15, 0, -0.02, 0.01, -0.01, 0],
    scale: [0.3, 1, 1.06, 1, 1.04, 0.85], rotate: [0, -6, 6, -6, 4, 0],
  }, { rings: 3, count: 8 }),
  soz_sende: scene("#62CAFF", "#E3F9FF", "speech", "notes", {
    x: [-0.26, -0.04, 0, 0, 0, 0.05], y: [0.22, 0.02, -0.03, 0, -0.02, -0.16],
    scale: [0.3, 0.9, 1.08, 1, 1.03, 0.8], rotate: [-25, -5, 0, 0, 0, 10],
  }, { rings: 2, equalizer: true, count: 8 }),
  alkis_yagmuru: scene("#81B9FF", "#FFE393", "applause", "confetti", {
    x: [0, -0.02, 0.02, -0.02, 0, 0], y: [0.1, 0, -0.02, 0.01, 0, -0.04],
    scale: [0.2, 1.04, 0.96, 1.12, 1, 0.8], rotate: [-10, 8, -8, 8, 0, 0],
  }, { count: 18, rings: 2 }),
  sahne_isigi: scene("#FFD772", "#FFF8DB", "spotlight", "stars", {
    x: [0, 0, 0, 0, 0, 0], y: [0.08, 0, -0.01, -0.01, 0, 0],
    scale: [0.4, 0.95, 1, 1.02, 1, 0.9], rotate: [-12, -8, 8, -8, 8, 0],
  }, { beams: true, count: 8, duration: 3300 }),
  mikrofon_yildizi: scene("#8AA9FF", "#FFE596", "micstar", "stars", {
    x: [0, 0, -0.02, 0.02, 0, 0], y: [0.22, 0, -0.06, -0.02, -0.04, -0.2],
    scale: [0.2, 1, 1.08, 1, 1.02, 0.6], rotate: [-15, 0, -4, 4, 0, 12],
  }, { rings: 2, count: 12 }),
  dj_seti: scene("#B58BFF", "#62F8E6", "decks", "notes", {
    x: [0, 0, 0, 0, 0, 0], y: [0.22, 0, -0.02, 0.02, -0.02, 0],
    scale: [0.3, 1, 1.07, 0.98, 1.07, 0.9], rotate: [-8, 0, -5, 5, -3, 0],
  }, { equalizer: true, count: 14, duration: 3400 }),
  konusma_taci: scene("#FFD266", "#94DFFF", "voicecrown", "diamonds", {
    x: [0, 0, 0, 0, 0, 0], y: [-0.4, -0.08, 0, -0.02, 0, -0.08],
    scale: [0.5, 0.95, 1, 1.06, 1, 0.9], rotate: [-10, 2, 0, 0, 0, 0],
  }, { rings: 2, equalizer: true, count: 10 }),
  oda_yildizi: scene("#78AAFF", "#FFF1A1", "roomstar", "stars", {
    x: [-0.24, 0, 0, 0, 0, 0], y: [-0.28, 0, -0.03, 0, -0.02, -0.16],
    scale: [0.1, 1.1, 0.96, 1.12, 1, 0.6], rotate: [-150, 0, -8, 8, 0, 22],
  }, { beams: true, count: 16 }),
  gul_buketi: scene("#FF75A5", "#FFDCB3", "bouquet", "petals", {
    x: [-0.1, 0, 0.015, -0.015, 0, 0], y: [0.35, 0, -0.03, -0.02, 0, -0.05],
    scale: [0.35, 1, 1.05, 1, 1.02, 0.88], rotate: [-16, 0, 4, -4, 0, 5],
  }, { count: 16, duration: 3400 }),
  neon_mikrofon: scene("#25F0E0", "#80A6FF", "neon", "diamonds", {
    x: [0, 0, 0, 0, 0, 0], y: [0.15, 0, -0.02, 0, -0.02, -0.12],
    scale: [0.2, 1.02, 0.98, 1.08, 1, 0.72], rotate: [-12, 0, -3, 3, 0, 10],
  }, { rings: 3, equalizer: true, count: 12, duration: 3300 }),
  disko_topu: scene("#C5A0FF", "#8CFFED", "disco", "diamonds", {
    x: [0, 0, 0, 0, 0, 0], y: [-0.5, -0.06, -0.03, 0, -0.03, -0.08],
    scale: [0.4, 0.95, 1, 1.03, 1, 0.75], rotate: [-30, 0, 45, 90, 140, 180],
  }, { beams: true, count: 18, duration: 3600 }),
  ay_isigi: scene("#A8BEFF", "#FFF0C1", "moon", "stars", {
    x: [-0.1, -0.04, 0, 0.02, 0.04, 0.1], y: [0.13, 0.02, -0.02, -0.04, -0.08, -0.18],
    scale: [0.45, 0.92, 1, 1.02, 1, 0.9], rotate: [-12, -7, -3, 0, 3, 7],
  }, { rings: 1, count: 10, duration: 3500 }),
  yildiz_yagmuru: scene("#FFE283", "#9AE7FF", "meteor", "stars", {
    x: [-0.55, -0.16, 0, 0.03, 0.1, 0.56], y: [-0.4, -0.1, 0, 0.01, 0.06, 0.35],
    scale: [0.2, 0.8, 1.1, 1, 0.92, 0.5], rotate: [-35, -15, 0, 5, 10, 25],
  }, { count: 18, duration: 3200 }),
  gokkusagi: scene("#8BDDFB", "#FFBCDA", "rainbow", "confetti", {
    x: [0, 0, 0, 0, 0, 0], y: [0.22, 0.03, 0, -0.02, -0.03, -0.08],
    scale: [0.1, 0.8, 1, 1.08, 1.02, 0.9], rotate: [-6, -2, 0, 2, 0, 0],
  }, { rainbow: true, count: 14, duration: 3500 }),
  kristal_kelebek: scene("#84F9EC", "#B8BBFF", "butterfly", "diamonds", {
    x: [-0.3, -0.08, 0.06, -0.05, 0.12, 0.42], y: [0.25, 0.05, -0.05, 0.02, -0.12, -0.45],
    scale: [0.3, 0.9, 1.05, 0.88, 1, 0.65], rotate: [-20, 12, -10, 10, -8, 20],
  }, { count: 14, duration: 3600 }),
  altin_tac: scene("#FFDF7D", "#FFF6CE", "goldcrown", "diamonds", {
    x: [0, 0, 0, 0, 0, 0], y: [-0.4, -0.06, 0, -0.04, -0.02, -0.1],
    scale: [0.45, 1, 1.08, 1, 1.04, 0.85], rotate: [-8, 2, 0, 0, 0, 0],
  }, { rings: 3, beams: true, count: 12, duration: 3500 }),
  ferrari: scene("#FF5C62", "#FFE3A0", "redrace", "speed", {
    x: [-0.95, -0.22, 0, 0.03, 0.22, 1.05], y: [0.1, 0.02, 0, 0.01, -0.02, -0.06],
    scale: [0.6, 1, 1.1, 1.08, 1, 0.8], rotate: [-4, 0, -2, 1, -3, -7],
  }, { count: 14, duration: 3100, wide: true }),
  lamborghini: scene("#FFE05A", "#96FFFF", "goldrace", "speed", {
    x: [0.98, 0.21, 0, -0.04, -0.18, -1.05], y: [0.04, 0, -0.03, 0, -0.04, -0.12],
    scale: [0.5, 0.96, 1.12, 1.05, 1.07, 0.75], rotate: [8, 2, 0, -2, -5, -10],
  }, { count: 16, duration: 3300, wide: true }),
  isik_selalesi: scene("#71F3FF", "#DCF9FF", "waterfall", "droplets", {
    x: [0, 0, 0, 0, 0, 0], y: [-0.24, -0.03, 0, 0, 0.02, 0.12],
    scale: [0.2, 0.9, 1, 1.04, 1, 0.9], rotate: [0, 0, 0, 0, 0, 0],
  }, { rings: 2, count: 18, duration: 3800 }),
  gokyuzu_treni: scene("#7BCFFF", "#FFE5A3", "skytrain", "clouds", {
    x: [-0.9, -0.24, -0.02, 0.04, 0.22, 0.95], y: [0.16, -0.03, -0.09, -0.08, -0.16, -0.32],
    scale: [0.4, 0.9, 1, 1.04, 0.98, 0.7], rotate: [-10, -5, 0, 0, -5, -12],
  }, { count: 12, duration: 3900, wide: true }),
  kraliyet_arabasi: scene("#FFD975", "#EAF3FF", "carriage", "diamonds", {
    x: [-0.8, -0.18, 0, 0.01, 0.12, 0.7], y: [0.1, 0.02, 0, -0.02, 0, -0.04],
    scale: [0.5, 0.95, 1.05, 1.03, 1, 0.8], rotate: [-3, 0, -2, 2, 0, -3],
  }, { rings: 2, count: 14, duration: 4000, wide: true }),
  kozmik_balina: scene("#69CDFF", "#B6A3FF", "whale", "bubbles", {
    x: [-0.65, -0.15, 0.02, 0.1, 0.24, 0.7], y: [0.22, -0.05, -0.13, -0.04, -0.08, -0.3],
    scale: [0.35, 0.9, 1.1, 1.03, 0.98, 0.7], rotate: [-20, -8, 6, 12, 0, -18],
  }, { rings: 1, count: 16, duration: 4200, wide: true }),
  efsanevi_anka: scene("#FFAA52", "#FFE6A0", "phoenix", "embers", {
    x: [0, -0.02, 0.02, -0.02, 0, 0], y: [0.48, 0.06, -0.06, -0.1, -0.2, -0.6],
    scale: [0.18, 0.9, 1.16, 1, 1.1, 0.5], rotate: [-14, -6, 6, -4, 0, 0],
  }, { beams: true, count: 18, duration: 4200 }),
  elmas_aslan: scene("#9AEFFF", "#FFF0BE", "lion", "diamonds", {
    x: [0, 0, -0.01, 0.01, 0, 0], y: [0.25, 0, -0.03, 0.01, -0.02, -0.06],
    scale: [0.35, 1, 1.13, 0.98, 1.08, 0.85], rotate: [-6, 0, -3, 3, 0, 0],
  }, { rings: 4, count: 18, duration: 4100 }),
  yildiz_gemisi: scene("#65D8FF", "#D8C0FF", "spaceship", "stars", {
    x: [-0.3, -0.08, 0, 0.01, 0.08, 0.45], y: [0.48, 0.08, 0, -0.04, -0.22, -0.85],
    scale: [0.25, 0.85, 1.08, 1, 0.9, 0.16], rotate: [-18, -6, 0, 0, 8, 24],
  }, { count: 18, beams: true, duration: 4200 }),
  kraliyet_sahnesi: scene("#FFDD89", "#ABC9FF", "royalstage", "confetti", {
    x: [0, 0, 0, 0, 0, 0], y: [0.12, 0.03, 0, -0.01, 0, 0],
    scale: [0.25, 0.82, 1, 1.05, 1.02, 0.92], rotate: [0, 0, 0, 0, 0, 0],
  }, { curtains: true, beams: true, rings: 2, count: 18, duration: 4400, wide: true }),
};

export const FALLBACK_GIFT_EFFECT = scene("#83B7FF", "#FFFFFF", "prism", "stars", {
  x: [0, 0, 0, 0, 0, 0], y: [0.14, 0, -0.02, 0, -0.04, -0.1],
  scale: [0.2, 1, 1.05, 1, 1, 0.8], rotate: [-8, 0, -3, 3, 0, 0],
}, { count: 10 });
