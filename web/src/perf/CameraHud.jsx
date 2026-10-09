// Viewfinder readout: the sensor's current effective exposure state,
// published per frame by VisionPipeline on window.__renderCamera.
import { useEffect, useState } from 'react'

const wrap = {
  position: 'fixed', top: 12, right: 320, zIndex: 5, pointerEvents: 'none',
  background: 'rgba(16, 18, 22, 0.82)', color: '#cfd6dd', borderRadius: 6,
  font: '11px ui-monospace, monospace', padding: '7px 10px', letterSpacing: '0.03em',
  display: 'flex', gap: 10,
}

function shutterLabel(shutter) {
  return `1/${shutter || 60}`
}

export default function CameraHud() {
  const [cam, setCam] = useState(null)
  useEffect(() => {
    const id = setInterval(() => setCam(window.__renderCamera ? { ...window.__renderCamera } : null), 150)
    return () => clearInterval(id)
  }, [])
  if (!cam) return null
  const auto = cam.exposureMode !== 'manual'
  return (
    <div style={wrap}>
      <span style={{ color: '#e8b45a' }}>ISO {cam.iso}</span>
      <span>f/{cam.fNumber}</span>
      <span>{shutterLabel(cam.shutter)}</span>
      <span>{cam.focalLength}mm</span>
      {cam.focus != null ? <span>{cam.focus.toFixed(1)}m</span> : null}
      {auto ? <span style={{ color: '#7ec48a' }}>{'AE'}{cam.aeStops >= 0 ? '+' : ''}{cam.aeStops.toFixed(1)}</span> : null}
      {cam.taauTo ? (
        <span style={{ color: '#8aa4c4' }}>
          {cam.taauFrom ? `${cam.taauFrom[0]}×${cam.taauFrom[1]} → ` : ''}
          {cam.taauTo[0]}×{cam.taauTo[1]}
        </span>
      ) : null}
    </div>
  )
}
