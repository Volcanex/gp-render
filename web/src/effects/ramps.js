// 1D palette-ramp textures built from the hex stop arrays in sensors/presets.js.
// WebGL has no 1D textures, so ramps are 256x1 DataTextures sampled at
// vec2(quantisedLum, 0.5). LinearFilter gives free interpolation between stops.
import * as THREE from 'three'
import { PALETTES } from '../sensors/presets.js'

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function makeRampTexture(stops) {
  const w = 256
  const data = new Uint8Array(w * 4)
  const rgb = stops.map(hexToRgb)
  for (let i = 0; i < w; i++) {
    const t = i / (w - 1)
    const seg = Math.min(Math.floor(t * (rgb.length - 1)), rgb.length - 2)
    const f = t * (rgb.length - 1) - seg
    for (let c = 0; c < 3; c++)
      data[i * 4 + c] = Math.round(rgb[seg][c] + (rgb[seg + 1][c] - rgb[seg][c]) * f)
    data[i * 4 + 3] = 255
  }
  const tex = new THREE.DataTexture(data, w, 1, THREE.RGBAFormat)
  tex.minFilter = tex.magFilter = THREE.LinearFilter
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping
  tex.needsUpdate = true
  return tex
}

const cache = new Map()
export function getRampTexture(paletteId) {
  if (!cache.has(paletteId)) cache.set(paletteId, makeRampTexture(PALETTES[paletteId] ?? PALETTES.mono))
  return cache.get(paletteId)
}
