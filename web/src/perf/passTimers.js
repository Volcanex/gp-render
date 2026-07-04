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
  passes: [], // [{ name, ms }]
}

const EMA_ALPHA = 0.08

let lastFrameTime = null

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
    }
  }
  lastFrameTime = now
}
