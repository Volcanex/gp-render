// Lightweight CPU-side pass timing for the post-processing chain.
//
// This measures wall-clock time inside each pass's render() call: that
// captures JS overhead plus any GPU sync stall a pass forces (e.g. the
// readback in ErrorDiffusionPass), but NOT pure-GPU shader cost that never
// blocks the CPU. A shader-only pass will read near 0ms here even if it's
// expensive on the GPU; treat these numbers as "what's stalling the CPU",
// not a full GPU profile.

export const perfRegistry = {
  frames: 0,
  fps: 0,
  low1: 0, // 1% low fps: avg of the worst 1% of frames in the window, the number that tracks felt stutter
  spikes: 0, // frames over 33ms (sub-30fps) in the window
  passes: [], // [{ name, ms, gpuMs }]
}

const EMA_ALPHA = 0.08
const WINDOW_SIZE = 120
const SPIKE_MS = 33
const QUERY_POOL_SIZE = 3

let lastFrameTime = null
const frameDeltas = []

// GPU timer query state (EXT_disjoint_timer_query_webgl2). The extension is
// frequently unavailable (macOS/ANGLE-Metal): everything here degrades to
// CPU-only timing when it's missing.
let gpuGl = null
let gpuExt = null
let gpuTimersAvailable = false
// Only one timer query can be active (between beginQuery/endQuery) at a time.
// Since pass render() calls are synchronous and sequential this is naturally
// true, but we still guard it: a pass that finds a query already active
// just skips GPU timing for that frame.
let queryActive = false

export function initGpuTimers(renderer) {
  gpuGl = renderer.getContext()
  gpuExt = gpuGl.getExtension('EXT_disjoint_timer_query_webgl2')
  gpuTimersAvailable = !!gpuExt
}

function pollGpuQuery(entry) {
  if (!gpuTimersAvailable || entry.inFlight.length === 0) return

  const query = entry.inFlight[0]
  const available = gpuGl.getQueryParameter(query, gpuGl.QUERY_RESULT_AVAILABLE)
  if (!available) return

  entry.inFlight.shift()

  const disjoint = gpuGl.getParameter(gpuExt.GPU_DISJOINT_EXT)
  if (!disjoint) {
    const nanoseconds = gpuGl.getQueryParameter(query, gpuGl.QUERY_RESULT)
    const ms = nanoseconds / 1e6
    entry.gpuMs = entry.gpuMs ? entry.gpuMs + (ms - entry.gpuMs) * EMA_ALPHA : ms
  }

  entry.queryPool.push(query)
}

export function disposeGpuTimers() {
  for (const entry of perfRegistry.passes) {
    for (const query of entry.queryPool) gpuGl && gpuGl.deleteQuery(query)
    for (const query of entry.inFlight) gpuGl && gpuGl.deleteQuery(query)
    entry.queryPool = []
    entry.inFlight = []
  }
  gpuGl = null
  gpuExt = null
  gpuTimersAvailable = false
  queryActive = false
}

function passLabel(pass) {
  const base = pass.name || pass.constructor.name || 'Pass'
  if (Array.isArray(pass.effects) && pass.effects.length) {
    const names = pass.effects.map((e) => e.name || e.constructor.name).join('+')
    return `${base}(${names})`
  }
  return base
}

export function attachPassTimers(composer) {
  const passes = composer.passes || []
  const entries = []

  for (const pass of passes) {
    if (pass.enabled === false) continue

    const label = passLabel(pass)
    const prevMs = pass.__perfEntry ? pass.__perfEntry.ms : 0
    const prevGpuMs = pass.__perfEntry ? pass.__perfEntry.gpuMs : 0
    const entry = {
      name: label,
      ms: prevMs,
      gpuMs: prevGpuMs,
      queryPool: pass.__perfEntry ? pass.__perfEntry.queryPool : [],
      inFlight: pass.__perfEntry ? pass.__perfEntry.inFlight : [],
    }
    entries.push(entry)
    pass.__perfEntry = entry

    if (pass.__timed) continue
    pass.__timed = true

    const originalRender = pass.render.bind(pass)
    pass.render = (...args) => {
      const e = pass.__perfEntry

      pollGpuQuery(e)

      const canQueryGpu = gpuTimersAvailable && !queryActive
      let query = null
      if (canQueryGpu) {
        query = e.queryPool.pop() || gpuGl.createQuery()
        gpuGl.beginQuery(gpuExt.TIME_ELAPSED_EXT, query)
        queryActive = true
      }

      const start = performance.now()
      const result = originalRender(...args)
      const elapsed = performance.now() - start

      if (canQueryGpu) {
        gpuGl.endQuery(gpuExt.TIME_ELAPSED_EXT)
        queryActive = false
        if (e.inFlight.length < QUERY_POOL_SIZE) {
          e.inFlight.push(query)
        } else {
          // in-flight queue full (GPU falling behind resolving queries):
          // drop this one back into the pool unused rather than growing unbounded
          e.queryPool.push(query)
        }
      }

      e.ms += (elapsed - e.ms) * EMA_ALPHA
      return result
    }
  }

  perfRegistry.passes = entries
}

export function markFrame() {
  const now = performance.now()
  perfRegistry.frames += 1

  if (lastFrameTime != null) {
    const delta = now - lastFrameTime
    if (delta > 0) {
      const instantFps = 1000 / delta
      perfRegistry.fps = perfRegistry.fps
        ? perfRegistry.fps + (instantFps - perfRegistry.fps) * EMA_ALPHA
        : instantFps

      frameDeltas.push(delta)
      if (frameDeltas.length > WINDOW_SIZE) frameDeltas.shift()

      // The plain fps EMA smooths away spikes, so it can read "60" on a
      // stream that periodically hitches: this pair is the jank-honest
      // complement: 1% low is the avg of the worst ~1% of frames in the
      // window (min 1 frame), spikes counts frames over SPIKE_MS.
      const sorted = [...frameDeltas].sort((a, b) => b - a)
      const worstCount = Math.max(1, Math.ceil(sorted.length * 0.01))
      const worstAvg = sorted.slice(0, worstCount).reduce((sum, d) => sum + d, 0) / worstCount
      perfRegistry.low1 = worstAvg > 0 ? 1000 / worstAvg : 0
      perfRegistry.spikes = frameDeltas.reduce((count, d) => count + (d > SPIKE_MS ? 1 : 0), 0)
    }
  }
  lastFrameTime = now
}
