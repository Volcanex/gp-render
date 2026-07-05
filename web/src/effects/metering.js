// Auto-exposure: MeteringPass measures average scene luminance/colour before
// the sensor stylisation effects (it sits ahead of SensorEffect in the
// composer); AutoExposureController lags a correction toward mid-grey like a
// real camera's AE. See VisionPipeline.jsx for where this plugs in.
import * as THREE from 'three'
import { Pass } from 'postprocessing'

const RT_SIZE = 16
const TARGET_LUMA = 0.18 // 18% grey: the DR lift + S-curve brighten further downstream

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

    // Async PBO readback state (WebGL2), same state machine as
    // ErrorDiffusionPass: _pending means a readPixels is in flight with a
    // fence guarding it; while pending we just poll instead of blocking.
    this._gl = null
    this._usePBO = false
    this._pbo = null
    this._sync = null
    this._pending = false
  }

  initialize(renderer, alpha, frameBufferType) {
    super.initialize(renderer, alpha, frameBufferType)
    const gl = renderer.getContext()
    this._gl = gl
    // fenceSync/getBufferSubData are WebGL2-only; their absence is the
    // signal to fall back to the old synchronous path, not a version check.
    this._usePBO = typeof gl.fenceSync === 'function' && typeof gl.getBufferSubData === 'function'
    if (this._usePBO) {
      this._pbo = gl.createBuffer()
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this._pbo)
      gl.bufferData(gl.PIXEL_PACK_BUFFER, RT_SIZE * RT_SIZE * 4, gl.STREAM_READ)
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null)
    }
  }

  requestSample() {
    this._armed = true
  }

  _downsample(renderer, inputBuffer) {
    this._copyMaterial.uniforms.uTex.value = inputBuffer.texture
    this.fullscreenMaterial = this._copyMaterial
    renderer.setRenderTarget(this._smallRT)
    renderer.render(this.scene, this.camera)
  }

  // Fires an async readPixels into the PBO and fences it; never blocks.
  _kickReadPixels() {
    const gl = this._gl
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this._pbo)
    gl.readPixels(0, 0, RT_SIZE, RT_SIZE, gl.RGBA, gl.UNSIGNED_BYTE, 0)
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null)
    this._sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)
    gl.flush()
    this._pending = true
  }

  // Non-blocking poll. Returns true (and pulls the data into _readBuf) only
  // once the fence has actually signaled; false means keep waiting.
  _resolvePending() {
    const gl = this._gl
    if (gl.getSyncParameter(this._sync, gl.SYNC_STATUS) !== gl.SIGNALED) return false
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this._pbo)
    gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, this._readBuf)
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null)
    gl.deleteSync(this._sync)
    this._sync = null
    this._pending = false
    return true
  }

  _computeSample() {
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
  }

  // requestSample() arms; the actual read may take one or more frames to
  // resolve once kicked (async PBO + fence), which the AE controller
  // tolerates fine — it's already a ~0.6s lag controller.
  render(renderer, inputBuffer) {
    if (!this._usePBO) {
      // Sync fallback (no WebGL2 fenceSync): sample-on-request, inline.
      if (!this._armed) return
      this._downsample(renderer, inputBuffer)
      renderer.readRenderTargetPixels(this._smallRT, 0, 0, RT_SIZE, RT_SIZE, this._readBuf)
      this._computeSample()
      this._armed = false
      return
    }

    if (this._pending) {
      if (this._resolvePending()) this._computeSample()
      // else: fence hasn't signaled yet — keep waiting, lastSample unchanged
      return
    }

    if (this._armed) {
      this._downsample(renderer, inputBuffer)
      this._kickReadPixels()
      this._armed = false
    }
  }

  setSize() {
    // fixed 16x16 target — nothing to resize
  }

  dispose() {
    const gl = this._gl
    if (gl) {
      if (this._sync) gl.deleteSync(this._sync)
      if (this._pbo) gl.deleteBuffer(this._pbo)
    }
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
    this.bias = 0
  }

  setMode(mode) {
    this.mode = mode
  }

  // exposure compensation in stops — a camera's +/- dial; negative keeps
  // dark scenes dark instead of letting AE normalise everything to mid-grey
  setBias(stops) {
    this.bias = stops || 0
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
      const err = Math.log2(TARGET_LUMA / Math.max(meteredLuma, 1e-4)) + this.bias
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
