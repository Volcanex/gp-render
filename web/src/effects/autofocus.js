// Autofocus dynamics: turns a raw depth-picking measurement (world distance
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
    // 'zone' area-AF state
    this.zoneBuffer = []
    this.zoneTarget = this.current
    // 'cinerack' rack state
    this.rackTarget = this.current
    this.rackTotalDist = 0
    // 'macro' state
    this.macroPhase = null
    this.macroFarTarget = null
    this.macroDiveTarget = null
    this.macroPhaseTimer = 0
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
    } else if (this.mode === 'zone') {
      this._updateZone(dt, measuredDist)
    } else if (this.mode === 'cinerack') {
      this._updateCinerack(dt, m)
    } else if (this.mode === 'macro') {
      this._updateMacro(dt, m)
    }

    const lo = this.mode === 'macro' ? 0.3 : 0.5
    this.current = clamp(this.current, lo, 80)
    return this.current
  }

  // 'zone': area-AF. Median-filters the last few readings so a brief
  // flicker over a foreground object doesn't retarget focus, then only
  // moves once the filtered value has drifted outside a deadband.
  _updateZone(dt, measuredDist) {
    if (measuredDist != null) {
      this.zoneBuffer.push(measuredDist)
      if (this.zoneBuffer.length > 5) this.zoneBuffer.shift()
    }
    if (this.zoneBuffer.length) {
      const median = this._median(this.zoneBuffer)
      const deadband = 0.1 * Math.max(this.zoneTarget, 1e-6)
      if (Math.abs(median - this.zoneTarget) > deadband) this.zoneTarget = median
    }
    const tau = 0.2
    const alpha = 1 - Math.exp(-dt / tau)
    this.current += (this.zoneTarget - this.current) * alpha
  }

  _median(values) {
    const sorted = [...values].sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
  }

  // 'cinerack': the focus-puller look. Constant angular velocity toward the
  // mark, easing out only in the final approach so it never overshoots.
  _updateCinerack(dt, m) {
    if (m != null && Math.abs(m - this.rackTarget) > 0.01) {
      this.rackTarget = m
      this.rackTotalDist = Math.abs(this.rackTarget - this.current)
    }
    const remaining = this.rackTarget - this.current
    const remainingAbs = Math.abs(remaining)
    if (remainingAbs < 1e-6) return
    const speedCap = 8
    const easeZone = 0.15 * Math.max(this.rackTotalDist, 1e-6)
    const speed = remainingAbs < easeZone ? speedCap * (remainingAbs / easeZone) : speedCap
    const step = Math.sign(remaining) * Math.min(speed * dt, remainingAbs)
    this.current += step
  }

  // 'macro': eager close-focus lens. Snaps quickly onto near subjects, but
  // reads a far subject as "not macro": dives toward the near limit first,
  // then gives up and crawls out to the real (far) distance.
  _updateMacro(dt, m) {
    if (m == null) return

    if (m < 6) {
      this.macroPhase = null
      const tau = 0.1
      const alpha = 1 - Math.exp(-dt / tau)
      this.current += (m - this.current) * alpha
      return
    }

    const targetMoved = this.macroFarTarget == null || Math.abs(m - this.macroFarTarget) > 0.1 * Math.max(this.macroFarTarget, 1e-6)
    if (this.macroPhase == null || targetMoved) {
      this.macroPhase = 'dive'
      this.macroFarTarget = m
      this.macroDiveTarget = 1 + Math.random() * 1
      this.macroPhaseTimer = 0
    }

    this.macroPhaseTimer += dt
    if (this.macroPhase === 'dive') {
      const tau = 0.08
      const alpha = 1 - Math.exp(-dt / tau)
      this.current += (this.macroDiveTarget - this.current) * alpha
      if (this.macroPhaseTimer >= 0.4) this.macroPhase = 'crawl'
    } else {
      const tau = 1.2
      const alpha = 1 - Math.exp(-dt / tau)
      this.current += (this.macroFarTarget - this.current) * alpha
    }
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
        // recovery seek is guaranteed to succeed: no chained misses
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
