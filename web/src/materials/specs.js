// Material spec grammar: named colour ramps, a seeded random generator that
// fills the Texture Room wall with plausible materials, and converters
// between specs and the flat Material Lab control values.
//
// Spec shape (consumed by MaterialBaker):
// { name, seed, layers: [{ gen, scale, octaves, lacunarity, gain, blend, amount, seed }],
//   ramp: [[t, '#hex'], ...], roughnessBase, roughnessContrast, normalStrength }

export const RAMPS = {
  basalt:    [[0, '#0b0b0e'], [0.45, '#26262c'], [0.75, '#4a4a52'], [1, '#8a8a90']],
  rust:      [[0, '#1d0f08'], [0.35, '#5c2c12'], [0.65, '#a0522d'], [0.85, '#c97b3d'], [1, '#e8b06a']],
  ice:       [[0, '#0a1a28'], [0.4, '#2c5a78'], [0.7, '#7ab2cc'], [1, '#e8f6ff']],
  sandstone: [[0, '#3a2a18'], [0.4, '#7a5a34'], [0.7, '#b08a54'], [1, '#e0c495']],
  moss:      [[0, '#101a0a'], [0.4, '#2a4018'], [0.7, '#4a6a28'], [1, '#8aa050']],
  steel:     [[0, '#14161a'], [0.5, '#3e444c'], [0.8, '#7a828c'], [1, '#c4ccd6']],
  clay:      [[0, '#2e1a14'], [0.45, '#6e4030'], [0.75, '#a06a50'], [1, '#d0a482']],
  obsidian:  [[0, '#050508'], [0.6, '#16141e'], [0.85, '#2e2a40'], [1, '#5a5478']],
  bone:      [[0, '#4a4238'], [0.4, '#8a8070'], [0.7, '#c0b8a4'], [1, '#efe8d8']],
  walnut:    [[0, '#1a0e06'], [0.35, '#3e2410'], [0.65, '#6a4420'], [0.85, '#8a5c30'], [1, '#b08048']],
  nebula:    [[0, '#06040f'], [0.3, '#1e1048'], [0.55, '#5a2080'], [0.8, '#c05090'], [1, '#ffd0a0']],
  copper:    [[0, '#14100c'], [0.4, '#4a2e1c'], [0.7, '#9a5c34'], [0.88, '#d08850'], [1, '#68c0a8']],
  lichen:    [[0, '#242820'], [0.4, '#4a5038'], [0.65, '#788858'], [0.85, '#a8b880'], [1, '#e0e8c0']],
}

const GENS = ['value', 'perlin', 'worley', 'worleyEdge', 'fbm', 'ridged', 'warp', 'stripes', 'checker']
const BLENDS = ['add', 'mul', 'overlay', 'screen', 'mix', 'max']

// deterministic PRNG so a wall seed reproduces exactly (mulberry32)
export function rng(seed) {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const pick = (r, arr) => arr[Math.floor(r() * arr.length) % arr.length]
const range = (r, lo, hi) => lo + r() * (hi - lo)

// families constrain the grammar so rerolls are usually plausible rather
// than uniform noise soup: each names a base generator, detail overlays
// and the ramps that suit it
const FAMILIES = [
  { name: 'rock', bases: ['fbm', 'ridged', 'warp', 'billow', 'terrace'], details: ['worleyEdge', 'ridged', 'cracks', 'craters', 'value'], ramps: ['basalt', 'sandstone', 'clay', 'obsidian'], rough: [0.75, 1] },
  { name: 'metal', bases: ['fbm', 'stripes', 'value', 'hex'], details: ['worleyEdge', 'stripes', 'dots', 'cracks', 'perlin'], ramps: ['steel', 'rust', 'copper', 'obsidian'], rough: [0.25, 0.7] },
  { name: 'organic', bases: ['warp', 'fbm', 'worley', 'scales', 'swirl'], details: ['worley', 'ridged', 'scales', 'caustics', 'perlin'], ramps: ['moss', 'bone', 'clay', 'lichen'], rough: [0.6, 0.95] },
  { name: 'ice', bases: ['worley', 'warp', 'ridged', 'caustics'], details: ['worleyEdge', 'cracks', 'marble', 'fbm'], ramps: ['ice', 'obsidian', 'bone'], rough: [0.1, 0.45] },
  { name: 'built', bases: ['checker', 'stripes', 'value', 'hex', 'truchet'], details: ['fbm', 'worleyEdge', 'dots'], ramps: ['basalt', 'steel', 'sandstone', 'clay'], rough: [0.5, 0.9] },
  { name: 'wood', bases: ['wood', 'marble', 'stripes'], details: ['fbm', 'cracks', 'value'], ramps: ['walnut', 'clay', 'bone'], rough: [0.45, 0.85] },
  { name: 'cosmic', bases: ['julia', 'plasma', 'swirl', 'warp'], details: ['caustics', 'billow', 'dots', 'simplex'], ramps: ['nebula', 'obsidian', 'ice', 'copper'], rough: [0.3, 0.8] },
  { name: 'desert', bases: ['terrace', 'ridged', 'craters', 'billow'], details: ['craters', 'cracks', 'fbm', 'dots'], ramps: ['sandstone', 'rust', 'clay', 'bone'], rough: [0.7, 1] },
]

export function randomSpec(seed) {
  const r = rng(seed)
  const family = pick(r, FAMILIES)
  const rampName = pick(r, family.ramps)
  const layers = [{
    gen: pick(r, family.bases),
    scale: range(r, 2, 10), octaves: 3 + Math.floor(r() * 4),
    lacunarity: range(r, 1.8, 2.4), gain: range(r, 0.4, 0.6),
    blend: 'mix', amount: 1, seed: r() * 100,
  }]
  const detailCount = 1 + Math.floor(r() * 2)
  for (let i = 0; i < detailCount; i++) {
    layers.push({
      gen: pick(r, family.details),
      scale: range(r, 8, 32), octaves: 2 + Math.floor(r() * 3),
      lacunarity: range(r, 1.8, 2.4), gain: range(r, 0.4, 0.6),
      blend: pick(r, ['overlay', 'add', 'mul', 'mix', 'max']),
      amount: range(r, 0.15, 0.55), seed: r() * 100,
    })
  }
  return {
    name: `${family.name}-${seed % 1000}`,
    seed,
    rampName,
    layers,
    ramp: RAMPS[rampName],
    roughnessBase: range(r, family.rough[0], family.rough[1]),
    roughnessContrast: range(r, -0.4, 0.5),
    normalStrength: range(r, 0.4, 2.2),
  }
}

export function randomWall(count = 32, wallSeed = 1) {
  return Array.from({ length: count }, (_, i) => randomSpec(wallSeed * 7919 + i * 104729 + 13))
}

// Material Lab flat control values -> spec (layer 1's blend is ignored)
export function specFromLab(v, prev) {
  const layers = []
  for (let i = 1; i <= 4; i++) {
    if (!v[`l${i}on`]) continue
    const keep = prev?.layers?.[layers.length]
    layers.push({
      gen: v[`l${i}gen`], scale: v[`l${i}scale`], octaves: v[`l${i}octaves`],
      lacunarity: keep?.lacunarity ?? 2, gain: keep?.gain ?? 0.5,
      blend: layers.length === 0 ? 'mix' : v[`l${i}blend`],
      amount: v[`l${i}amount`], seed: keep?.seed ?? i * 7.7,
    })
  }
  if (layers.length === 0) layers.push({ gen: 'fbm', scale: 6, octaves: 4, lacunarity: 2, gain: 0.5, blend: 'mix', amount: 1, seed: 7.7 })
  return {
    name: v.matName || 'material',
    seed: prev?.seed ?? 1,
    rampName: v.ramp,
    layers,
    ramp: RAMPS[v.ramp] || RAMPS.basalt,
    roughnessBase: v.roughnessBase,
    roughnessContrast: v.roughnessContrast,
    normalStrength: v.normalStrength,
  }
}

// spec -> flat control values (for loading a picked panel into the editor)
export function labFromSpec(spec) {
  const v = {
    matName: spec.name,
    ramp: spec.rampName || 'basalt',
    roughnessBase: spec.roughnessBase,
    roughnessContrast: spec.roughnessContrast,
    normalStrength: spec.normalStrength,
  }
  for (let i = 1; i <= 4; i++) {
    const layer = spec.layers[i - 1]
    v[`l${i}on`] = !!layer
    v[`l${i}gen`] = layer?.gen ?? 'fbm'
    v[`l${i}scale`] = layer?.scale ?? 6
    v[`l${i}octaves`] = layer?.octaves ?? 4
    v[`l${i}amount`] = layer?.amount ?? 0.5
    v[`l${i}blend`] = (i === 1 ? 'mix' : layer?.blend) ?? 'mix'
  }
  return v
}

const STORE_KEY = 'render.userMaterials'

export function loadUserMaterials() {
  try {
    const raw = window.localStorage.getItem(STORE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export function saveUserMaterial(spec) {
  const all = loadUserMaterials().filter((m) => m.name !== spec.name)
  all.unshift(spec)
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(all.slice(0, 16)))
  } catch {
    // quota: drop silently, the wall copy still exists this session
  }
  return all.slice(0, 16)
}
