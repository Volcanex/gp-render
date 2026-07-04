// CPU error-diffusion dither (Floyd-Steinberg / Atkinson) — the true serial
// dithers the GPU threshold modes in VisionEffect.js can't do. Downsamples
// the frame to a small render target, reads it back to the CPU, diffuses
// quantisation error pixel-by-pixel in plain JS, then uploads the result as
// a NearestFilter texture and blits it back up. Deliberately slow-ish and
// diegetic: "the robot's processor dithers in software."
import * as THREE from 'three'
import { Pass } from 'postprocessing'

const MAX_SMALL_W = 512
const MAX_SMALL_H = 384

// Shared fullscreen-triangle vertex shader: position.xy is used directly as
// clip space (the geometry already covers NDC), so no camera matrices are
// involved — this is why the default Pass camera (unconfigured Ortho) is fine.
const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
`

const copyFragmentShader = /* glsl */ `
uniform sampler2D uTex;
varying vec2 vUv;
void main() {
  gl_FragColor = vec4(texture2D(uTex, vUv).rgb, 1.0);
}
`

// Diffusion kernels expressed as [dx, dy, weight] for a left-to-right pass;
// serpentine scanning flips dx by the row direction to mirror the kernel
// instead of re-deriving a second table.
const FLOYD_STEINBERG = [
  [1, 0, 7 / 16],
  [-1, 1, 3 / 16],
  [0, 1, 5 / 16],
  [1, 1, 1 / 16],
]

// Atkinson only redistributes 6/8 of the error (two of the eight eighths are
// simply dropped) — that's the classic old-Mac trait of blown highlights and
// crushed shadows, as distinct from Floyd-Steinberg's full error conservation.
const ATKINSON = [
  [1, 0, 1 / 8],
  [2, 0, 1 / 8],
  [-1, 1, 1 / 8],
  [0, 1, 1 / 8],
  [1, 1, 1 / 8],
  [0, 2, 1 / 8],
]

function clamp255(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v
}

function quantLevel(v, levels) {
  if (levels <= 1) return 0
  const step = 255 / (levels - 1)
  let level = Math.round(v / step)
  if (level < 0) level = 0
  else if (level > levels - 1) level = levels - 1
  return level
}

export class ErrorDiffusionPass extends Pass {
  constructor() {
    super('ErrorDiffusionPass')

    this._copyMaterial = new THREE.ShaderMaterial({
      uniforms: { uTex: new THREE.Uniform(null) },
      vertexShader,
      fragmentShader: copyFragmentShader,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
      toneMapped: false,
    })
    this._blitMaterial = this._copyMaterial.clone()

    this._ditherMode = 'none'
    this._levels = 2
    this._colorMode = 'rgb332'
    this._pixelSize = 1
    this._ramp = null
    this._clut = null

    this._fullWidth = 1
    this._fullHeight = 1
    this._dsW = 0
    this._dsH = 0
    this._smallRT = null
    this._readBuf = null
    this._outBuf = null
    this._errBuf = null
    this._outTexture = null
  }

  setParams(params) {
    this._ditherMode = params.ditherMode
    this._levels = Math.max(2, params.levels)
    this._colorMode = params.colorMode
    this._pixelSize = Math.max(1, params.pixelSize)
  }

  setRamp(rgbArray) {
    this._ramp = rgbArray
  }

  setClut(clutData) {
    this._clut = clutData
  }

  setSize(width, height) {
    this._fullWidth = Math.max(1, width)
    this._fullHeight = Math.max(1, height)
  }

  _ensureTargets() {
    const downscale = Math.max(2, this._pixelSize * 2)
    const dsW = Math.min(MAX_SMALL_W, Math.max(4, Math.floor(this._fullWidth / downscale)))
    const dsH = Math.min(MAX_SMALL_H, Math.max(4, Math.floor(this._fullHeight / downscale)))
    if (this._smallRT && dsW === this._dsW && dsH === this._dsH) return

    this._dsW = dsW
    this._dsH = dsH

    if (this._smallRT) this._smallRT.dispose()
    this._smallRT = new THREE.WebGLRenderTarget(dsW, dsH, {
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: false,
      stencilBuffer: false,
    })

    this._readBuf = new Uint8Array(dsW * dsH * 4)
    this._outBuf = new Uint8Array(dsW * dsH * 4)
    this._errBuf = new Float32Array(dsW * dsH * 4)

    if (this._outTexture) this._outTexture.dispose()
    this._outTexture = new THREE.DataTexture(this._outBuf, dsW, dsH, THREE.RGBAFormat)
    this._outTexture.minFilter = THREE.NearestFilter
    this._outTexture.magFilter = THREE.NearestFilter
    this._outTexture.generateMipmaps = false
  }

  // Diffuses `amount` into the neighbours of (x, y) named by `kernel`,
  // mirrored horizontally by `dir` for the serpentine scan.
  _spreadError(x, y, dir, kernel, amount, slot) {
    const w = this._dsW
    const h = this._dsH
    const err = this._errBuf
    for (let k = 0; k < kernel.length; k++) {
      const nx = x + kernel[k][0] * dir
      const ny = y + kernel[k][1]
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue
      err[(ny * w + nx) * 4 + slot] += amount * kernel[k][2]
    }
  }

  _diffuse() {
    const w = this._dsW
    const h = this._dsH
    const src = this._readBuf
    const out = this._outBuf
    const err = this._errBuf
    err.fill(0)

    const kernel = this._ditherMode === 'atkinson' ? ATKINSON : FLOYD_STEINBERG
    const levels = this._levels
    const colorMode = this._colorMode
    const ramp = this._ramp
    const clut = this._clut
    const rgbStep = 255 / (levels - 1 || 1)

    for (let y = 0; y < h; y++) {
      const dir = (y & 1) === 0 ? 1 : -1
      const xStart = dir === 1 ? 0 : w - 1
      const xEnd = dir === 1 ? w : -1
      for (let x = xStart; x !== xEnd; x += dir) {
        const i4 = (y * w + x) * 4

        if (colorMode === 'ramp' && ramp) {
          const lum = 0.2126 * src[i4] + 0.7152 * src[i4 + 1] + 0.0722 * src[i4 + 2]
          const old = clamp255(lum + err[i4])
          const level = quantLevel(old, levels)
          const newVal = level * rgbStep
          this._spreadError(x, y, dir, kernel, old - newVal, 0)
          const rampIdx = Math.round((level / (levels - 1 || 1)) * 255)
          const rc = ramp[rampIdx] || ramp[0]
          out[i4] = rc[0]; out[i4 + 1] = rc[1]; out[i4 + 2] = rc[2]; out[i4 + 3] = 255
        } else if (colorMode === 'rgb332' && clut) {
          const rOld = clamp255(src[i4] + err[i4])
          const gOld = clamp255(src[i4 + 1] + err[i4 + 1])
          const bOld = clamp255(src[i4 + 2] + err[i4 + 2])
          const rLevel = quantLevel(rOld, 8)
          const gLevel = quantLevel(gOld, 8)
          const bLevel = quantLevel(bOld, 4)
          this._spreadError(x, y, dir, kernel, rOld - rLevel * (255 / 7), 0)
          this._spreadError(x, y, dir, kernel, gOld - gLevel * (255 / 7), 1)
          this._spreadError(x, y, dir, kernel, bOld - bLevel * (255 / 3), 2)
          const idx = (rLevel * 32 + gLevel * 4 + bLevel) * 4
          out[i4] = clut[idx]; out[i4 + 1] = clut[idx + 1]; out[i4 + 2] = clut[idx + 2]; out[i4 + 3] = 255
        } else {
          // rgb: independent per-channel diffusion to `levels` steps each
          for (let c = 0; c < 3; c++) {
            const old = clamp255(src[i4 + c] + err[i4 + c])
            const level = quantLevel(old, levels)
            const newVal = level * rgbStep
            this._spreadError(x, y, dir, kernel, old - newVal, c)
            out[i4 + c] = newVal
          }
          out[i4 + 3] = 255
        }
      }
    }
  }

  render(renderer, inputBuffer, outputBuffer) {
    this._ensureTargets()

    if (this._ditherMode !== 'floyd' && this._ditherMode !== 'atkinson') {
      // Not our mode this frame — passthrough so the chain still swaps cleanly.
      this._copyMaterial.uniforms.uTex.value = inputBuffer.texture
      this.fullscreenMaterial = this._copyMaterial
      renderer.setRenderTarget(this.renderToScreen ? null : outputBuffer)
      renderer.render(this.scene, this.camera)
      return
    }

    // 1. downsample the full-res input into the small RT
    this._copyMaterial.uniforms.uTex.value = inputBuffer.texture
    this.fullscreenMaterial = this._copyMaterial
    renderer.setRenderTarget(this._smallRT)
    renderer.render(this.scene, this.camera)

    // 2. read back (bottom-up rows, per WebGL/readRenderTargetPixels convention)
    renderer.readRenderTargetPixels(this._smallRT, 0, 0, this._dsW, this._dsH, this._readBuf)

    // 3. CPU error diffusion
    this._diffuse()

    // 4. upload — DataTexture defaults to flipY = false, i.e. row 0 of the
    // buffer becomes texel row 0, and texel row 0 is also what a standard
    // fullscreen quad samples at v = 0 (its "bottom"). Since our buffer's
    // row 0 is *already* the bottom of the image (readRenderTargetPixels is
    // bottom-up too), the two bottom-up conventions cancel out and the
    // result is upright with no explicit flip anywhere in this pass. Do not
    // "fix" this with a flip — that would flip it upside down.
    this._outTexture.needsUpdate = true

    // 5. blit the dithered, chunky-pixel result back up to full res
    this._blitMaterial.uniforms.uTex.value = this._outTexture
    this.fullscreenMaterial = this._blitMaterial
    renderer.setRenderTarget(this.renderToScreen ? null : outputBuffer)
    renderer.render(this.scene, this.camera)
  }

  dispose() {
    if (this._smallRT) this._smallRT.dispose()
    if (this._outTexture) this._outTexture.dispose()
    this._copyMaterial.dispose()
    this._blitMaterial.dispose()
    super.dispose()
  }
}
