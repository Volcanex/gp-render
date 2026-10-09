import * as THREE from 'three'

// mulberry32: small, fast, seeded PRNG. Same seed => same byte-for-byte texture.
function mulberry32(seed) {
  let a = seed >>> 0
  return function rand() {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function makeCanvas(size) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(size, size)
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  return c
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function lerp(a, b, t) {
  return a + (b - a) * t
}

function smooth(t) {
  return t * t * (3 - 2 * t)
}

// Value-noise lattice generator. The lattice is tiled at `latSize` cells and
// sampled with wraparound (mod), so any fBm built from it tiles seamlessly
// regardless of octave count.
function makeLattice(rand, latSize) {
  const cells = latSize * latSize
  const g = new Float32Array(cells)
  for (let i = 0; i < cells; i++) g[i] = rand()
  return {
    size: latSize,
    sample(x, y) {
      const s = latSize
      const x0 = ((Math.floor(x) % s) + s) % s
      const y0 = ((Math.floor(y) % s) + s) % s
      const x1 = (x0 + 1) % s
      const y1 = (y0 + 1) % s
      const fx = x - Math.floor(x)
      const fy = y - Math.floor(y)
      const v00 = g[y0 * s + x0]
      const v10 = g[y0 * s + x1]
      const v01 = g[y1 * s + x0]
      const v11 = g[y1 * s + x1]
      const tx = smooth(fx)
      const ty = smooth(fy)
      return lerp(lerp(v00, v10, tx), lerp(v01, v11, tx), ty)
    },
  }
}

function makeFbm(rand, baseLatSize) {
  const octaves = [
    makeLattice(rand, baseLatSize),
    makeLattice(rand, baseLatSize * 2),
    makeLattice(rand, baseLatSize * 4),
    makeLattice(rand, baseLatSize * 8),
    makeLattice(rand, baseLatSize * 16),
  ]
  return function fbm(u, v, octaveCount = 5) {
    let sum = 0
    let amp = 0.5
    let total = 0
    for (let o = 0; o < octaveCount && o < octaves.length; o++) {
      const lat = octaves[o]
      sum += octaves[o].sample(u * lat.size, v * lat.size) * amp
      total += amp
      amp *= 0.5
    }
    return sum / total
  }
}

function finishTexture(canvas) {
  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.colorSpace = THREE.SRGBColorSpace
  tex.needsUpdate = true
  return tex
}

function paintPixels(canvas, size, fn) {
  const ctx = canvas.getContext('2d')
  const img = ctx.createImageData(size, size)
  const data = img.data
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, b] = fn(x, y)
      const i = (y * size + x) * 4
      data[i] = r
      data[i + 1] = g
      data[i + 2] = b
      data[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  return ctx
}

function genNoise(rand, size, scale, colorA, colorB) {
  const canvas = makeCanvas(size)
  const fbm = makeFbm(rand, Math.max(2, Math.round(4 * scale)))
  const a = hexToRgb(colorA)
  const b = hexToRgb(colorB)
  paintPixels(canvas, size, (x, y) => {
    const n = clamp01(fbm(x / size, y / size))
    return [lerp(a[0], b[0], n), lerp(a[1], b[1], n), lerp(a[2], b[2], n)]
  })
  return canvas
}

function genWood(rand, size, scale, colorA, colorB) {
  const canvas = makeCanvas(size)
  const fbm = makeFbm(rand, Math.max(2, Math.round(3 * scale)))
  const a = hexToRgb(colorA)
  const b = hexToRgb(colorB)
  const cx = 0.15 + rand() * 0.1
  const cy = 0.15 + rand() * 0.1
  const ringFreq = 24 * scale
  paintPixels(canvas, size, (x, y) => {
    const u = x / size
    const v = y / size
    const warp = fbm(u, v, 4)
    const dx = u - cx
    const dy = v - cy
    const dist = Math.sqrt(dx * dx + dy * dy) + warp * 0.06
    const rings = Math.sin(dist * ringFreq * Math.PI) * 0.5 + 0.5
    const grain = fbm(u * 3, v * 0.5, 3) * 0.15
    const n = clamp01(rings * 0.85 + grain)
    return [lerp(a[0], b[0], n), lerp(a[1], b[1], n), lerp(a[2], b[2], n)]
  })
  return canvas
}

function genMarble(rand, size, scale, colorA, colorB) {
  const canvas = makeCanvas(size)
  const fbm = makeFbm(rand, Math.max(2, Math.round(4 * scale)))
  const a = hexToRgb(colorA)
  const b = hexToRgb(colorB)
  const freq = 6 * scale
  paintPixels(canvas, size, (x, y) => {
    const u = x / size
    const v = y / size
    const turb = fbm(u, v, 5)
    const vein = Math.sin((u + turb * 1.4) * freq * Math.PI)
    const n = clamp01(0.5 + vein * 0.5)
    const sharp = Math.pow(n, 3)
    return [lerp(a[0], b[0], sharp), lerp(a[1], b[1], sharp), lerp(a[2], b[2], sharp)]
  })
  return canvas
}

function genBrick(rand, size, scale, colorA, colorB) {
  const canvas = makeCanvas(size)
  const fbm = makeFbm(rand, Math.max(2, Math.round(4 * scale)))
  const a = hexToRgb(colorA)
  const b = hexToRgb(colorB)
  const rows = Math.max(2, Math.round(6 * scale))
  const brickH = size / rows
  const bricksPerRow = Math.max(2, Math.round(4 * scale))
  const brickW = size / bricksPerRow
  const mortar = Math.max(1, size / 96)
  // per-brick jitter, keyed by row/col so identical bricks stay identical
  const jitter = new Map()
  const jitterFor = (row, col) => {
    const key = row * 1000 + col
    if (!jitter.has(key)) jitter.set(key, rand())
    return jitter.get(key)
  }
  paintPixels(canvas, size, (x, y) => {
    const row = Math.floor(y / brickH)
    const stagger = (row % 2) * (brickW / 2)
    const xs = x + stagger
    const col = Math.floor(xs / brickW)
    const localX = ((xs % brickW) + brickW) % brickW
    const localY = y - row * brickH
    const isMortar = localX < mortar || localX > brickW - mortar || localY < mortar || localY > brickH - mortar
    const u = x / size
    const v = y / size
    const mottle = fbm(u * 2, v * 2, 3) * 0.2
    if (isMortar) {
      const n = clamp01(0.12 + mottle * 0.3)
      return [lerp(a[0], b[0], n) * 0.4, lerp(a[1], b[1], n) * 0.4, lerp(a[2], b[2], n) * 0.4]
    }
    const j = jitterFor(row, col) * 0.35 - 0.15
    const n = clamp01(0.55 + j + mottle)
    return [lerp(a[0], b[0], n), lerp(a[1], b[1], n), lerp(a[2], b[2], n)]
  })
  return canvas
}

function genRust(rand, size, scale, colorA, colorB) {
  const canvas = makeCanvas(size)
  const fbmPatch = makeFbm(rand, Math.max(2, Math.round(3 * scale)))
  const fbmSpeckle = makeFbm(rand, Math.max(2, Math.round(10 * scale)))
  const a = hexToRgb(colorA)
  const b = hexToRgb(colorB)
  const threshold = 0.55
  paintPixels(canvas, size, (x, y) => {
    const u = x / size
    const v = y / size
    const patch = fbmPatch(u, v, 5)
    const speck = fbmSpeckle(u, v, 3) * 0.15
    const rustAmount = clamp01((patch + speck - threshold) / (1 - threshold))
    const n = Math.pow(rustAmount, 0.7)
    return [lerp(a[0], b[0], n), lerp(a[1], b[1], n), lerp(a[2], b[2], n)]
  })
  return canvas
}

function genGrid(rand, size, scale, colorA, colorB) {
  const canvas = makeCanvas(size)
  const fbm = makeFbm(rand, Math.max(2, Math.round(4 * scale)))
  const a = hexToRgb(colorA)
  const b = hexToRgb(colorB)
  const cell = Math.max(2, size / (16 * scale))
  const lineW = Math.max(1, cell / 16)
  paintPixels(canvas, size, (x, y) => {
    const u = x / size
    const v = y / size
    const mottle = fbm(u, v, 4) * 0.1
    const lx = ((x % cell) + cell) % cell
    const ly = ((y % cell) + cell) % cell
    const onLine = lx < lineW || ly < lineW
    const n = clamp01((onLine ? 0.85 : 0.15) + mottle)
    return [lerp(a[0], b[0], n), lerp(a[1], b[1], n), lerp(a[2], b[2], n)]
  })
  return canvas
}

// recursive rectangular panel split for sci-fi hull plating
function splitPanels(rand, x, y, w, h, minSize, out) {
  if (w < minSize * 2 && h < minSize * 2) {
    out.push({ x, y, w, h })
    return
  }
  const canSplitW = w >= minSize * 2
  const canSplitH = h >= minSize * 2
  const splitVertical = canSplitW && (!canSplitH || rand() < 0.5)
  if (splitVertical) {
    const t = 0.35 + rand() * 0.3
    const wa = w * t
    splitPanels(rand, x, y, wa, h, minSize, out)
    splitPanels(rand, x + wa, y, w - wa, h, minSize, out)
  } else if (canSplitH) {
    const t = 0.35 + rand() * 0.3
    const ha = h * t
    splitPanels(rand, x, y, w, ha, minSize, out)
    splitPanels(rand, x, y + ha, w, h - ha, minSize, out)
  } else {
    out.push({ x, y, w, h })
  }
}

function genPlates(rand, size, scale, colorA, colorB) {
  const canvas = makeCanvas(size)
  const fbm = makeFbm(rand, Math.max(2, Math.round(4 * scale)))
  const a = hexToRgb(colorA)
  const b = hexToRgb(colorB)
  const minSize = size / (5 * scale)
  const panels = []
  splitPanels(rand, 0, 0, size, size, minSize, panels)
  const panelValue = panels.map(() => rand() * 0.3 - 0.15)
  const rivets = []
  panels.forEach((p) => {
    const count = 1 + Math.floor(rand() * 3)
    for (let i = 0; i < count; i++) {
      if (rand() < 0.6) {
        rivets.push({
          x: p.x + p.w * (0.15 + rand() * 0.7),
          y: p.y + p.h * (0.15 + rand() * 0.7),
          r: Math.max(1, size / 128),
        })
      }
    }
  })
  const seam = Math.max(1, size / 128)
  paintPixels(canvas, size, (x, y) => {
    let panelIdx = -1
    for (let i = 0; i < panels.length; i++) {
      const p = panels[i]
      if (x >= p.x && x < p.x + p.w && y >= p.y && y < p.y + p.h) {
        panelIdx = i
        break
      }
    }
    const p = panels[panelIdx]
    const nearSeam =
      x - p.x < seam || p.x + p.w - x < seam || y - p.y < seam || p.y + p.h - y < seam
    let onRivet = false
    for (const rv of rivets) {
      const dx = x - rv.x
      const dy = y - rv.y
      if (dx * dx + dy * dy < rv.r * rv.r) {
        onRivet = true
        break
      }
    }
    const u = x / size
    const v = y / size
    const mottle = fbm(u, v, 4) * 0.12
    let n = clamp01(0.5 + panelValue[panelIdx] + mottle)
    if (nearSeam) n *= 0.35
    if (onRivet) n = clamp01(n + 0.3)
    return [lerp(a[0], b[0], n), lerp(a[1], b[1], n), lerp(a[2], b[2], n)]
  })
  return canvas
}

// flagship layered generator: several noise passes stacked to read as weathered rock
function genRock(rand, size, scale, colorA, colorB) {
  const canvas = makeCanvas(size)
  const fbmBase = makeFbm(rand, Math.max(2, Math.round(4 * scale))) // ridged base
  const fbmWarpX = makeFbm(rand, Math.max(2, Math.round(3 * scale))) // domain-warp offsets
  const fbmWarpY = makeFbm(rand, Math.max(2, Math.round(3 * scale)))
  const fbmCavity = makeFbm(rand, Math.max(2, Math.round(2 * scale))) // low-freq recess mask
  const speckleLat = makeLattice(rand, Math.max(4, Math.round((size / 3) * scale))) // fine grit
  const a = hexToRgb(colorA)
  const b = hexToRgb(colorB)
  const warpStrength = 0.18
  const strataFreq = 3 * scale
  paintPixels(canvas, size, (x, y) => {
    const u = x / size
    const v = y / size

    // a) domain warping: perturb the sample point before it hits the ridged
    // base, so ridges bend into geological flow instead of a regular grid.
    // The warp lattices wrap the same way the base lattice does, so the
    // perturbed lookup still tiles at the canvas edges.
    const wx = fbmWarpX(u, v, 3) - 0.5
    const wy = fbmWarpY(u + 0.37, v + 0.61, 3) - 0.5
    const wu = u + wx * warpStrength
    const wv = v + wy * warpStrength

    // b) ridged fBm: fold the base noise around its midpoint so it reads as
    // sharp creases instead of soft blobs.
    const base = fbmBase(wu, wv, 4)
    const ridged = 1 - Math.abs(2 * base - 1)

    // c) strata: faint horizontal banding riding on the warped v coordinate,
    // reads as sedimentary layers cut through by the ridges.
    const strata = Math.sin(wv * strataFreq * Math.PI * 2) * 0.08

    // d) cavity darkening: a separate, lower-frequency fbm thresholded to
    // pick out recessed pockets and darken them.
    const cavity = fbmCavity(u, v, 3)
    const cavityMult = 0.55 + 0.45 * clamp01((cavity - 0.35) / 0.5)

    // e) fine speckle: high-frequency lattice sampled directly (no fBm
    // averaging) for mineral grit riding on top of everything else.
    const speckle = (speckleLat.sample(u * speckleLat.size, v * speckleLat.size) - 0.5) * 0.12

    const n = clamp01(ridged + strata)
    const r = lerp(a[0], b[0], n) * cavityMult + speckle * 255
    const g = lerp(a[1], b[1], n) * cavityMult + speckle * 255
    const bch = lerp(a[2], b[2], n) * cavityMult + speckle * 255
    return [clamp01(r / 255) * 255, clamp01(g / 255) * 255, clamp01(bch / 255) * 255]
  })
  return canvas
}

function genChalk(rand, size, scale, colorA, colorB) {
  const canvas = makeCanvas(size)
  const fbmMottle = makeFbm(rand, Math.max(2, Math.round(4 * scale)))
  const fbmStreak = makeFbm(rand, Math.max(2, Math.round(4 * scale)))
  const chipLat = makeLattice(rand, Math.max(4, Math.round(10 * scale)))
  const a = hexToRgb(colorA)
  const b = hexToRgb(colorB)
  const chip = [b[0] * 0.4, b[1] * 0.4, b[2] * 0.4]
  paintPixels(canvas, size, (x, y) => {
    const u = x / size
    const v = y / size
    const mottle = fbmMottle(u, v, 4) * 0.22
    // stretched sampling: low frequency along v elongates features into
    // vertical streaks (drip/wear marks running down the pole)
    const streak = fbmStreak(u * 4 * scale, v * 1.1 * scale, 3) * 0.12
    const n = clamp01(0.5 + mottle + streak)
    const chipVal = chipLat.sample(u * chipLat.size, v * chipLat.size)
    const isChip = chipVal > 0.9
    const rgb = [lerp(a[0], b[0], n), lerp(a[1], b[1], n), lerp(a[2], b[2], n)]
    if (isChip) {
      const t = clamp01((chipVal - 0.9) * 8)
      return [lerp(rgb[0], chip[0], t), lerp(rgb[1], chip[1], t), lerp(rgb[2], chip[2], t)]
    }
    return rgb
  })
  return canvas
}

const DEFAULTS = {
  noise: { colorA: '#202020', colorB: '#e0e0e0' },
  wood: { colorA: '#5a3a20', colorB: '#c89058' },
  marble: { colorA: '#f0eee8', colorB: '#40403c' },
  brick: { colorA: '#7a3a2c', colorB: '#c47a54' },
  rust: { colorA: '#5a6068', colorB: '#b5561e' },
  grid: { colorA: '#787878', colorB: '#e8e8e8' },
  plates: { colorA: '#3a4048', colorB: '#8a94a0' },
  rock: { colorA: '#4a2410', colorB: '#c26a2a' },
  chalk: { colorA: '#e8e6e0', colorB: '#d8d4c8' },
}

const GENERATORS = {
  noise: genNoise,
  wood: genWood,
  marble: genMarble,
  brick: genBrick,
  rust: genRust,
  grid: genGrid,
  plates: genPlates,
  rock: genRock,
  chalk: genChalk,
}

export function makeTexture(kind, opts = {}) {
  const gen = GENERATORS[kind]
  if (!gen) throw new Error(`makeTexture: unknown kind "${kind}"`)
  const defaults = DEFAULTS[kind]
  const { seed = 1, size = 256, colorA = defaults.colorA, colorB = defaults.colorB, scale = 1 } = opts
  const rand = mulberry32(seed)
  const canvas = gen(rand, size, scale, colorA, colorB)
  return finishTexture(canvas)
}
