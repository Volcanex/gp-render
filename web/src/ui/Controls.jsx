import { useEffect } from 'react'
import { useControls, folder } from 'leva'
import { SENSOR_PRESETS, PALETTES, DEFAULT_SENSOR } from '../sensors/presets.js'

export function useSensorParams() {
  const { sensor, scene, textures } = useControls({
    sensor: {
      value: DEFAULT_SENSOR,
      options: Object.fromEntries(
        Object.entries(SENSOR_PRESETS).map(([id, preset]) => [preset.label, id])
      ),
    },
    scene: {
      value: 'geometry',
      options: ['geometry', 'raymarch'],
      hint: 'spectrum (uv/ir) only applies to the geometry scene',
    },
    textures: {
      value: true,
      hint: 'procedural texturing in the geometry scene',
    },
  })

  const preset = SENSOR_PRESETS[DEFAULT_SENSOR]

  const [values, set] = useControls(() => ({
    Exposure: folder({
      ev: { value: preset.ev, min: -4, max: 4, step: 0.1 },
      iso: { value: preset.iso, min: 100, max: 12800, step: 100 },
      fNumber: { value: preset.fNumber, min: 1.4, max: 16, step: 0.1 },
      dynamicRange: {
        value: preset.dynamicRange, min: 0, max: 12, step: 0.5,
        hint: 'stops; 0 = linear, higher lifts shadows',
      },
    }),
    Optics: folder({
      dof: { value: preset.dof },
      focusDistance: { value: preset.focusDistance, min: 1, max: 40, step: 0.5 },
    }),
    Dither: folder({
      ditherMode: {
        value: preset.ditherMode,
        options: ['bluenoise', 'floyd', 'atkinson', 'bayer8', 'bayer4', 'ign', 'halftone', 'lines', 'white', 'none'],
      },
      levels: { value: preset.levels, min: 2, max: 16, step: 1 },
      ditherScale: { value: preset.ditherScale, min: 1, max: 8, step: 1 },
      pinning: { value: preset.pinning, options: ['off', 'rotation'] },
      isoAgitation: { value: preset.isoAgitation },
    }),
    Look: folder({
      colorMode: { value: preset.colorMode, options: ['rgb332', 'rgb', 'ramp'] },
      palette: { value: preset.palette, options: Object.keys(PALETTES) },
      pixelSize: { value: preset.pixelSize, min: 1, max: 8, step: 1 },
      outline: { value: preset.outline },
      outlineStrength: { value: preset.outlineStrength, min: 0, max: 2, step: 0.1 },
      grain: { value: preset.grain },
      grainAnimated: { value: preset.grainAnimated },
    }),
    Spectrum: folder({
      seeVisible: { value: preset.seeVisible, hint: 'spectrum applies to the geometry scene only' },
      seeUv: { value: preset.seeUv },
      seeIr: { value: preset.seeIr },
      uvColor: { value: preset.uvColor },
      irColor: { value: preset.irColor },
    }),
  }))

  useEffect(() => {
    const { label, ...rest } = SENSOR_PRESETS[sensor]
    set(rest)
  }, [sensor, set])

  return { sensor, scene, textures, ...values }
}
