// Autofocus dynamics — turns a raw depth-picking measurement (world distance
// under the screen-centre crosshair) into the focusDistance actually fed to
// the DOF effect. Each afMode is a distinct "AF personality"; see
// sensors/presets.js for the mode catalogue this drives.

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

export class AutofocusController {
  constructor() {
    this.mode = 'manual'
    this.manualValue = 8
    this.current = 8
    this._resetDynamics()
  }

  setMode(mode) {
    this.mode = mode
    this._resetDynamics()
  }

  setManual(value) {
    this.manualValue = value
  }

  _resetDynamics() {
    // 'lazy' spring state
    this.velocity = 0
    // last non-null measurement, held across null frames
    this.lastMeasured = this.current
    // 'hunting' state machine
    this.huntState = 'LOCKED'
    this.lockedTarget = this.current
    this.offTargetTimer = 0
    this.seek = null
    this.missTimer = 0
    this.missTrueTarget = null
  }

  update(dt, measuredDist) {
    dt = clamp(dt, 0, 0.1)
    if (measuredDist != null) this.lastMeasured = measuredDist
    const m = this.lastMeasured

    if (this.mode === 'manual') {
      this.current = this.manualValue
    } else if (this.mode === 'instant') {
      if (m != null) {
        const tau = 0.06
        const alpha = 1 - Math.exp(-dt / tau)
        this.current += (m - this.current) * alpha
      }
    } else if (this.mode === 'lazy') {
      if (m != null) {
        const wn = 1.2
        const zeta = 0.35
        const accel = wn * wn * (m - this.current) - 2 * zeta * wn * this.velocity
        this.velocity += accel * dt
        this.current += this.velocity * dt
      }
    } else if (this.mode === 'hunting') {
      this._updateHunting(dt, m)
    }

    this.current = clamp(this.current, 0.5, 80)
    return this.current
  }

  _updateHunting(dt, m) {
    if (m == null) return // hold last state on a missed reading

    if (this.huntState === 'LOCKED') {
      const threshold = 0.15 * Math.max(this.lockedTarget, 1e-6)
      if (Math.abs(m - this.lockedTarget) > threshold) {
        this.offTargetTimer += dt
        if (this.offTargetTimer > 0.25) this._enterSeek(m, true)
      } else {
        this.offTargetTimer = 0
      }
      return
    }

    if (this.huntState === 'SEEK') {
      this._advanceSeek(dt)
      return
    }

    if (this.huntState === 'MISS') {
      this.missTimer -= dt
      if (this.missTimer <= 0) {
        // recovery seek is guaranteed to succeed — no chained misses
        this._enterSeek(this.missTrueTarget, false)
      }
    }
  }

  // Kick off a sweep toward `target`. `allowMiss` gates whether this sweep is
  // allowed to "lock wrong" (disabled for the recovery sweep out of MISS).
  _enterSeek(target, allowMiss) {
    this.huntState = 'SEEK'
    this.offTargetTimer = 0
    this.seekTrueTarget = target
    this.seekFrom = this.current

    const willMiss = allowMiss && Math.random() < 0.25
    let convergeTarget = target
    if (willMiss) {
      const factor = Math.random() < 0.5 ? 0.5 : 2
      convergeTarget = clamp(target * factor, 1, 60)
    }
    this.seekWillMiss = willMiss
    this.seekConvergeTarget = convergeTarget
    this.seekD0 = this.seekFrom - convergeTarget

    const overshootFrac = 0.2 + Math.random() * 0.2 // 20-40% past the target
    this.seekDuration = 1 + Math.random() * 0.5 // 1-1.5s
    const oscillations = 2.2 + Math.random() * 0.6 // ~2-3 diminishing swings
    this.seekOmega = (2 * Math.PI * oscillations) / this.seekDuration
    // pick decay so the first half-cycle peak overshoots by overshootFrac
    this.seekZeta = -Math.log(overshootFrac) / Math.PI
    this.seekT = 0
  }

  _advanceSeek(dt) {
    this.seekT += dt
    if (this.seekT >= this.seekDuration) {
      if (this.seekWillMiss) {
        this.current = this.seekConvergeTarget
        this.huntState = 'MISS'
        this.missTimer = 0.8 + Math.random() * 0.7
        this.missTrueTarget = this.seekTrueTarget
        this.lockedTarget = this.seekConvergeTarget
      } else {
        this.current = this.seekTrueTarget
        this.huntState = 'LOCKED'
        this.lockedTarget = this.seekTrueTarget
      }
      return
    }
    const envelope = Math.exp(-this.seekZeta * this.seekOmega * this.seekT)
    this.current = this.seekConvergeTarget + this.seekD0 * envelope * Math.cos(this.seekOmega * this.seekT)
  }
}
