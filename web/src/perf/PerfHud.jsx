// DOM overlay meant to be rendered outside the R3F <Canvas> by App —
// it just polls perfRegistry, it never touches the scene.
import { useEffect, useState } from 'react'
import { perfRegistry } from './passTimers.js'

const MAX_NAME_LENGTH = 28

function fpsColor(fps) {
  if (fps >= 55) return '#7c9'
  if (fps >= 30) return '#ca7'
  return '#c66'
}

function truncate(name) {
  if (name.length <= MAX_NAME_LENGTH) return name
  return `${name.slice(0, MAX_NAME_LENGTH - 1)}…`
}

export default function PerfHud() {
  const [snapshot, setSnapshot] = useState(null)

  useEffect(() => {
    const id = setInterval(() => {
      setSnapshot({
        fps: perfRegistry.fps,
        passes: perfRegistry.passes.map((p) => ({ ...p })),
      })
    }, 250)
    return () => clearInterval(id)
  }, [])

  if (!snapshot || snapshot.passes.length === 0) return null

  const rows = snapshot.passes
    .filter((p) => p.ms >= 0.05)
    .sort((a, b) => b.ms - a.ms)

  return (
    <div
      style={{
        position: 'fixed',
        top: 8,
        left: 8,
        zIndex: 1000,
        pointerEvents: 'none',
        fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
        fontSize: 11,
        lineHeight: 1.6,
        background: 'rgba(20, 20, 24, 0.78)',
        color: '#ddd',
        padding: '8px 10px',
        borderRadius: 4,
        minWidth: 190,
        userSelect: 'none',
      }}
    >
      <div style={{ fontSize: 16, fontWeight: 600, color: fpsColor(snapshot.fps) }}>
        FPS {Math.round(snapshot.fps)}
      </div>
      <div style={{ opacity: 0.5, marginBottom: 4 }}>cpu ms/frame (incl. gpu stalls)</div>
      {rows.map((p) => (
        <div key={p.name} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <span>{truncate(p.name)}</span>
          <span>{p.ms.toFixed(2)}</span>
        </div>
      ))}
    </div>
  )
}
