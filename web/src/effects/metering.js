// Auto-exposure: MeteringPass measures average scene luminance/colour before
// the sensor stylisation effects (it sits ahead of SensorEffect in the
// composer); AutoExposureController lags a correction toward mid-grey like a
// real camera's AE. See VisionPipeline.jsx for where this plugs in.
import * as THREE from 'three'
import { Pass } from 'postprocessing'

const RT_SIZE = 16
const TARGET_LUMA = 0.35

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

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

export class MeteringPass extends Pass {
  constructor() {
    super('MeteringPass')
    // We only sample — never transform the image — so the composer keeps
    // feeding subsequent passes the same input buffer untouched.
    this.needsSwap = false

    this._copyMaterial = new THREE.ShaderMaterial({
      uniforms: { uTex: new THREE.Uniform(null) },
      vertexShader,
      fragmentShader: copyFragmentShader,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
      toneMapped: false,
    })

    // UnsignedByteType is required here even though the composer's buffers
    // are HalfFloat: readRenderTargetPixels needs a readable (byte) target.
    // Values >1 (highlights) clamp to 1 — acceptable for metering.
    this._smallRT = new THREE.WebGLRenderTarget(RT_SIZE, RT_SIZE, {
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
    })

    this._readBuf = new Uint8Array(RT_SIZE * RT_SIZE * 4)
    this._armed = false
    this.lastSample = null
  }

  requestSample() {
    this._armed = true
  }

  render(renderer, inputBuffer) {
    if (!this._armed) return

    this._copyMaterial.uniforms.uTex.value = inputBuffer.texture
    this.fullscreenMaterial = this._copyMaterial
    renderer.setRenderTarget(this._smallRT)
    renderer.render(this.scene, this.camera)

    renderer.readRenderTargetPixels(this._smallRT, 0, 0, RT_SIZE, RT_SIZE, this._readBuf)

    const buf = this._readBuf
    const n = RT_SIZE * RT_SIZE
    let rSum = 0
    let gSum = 0
    let bSum = 0
    for (let i = 0; i < n; i++) {
      rSum += buf[i * 4]
      gSum += buf[i * 4 + 1]
      bSum += buf[i * 4 + 2]
    }
    const r = rSum / n / 255
    const g = gSum / n / 255
    const b = bSum / n / 255
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b

    this.lastSample = { luma, r, g, b }
    this._armed = false
  }

  setSize() {
    // fixed 16x16 target — nothing to resize
  }

  dispose() {
    this._smallRT.dispose()
    this._copyMaterial.dispose()
    super.dispose()
  }
}

export class AutoExposureController {
  constructor() {
    this.mode = 'manual'
    this.stops = 0
    this._targetStops = 0
  }

  setMode(mode) {
    this.mode = mode
  }

  // meteredLuma: 0..1 from MeteringPass.lastSample.luma, or null when no new
  // sample arrived this frame (holds the last target and keeps lagging).
  update(dt, meteredLuma) {
    dt = clamp(dt, 0, 0.1)

    if (this.mode === 'manual') {
      // Quick decay to 0 so switching out of auto modes settles fast.
      const alpha = 1 - Math.exp(-dt / 0.15)
      this.stops += (0 - this.stops) * alpha
      return this.stops
    }

    // 'auto-ev' and 'auto-iso' share identical dynamics here — auto-iso just
    // consumes the same `stops` value differently, via autoIso() below.
    if (meteredLuma != null) {
      const err = Math.log2(TARGET_LUMA / Math.max(meteredLuma, 1e-4))
      this._targetStops = clamp(err, -6, 6)
    }
    const alpha = 1 - Math.exp(-dt / 0.6)
    this.stops += (this._targetStops - this.stops) * alpha
    return this.stops
  }

  autoIso(baseIso) {
    return clamp(baseIso * Math.pow(2, this.stops), 100, 12800)
  }
}
