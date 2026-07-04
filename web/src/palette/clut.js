// Hardware-style colour lookup table for rgb332 mode. The shader quantises
// into 256 index slots (r*32 + g*4 + b); this table says what colour each
// slot displays. Identity = the plain rgb332 cube, so an unedited CLUT is
// visually identical to raw quantisation.
import * as THREE from 'three'

export function identity332() {
  const data = new Uint8Array(256 * 4)
  for (let i = 0; i < 256; i++) {
    const r = (i >> 5) & 7
    const g = (i >> 2) & 7
    const b = i & 3
    data[i * 4] = Math.round((r / 7) * 255)
    data[i * 4 + 1] = Math.round((g / 7) * 255)
    data[i * 4 + 2] = Math.round((b / 3) * 255)
    data[i * 4 + 3] = 255
  }
  return data
}

export function makeClutTexture(data) {
  const tex = new THREE.DataTexture(data, 256, 1, THREE.RGBAFormat)
  tex.minFilter = tex.magFilter = THREE.NearestFilter
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping
  tex.needsUpdate = true
  return tex
}

export function slotToHex(data, i) {
  return '#' + [0, 1, 2].map(c => data[i * 4 + c].toString(16).padStart(2, '0')).join('')
}

export function hexToSlot(data, i, hex) {
  const n = parseInt(hex.slice(1), 16)
  data[i * 4] = (n >> 16) & 255
  data[i * 4 + 1] = (n >> 8) & 255
  data[i * 4 + 2] = n & 255
  data[i * 4 + 3] = 255
}
