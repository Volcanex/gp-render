import { useEffect } from 'react'
import { useControls, folder } from 'leva'
import { SENSOR_PRESETS, PALETTES, DEFAULT_SENSOR } from '../sensors/presets.js'

export function useSensorParams() {
  const { sensor } = useControls({
    sensor: {
      value: DEFAULT_SENSOR,
      options: Object.fromEntries(
        Object.entries(SENSOR_PRESETS).map(([id, preset]) => [preset.label, id])
      ),
    },
  })

  const preset = SENSOR_PRESETS[DEFAULT_SENSOR]

  const [values, set] = useControls(() => ({
    Exposure: folder({
      ev: { value: preset.ev, min: -4, max: 4, step: 0.1 },
      iso: { value: preset.iso, min: 100, max: 12800, step: 100 },
    }),
    Dither: folder({
      ditherMode: { value: preset.ditherMode, options: ['bluenoise', 'bayer8', 'white', 'none'] },
      levels: { value: preset.levels, min: 2, max: 16, step: 1 },
      ditherScale: { value: preset.ditherScale, min: 1, max: 8, step: 1 },
      pinning: { value: preset.pinning, options: ['off', 'rotation'] },
    }),
    Look: folder({
      palette: { value: preset.palette, options: Object.keys(PALETTES) },
      pixelSize: { value: preset.pixelSize, min: 1, max: 8, step: 1 },
      outline: { value: preset.outline },
      outlineStrength: { value: preset.outlineStrength, min: 0, max: 2, step: 0.1 },
      grainAnimated: { value: preset.grainAnimated },
      band: { value: preset.band, options: ['visible', 'uv', 'ir'] },
    }),
  }))

  useEffect(() => {
    const { label, ...rest } = SENSOR_PRESETS[sensor]
    set(rest)
  }, [sensor, set])

  return { sensor, ...values }
}
