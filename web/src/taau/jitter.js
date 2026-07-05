// Sub-pixel camera jitter for temporal upscaling.
// Halton(2,3) low-discrepancy sequence (FSR2's choice), starting at index 1
// (index 0 is the degenerate zero sample). Phase count follows FSR2:
// ceil(8 * n^2) where n is the per-dimension upscale ratio — 18 phases at
// 1.5x, 32 at 2x. Offsets are in render-resolution pixels, [-0.5, 0.5].
export function halton(base, index) {
  let f = 1
  let r = 0
  let i = index
  while (i > 0) {
    f /= base
    r += f * (i % base)
    i = Math.floor(i / base)
  }
  return r
}

export function jitterPhaseCount(renderWidth, displayWidth) {
  const n = displayWidth / renderWidth
  return Math.ceil(8 * n * n)
}

export class JitterSequence {
  constructor() {
    this.phase = 0
    this.phaseCount = 8
    this.x = 0
    this.y = 0
  }

  configure(renderWidth, displayWidth) {
    this.phaseCount = jitterPhaseCount(renderWidth, displayWidth)
  }

  // advance and return the offset in render-pixel units, centred on 0
  next() {
    this.phase = (this.phase % this.phaseCount) + 1 // 1..phaseCount
    this.x = halton(2, this.phase) - 0.5
    this.y = halton(3, this.phase) - 0.5
    return this
  }
}

// Applies a sub-pixel NDC offset to the projection matrix (elements 8/9 are
// the third-column x/y terms; adding to them shifts clip xy by offset*w —
// a uniform screen-space translation). One render pixel = 2/size in NDC.
// Restore with clearJitter using the same camera — originals are stashed.
export function applyJitter(camera, jx, jy, renderWidth, renderHeight) {
  const e = camera.projectionMatrix.elements
  camera.userData.__taauJitterBackup = [e[8], e[9]]
  e[8] += (2 * jx) / renderWidth
  e[9] += (2 * jy) / renderHeight
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert()
}

export function clearJitter(camera) {
  const backup = camera.userData.__taauJitterBackup
  if (!backup) return
  const e = camera.projectionMatrix.elements
  e[8] = backup[0]
  e[9] = backup[1]
  camera.userData.__taauJitterBackup = null
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert()
}
