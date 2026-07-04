import { useEffect, useRef, useState } from 'react'
import { useControls, folder, button } from 'leva'
import { SENSOR_PRESETS, PALETTES, DEFAULT_SENSOR } from '../sensors/presets.js'
import { CLUT_PRESETS } from '../palette/clutPresets.js'

const USER_PRESETS_KEY = 'titan.userPresets'

function loadUserPresets() {
  try {
    const raw = window.localStorage.getItem(USER_PRESETS_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function saveUserPresets(presets) {
  try {
    window.localStorage.setItem(USER_PRESETS_KEY, JSON.stringify(presets))
  } catch {
    // ignore quota/serialisation errors
  }
}

export function useSensorParams() {
  const [userPresets, setUserPresets] = useState(loadUserPresets)

  const merged = {
    ...SENSOR_PRESETS,
    ...Object.fromEntries(
      Object.entries(userPresets).map(([name, params]) => [`user:${name}`, { label: `★ ${name}`, ...params }])
    ),
  }

  const [{ sensor, scene, textures, moveMode, perf }, setGlobals] = useControls(() => ({
    sensor: {
      value: DEFAULT_SENSOR,
      options: Object.fromEntries(
        Object.entries(merged).map(([id, p]) => [p.label, id])
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
    moveMode: {
      value: 'orbit',
      options: ['orbit', 'fly', 'walk'],
      hint: 'fly = WASD/QE + click canvas for mouse look, Esc to release; walk = WASD + gravity, space to jump',
    },
    perf: {
      value: true,
      hint: 'FPS + per-pass timings',
    },
  }), [userPresets])

  const { timeOfDay, renderScale, upscaler, sharpen } = useControls({
    World: folder({
      timeOfDay: {
        value: 14, min: 0, max: 24, step: 0.25,
        hint: 'sun position/colour — both scenes',
      },
    }),
    Display: folder({
      renderScale: {
        value: 1, options: [0.25, 0.375, 0.5, 0.75, 1],
        hint: 'internal render resolution',
      },
      upscaler: {
        value: 'pixelated', options: ['pixelated', 'smooth'],
        hint: 'nearest vs bilinear upscale of the low-res render',
      },
      sharpen: {
        value: 0, min: 0, max: 1, step: 0.05,
        hint: 'RCAS sharpening (from AMD FSR)',
      },
    }),
  })

  const preset = SENSOR_PRESETS[DEFAULT_SENSOR]

  const [values, set] = useControls(() => ({
    Exposure: folder({
      exposureMode: {
        value: preset.exposureMode ?? 'manual',
        options: ['manual', 'auto-ev', 'auto-iso'],
        hint: 'auto meters the scene and lags toward mid-grey; auto-iso raises ISO instead of EV, so low light gets grainy like a real camera',
      },
      ev: { value: preset.ev, min: -4, max: 4, step: 0.1 },
      iso: { value: preset.iso, min: 100, max: 12800, step: 100 },
      fNumber: { value: preset.fNumber, min: 1.4, max: 16, step: 0.1 },
      dynamicRange: {
        value: preset.dynamicRange, min: 0, max: 12, step: 0.5,
        hint: 'stops; 0 = linear, higher lifts shadows',
      },
      whiteBalance: {
        value: preset.whiteBalance ?? 6500, min: 2500, max: 10000, step: 100,
        hint: 'colour temperature the sensor corrects for; 6500 = neutral daylight',
      },
      wbAuto: {
        value: preset.wbAuto ?? false,
        hint: 'gray-world auto white balance, lagged',
      },
      toneS: {
        value: preset.toneS ?? 0, min: 0, max: 1, step: 0.05,
        hint: 'filmic S-curve — toe/shoulder contrast on top of dynamic range',
      },
    }),
    Optics: folder({
      dof: { value: preset.dof },
      focusDistance: { value: preset.focusDistance, min: 1, max: 40, step: 0.5 },
      focalLength: {
        value: preset.focalLength, min: 18, max: 135, step: 1,
        hint: 'lens mm — drives FOV',
      },
      afMode: {
        value: preset.afMode,
        options: ['manual', 'instant', 'lazy', 'hunting'],
        hint: 'autofocus character; manual uses the focusDistance slider',
      },
    }),
    Lens: folder({
      vignette: {
        value: preset.vignette ?? 0, min: 0, max: 1, step: 0.05,
        hint: 'corner light falloff',
      },
      chromAb: {
        value: preset.chromAb ?? 0, min: 0, max: 1, step: 0.05,
        hint: 'chromatic aberration — colour fringing, cheap glass',
      },
      bloom: {
        value: preset.bloom ?? 0, min: 0, max: 1, step: 0.05,
        hint: 'highlight bloom/halation',
      },
    }),
    Dither: folder({
      ditherMode: {
        value: preset.ditherMode,
        options: ['bluenoise', 'floyd', 'atkinson', 'edapprox', 'bayer8', 'bayer4', 'ign', 'halftone', 'lines', 'white', 'none'],
      },
      levels: { value: preset.levels, min: 2, max: 16, step: 1 },
      ditherScale: { value: preset.ditherScale, min: 1, max: 8, step: 1 },
      pinning: { value: preset.pinning, options: ['off', 'rotation'] },
      isoAgitation: { value: preset.isoAgitation },
    }),
    Look: folder({
      colorMode: { value: preset.colorMode, options: ['rgb332', 'rgb', 'ramp'] },
      clutPreset: {
        value: preset.clutPreset,
        options: Object.fromEntries(
          Object.entries(CLUT_PRESETS).map(([id, p]) => [p.label, id])
        ),
        hint: 'palette for rgb332 mode; ramps below only apply in ramp mode',
      },
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
    Presets: folder({
      'save preset…': button(() => {
        const name = window.prompt('Preset name?')
        if (!name) return
        const next = { ...userPresetsRef.current, [name]: { ...valuesRef.current } }
        setUserPresets(next)
        saveUserPresets(next)
      }),
      'delete preset': button(() => {
        const currentSensor = sensorRef.current
        if (!currentSensor.startsWith('user:')) {
          console.warn('delete preset: select a user-saved preset first')
          return
        }
        const name = currentSensor.slice('user:'.length)
        const next = { ...userPresetsRef.current }
        delete next[name]
        setUserPresets(next)
        saveUserPresets(next)
        setGlobals({ sensor: DEFAULT_SENSOR })
      }),
    }),
  }))

  const valuesRef = useRef(values)
  useEffect(() => { valuesRef.current = values }, [values])

  const sensorRef = useRef(sensor)
  useEffect(() => { sensorRef.current = sensor }, [sensor])

  const userPresetsRef = useRef(userPresets)
  useEffect(() => { userPresetsRef.current = userPresets }, [userPresets])

  useEffect(() => {
    const activePreset = sensor.startsWith('user:')
      ? userPresets[sensor.slice('user:'.length)]
      : SENSOR_PRESETS[sensor]
    if (!activePreset) return
    const { label, ...rest } = activePreset
    set(rest)
  }, [sensor, userPresets, set])

  return { sensor, scene, textures, moveMode, perf, timeOfDay, renderScale, upscaler, sharpen, ...values }
}
