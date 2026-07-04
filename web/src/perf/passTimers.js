// Lightweight CPU-side pass timing for the post-processing chain.
//
// This measures wall-clock time inside each pass's render() call — that
// captures JS overhead plus any GPU sync stall a pass forces (e.g. the
// readback in ErrorDiffusionPass), but NOT pure-GPU shader cost that never
// blocks the CPU. A shader-only pass will read near 0ms here even if it's
// expensive on the GPU; treat these numbers as "what's stalling the CPU",
// not a full GPU profile.

export const perfRegistry = {
  frames: 0,
  fps: 0,
  low1: 0, // 1% low fps — avg of the worst 1% of frames in the window, the number that tracks felt stutter
  spikes: 0, // frames over 33ms (sub-30fps) in the window
  passes: [], // [{ name, ms }]
}

const EMA_ALPHA = 0.08
const WINDOW_SIZE = 120
const SPIKE_MS = 33

let lastFrameTime = null
const frameDeltas = []

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
    const entry = { name: label, ms: prevMs }
    entries.push(entry)
    pass.__perfEntry = entry

    if (pass.__timed) continue
    pass.__timed = true

    const originalRender = pass.render.bind(pass)
    pass.render = (...args) => {
      const start = performance.now()
      const result = originalRender(...args)
      const elapsed = performance.now() - start
      const e = pass.__perfEntry
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
      // stream that periodically hitches — this pair is the jank-honest
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
