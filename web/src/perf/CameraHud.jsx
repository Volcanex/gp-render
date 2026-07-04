// Viewfinder readout — the sensor's current effective exposure state,
// published per frame by VisionPipeline on window.__titanCamera.
import { useEffect, useState } from 'react'

const wrap = {
  position: 'fixed', top: 12, right: 320, zIndex: 5, pointerEvents: 'none',
  background: 'rgba(16, 18, 22, 0.82)', color: '#cfd6dd', borderRadius: 6,
  font: '11px ui-monospace, monospace', padding: '7px 10px', letterSpacing: '0.03em',
}

function shutterLabel(ev) {
  // fiction: EV maps to an equivalent shutter around a 1/60 base
  const denom = 60 * Math.pow(2, -ev)
  if (denom >= 1) return `1/${Math.round(denom)}`
  return `${Math.round(1 / denom)}"`
}

export default function CameraHud() {
  const [cam, setCam] = useState(null)
  useEffect(() => {
    const id = setInterval(() => setCam(window.__titanCamera ? { ...window.__titanCamera } : null), 150)
    return () => clearInterval(id)
  }, [])
  if (!cam) return null
  const auto = cam.exposureMode !== 'manual'
  return (
    <div style={wrap}>
      <span style={{ color: '#e8b45a' }}>ISO {cam.iso}</span>
      {' · '}f/{cam.fNumber}
      {' · '}{shutterLabel(cam.ev)}
      {' · '}{cam.focalLength}mm
      {cam.focus != null ? <>{' · '}{cam.focus.toFixed(1)}m</> : null}
      {auto ? <span style={{ color: '#7ec48a' }}>{'  AE'}{cam.aeStops >= 0 ? '+' : ''}{cam.aeStops.toFixed(1)}</span> : null}
    </div>
  )
}
