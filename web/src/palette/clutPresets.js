// Preset CLUTs for rgb332 colour mode: hardware machine palettes, tonal
// mappings derived from the ramp presets, and identity/saturation transforms.
// Every build(clutData) writes all 256*4 RGBA bytes in place (same contract
// as identity332 in ./clut.js) so callers can .set()-free reuse the buffer.
import { identity332 } from './clut.js'
import { PALETTES } from '../sensors/presets.js'

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function luma(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

// The rgb332 slot's own colour, same formula as identity332().
function slotRgb(i) {
  const r = (i >> 5) & 7
  const g = (i >> 2) & 7
  const b = i & 3
  return [Math.round((r / 7) * 255), Math.round((g / 7) * 255), Math.round((b / 3) * 255)]
}

function sampleRamp(stops, t) {
  const rgb = stops.map(hexToRgb)
  const seg = Math.min(Math.floor(t * (rgb.length - 1)), rgb.length - 2)
  const f = t * (rgb.length - 1) - seg
  return [0, 1, 2].map(c => Math.round(rgb[seg][c] + (rgb[seg + 1][c] - rgb[seg][c]) * f))
}

function writeSlot(clutData, i, r, g, b) {
  clutData[i * 4] = r
  clutData[i * 4 + 1] = g
  clutData[i * 4 + 2] = b
  clutData[i * 4 + 3] = 255
}

// Snap every slot to the nearest colour (Euclidean RGB) in a fixed palette.
function buildNearestRgb(hexes) {
  const targets = hexes.map(hexToRgb)
  return (clutData) => {
    for (let i = 0; i < 256; i++) {
      const [r, g, b] = slotRgb(i)
      let best = 0
      let bestDist = Infinity
      for (let k = 0; k < targets.length; k++) {
        const [tr, tg, tb] = targets[k]
        const d = (r - tr) ** 2 + (g - tg) ** 2 + (b - tb) ** 2
        if (d < bestDist) { bestDist = d; best = k }
      }
      writeSlot(clutData, i, ...targets[best])
    }
  }
}

// Snap by luminance distance instead of RGB distance, for palettes like the
// DMG greens where hue is fixed and only value should drive the mapping.
function buildNearestLuma(hexes) {
  const targets = hexes.map(hexToRgb)
  const targetLumas = targets.map(([r, g, b]) => luma(r, g, b))
  return (clutData) => {
    for (let i = 0; i < 256; i++) {
      const [r, g, b] = slotRgb(i)
      const l = luma(r, g, b)
      let best = 0
      let bestDist = Infinity
      for (let k = 0; k < targetLumas.length; k++) {
        const d = Math.abs(l - targetLumas[k])
        if (d < bestDist) { bestDist = d; best = k }
      }
      writeSlot(clutData, i, ...targets[best])
    }
  }
}

// CLUT[slot] = rampColour(luminance(slotColour)): the same lerp-between-hex-
// stops approach as effects/ramps.js's makeRampTexture, sampled by slot luma.
function buildTone(stops) {
  return (clutData) => {
    for (let i = 0; i < 256; i++) {
      const [r, g, b] = slotRgb(i)
      const t = luma(r, g, b) / 255
      writeSlot(clutData, i, ...sampleRamp(stops, t))
    }
  }
}

function adjustSaturation([r, g, b], factor) {
  const l = luma(r, g, b)
  const clamp = c => Math.min(255, Math.max(0, Math.round(l + (c - l) * factor)))
  return [clamp(r), clamp(g), clamp(b)]
}

function buildSaturation(factor) {
  return (clutData) => {
    for (let i = 0; i < 256; i++) {
      const [r, g, b] = slotRgb(i)
      writeSlot(clutData, i, ...adjustSaturation([r, g, b], factor))
    }
  }
}

const C64 = [
  '#000000', '#ffffff', '#68372b', '#70a4b2', '#6f3d86', '#588d43', '#352879', '#b8c76f',
  '#6f4f25', '#433900', '#9a6759', '#444444', '#6c6c6c', '#9ad284', '#6c5eb5', '#959595',
]

const CGA = [
  '#000000', '#0000aa', '#00aa00', '#00aaaa', '#aa0000', '#aa00aa', '#aa5500', '#aaaaaa',
  '#555555', '#5555ff', '#55ff55', '#55ffff', '#ff5555', '#ff55ff', '#ffff55', '#ffffff',
]

// Standard EGA default 16 is the same RGBI ramp as CGA (0/0x55/0xaa/0xff per channel).
const EGA = CGA

const ZX_SPECTRUM = [
  '#000000', '#0000d7', '#d70000', '#d700d7', '#00d700', '#00d7d7', '#d7d700', '#d7d7d7',
  '#0000ff', '#ff0000', '#ff00ff', '#00ff00', '#00ffff', '#ffff00', '#ffffff',
]

// Representative 2C02 (NES) palette, deduplicated from the common 64-entry table.
const NES = [
  '#000000', '#fcfcfc', '#7c7c7c', '#bcbcbc', '#f8f8f8', '#a4e4fc',
  '#0000fc', '#0000bc', '#0078f8', '#0058f8', '#3cbcfc', '#6888fc', '#b8b8f8',
  '#4428bc', '#940084', '#d800cc', '#6844fc', '#9878f8', '#f878f8', '#d8b8f8', '#f8b8f8', '#f8a4c0',
  '#a80020', '#e40058', '#f85898', '#f0d0b0',
  '#a81000', '#f83800', '#f87858', '#fce0a8',
  '#881400', '#e45c10', '#fca044', '#f8d878',
  '#503000', '#ac7c00', '#f8b800', '#d8f878',
  '#007800', '#00b800', '#b8f818', '#b8f8b8',
  '#006800', '#00a800', '#58d854', '#b8f8d8',
  '#005800', '#00a844', '#58f898', '#00fcfc',
  '#004058', '#008888', '#00e8d8', '#f8d8f8',
  '#787878',
]

export const CLUT_PRESETS = {
  identity: { label: 'Identity (rgb332 cube)', build: (clutData) => clutData.set(identity332()) },

  c64: { label: 'Commodore 64', build: buildNearestRgb(C64) },
  cga: { label: 'CGA (RGBI)', build: buildNearestRgb(CGA) },
  ega: { label: 'EGA (default 16)', build: buildNearestRgb(EGA) },
  zx: { label: 'ZX Spectrum', build: buildNearestRgb(ZX_SPECTRUM) },
  nes: { label: 'NES (2C02)', build: buildNearestRgb(NES) },
  gameboy: { label: 'Game Boy (DMG)', build: buildNearestLuma(PALETTES.gameboy) },

  muted: { label: 'Muted (desaturated)', build: buildSaturation(0.45) },
  neon: { label: 'Neon (oversaturated)', build: buildSaturation(1.6) },

  ...Object.fromEntries(
    Object.entries(PALETTES).map(([id, stops]) => [
      `tone-${id}`,
      { label: `Tone: ${id}`, build: buildTone(stops) },
    ])
  ),
}

export function applyClutPreset(id, clutData) {
  const preset = CLUT_PRESETS[id] ?? CLUT_PRESETS.identity
  preset.build(clutData)
}
