import { useEffect, useRef, useState } from 'react'
import { useControls, folder, button } from 'leva'
import { SENSOR_PRESETS, PALETTES, DEFAULT_SENSOR } from '../sensors/presets.js'
import { CLUT_PRESETS } from '../palette/clutPresets.js'

const USER_PRESETS_KEY = 'titan.userPresets'

let focalSetterRef = null

export function setFocalLength(mm) {
  if (!focalSetterRef) {
    console.warn('setFocalLength: called before Controls mounted')
    return
  }
  focalSetterRef(mm)
}

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

const GEN_OPTIONS = [
  'value', 'perlin', 'simplex', 'worley', 'worleyEdge', 'fbm', 'ridged', 'billow',
  'warp', 'swirl', 'marble', 'wood', 'cracks', 'craters', 'scales', 'hex', 'dots',
  'caustics', 'truchet', 'stripes', 'checker', 'terrace', 'julia', 'plasma',
]
const BLEND_OPTIONS = ['add', 'mul', 'overlay', 'screen', 'mix', 'max']

function materialLayerFolder(i) {
  const on = i === 1
  const amount = i === 1 ? 1 : 0.5
  return folder({
    [`l${i}on`]: { value: on },
    [`l${i}gen`]: { value: 'fbm', options: GEN_OPTIONS },
    [`l${i}scale`]: { value: 6, min: 0.5, max: 40, step: 0.1 },
    [`l${i}octaves`]: { value: 4, min: 1, max: 8, step: 1 },
    [`l${i}amount`]: { value: amount, min: 0, max: 1, step: 0.01 },
    [`l${i}blend`]: { value: 'mix', options: BLEND_OPTIONS },
  })
}

export function useMaterialLab() {
  return useControls(() => ({
    'Material Lab': folder({
      matName: { value: 'material' },
      ramp: {
        value: 'basalt',
        options: ['basalt', 'rust', 'ice', 'sandstone', 'moss', 'steel', 'clay', 'obsidian', 'bone', 'walnut', 'nebula', 'copper', 'lichen'],
      },
      roughnessBase: { value: 0.8, min: 0, max: 1, step: 0.01 },
      roughnessContrast: { value: 0.3, min: -1, max: 1, step: 0.01 },
      normalStrength: { value: 1, min: 0, max: 3, step: 0.05 },
      'Layer 1': materialLayerFolder(1),
      'Layer 2': materialLayerFolder(2),
      'Layer 3': materialLayerFolder(3),
      'Layer 4': materialLayerFolder(4),
      'reroll wall': button(() => window.dispatchEvent(new Event('titan:mat-reroll'))),
      'save material': button(() => window.dispatchEvent(new Event('titan:mat-save'))),
    }),
  }))
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
      options: ['geometry', 'titan', 'raymarch', 'materials'],
      hint: 'spectrum (uv/ir) only applies to the geometry scene; materials = generated-texture gallery',
    },
    textures: {
      value: true,
      hint: 'procedural texturing in the geometry scene',
    },
    moveMode: {
      value: 'walk',
      options: ['orbit', 'fly', 'walk'],
      hint: 'fly = WASD/QE + click canvas for mouse look, Esc to release; walk = WASD + gravity, space to jump',
    },
    perf: {
      value: true,
      hint: 'FPS + per-pass timings',
    },
  }), [userPresets])

  const {
    timeOfDay, renderScaleX, renderScaleY, outputScale, sharpen, taauEnabled, aa, ao, aoStrength, fogDensity, fogHeight, godRays,
    taauBlend, taauGamma, taauKernel, taauLumaReject, taauFilter, taauDebug,
  } = useControls({
    World: folder({
      timeOfDay: {
        value: 14, min: 0, max: 24, step: 0.25,
        hint: 'sun position/colour — both scenes',
      },
      fogDensity: {
        value: 0.011, min: 0, max: 0.04, step: 0.001,
        hint: 'titan volumetric fog thickness',
      },
      fogHeight: {
        value: 4.5, min: 1, max: 12, step: 0.5,
        hint: 'how high the fog pools',
      },
      godRays: {
        value: 0.25, min: 0, max: 1, step: 0.05,
        hint: 'screen-space crepuscular rays from the sun — strongest at low sun angles',
      },
    }),
    Display: folder({
      taauEnabled: {
        value: true,
        hint: 'temporal upscaling on/off — off = plain render at output resolution, for A/B comparison',
      },
      ao: {
        value: true,
        hint: 'depth-based ambient occlusion — soft contact shading, works with the temporal upscaler',
      },
      aoStrength: {
        value: 0.5, min: 0, max: 1, step: 0.05,
      },
      renderScaleX: {
        value: 0.5, min: 0.2, max: 1, step: 0.01,
        hint: 'internal render scale per axis — non-matching ratios give interlace-style reconstruction',
      },
      renderScaleY: {
        value: 0.5, min: 0.2, max: 1, step: 0.01,
        hint: 'internal render scale per axis — non-matching ratios give interlace-style reconstruction',
      },
      outputScale: {
        value: 1, options: [1, 1.5, 2],
        hint: 'output multiplier — 2 on a 1080p window ≈ supersampled 4K',
      },
      sharpen: {
        value: 0.2, min: 0, max: 1, step: 0.05,
        hint: 'RCAS sharpening (from AMD FSR)',
      },
      aa: {
        value: false,
        hint: 'extra SMAA pass on top of TAAU — catches residual geometric edges, small GPU cost',
      },
    }),
    TAAU: folder({
      taauBlend: {
        value: 0.92, min: 0.5, max: 0.98, step: 0.01,
        hint: 'history weight — higher = smoother/more stable, lower = more responsive',
      },
      taauGamma: {
        value: 1.5, min: 0.25, max: 4, step: 0.05,
        hint: 'variance clip tightness — lower kills ghosting but shimmers, higher smooths but ghosts',
      },
      taauKernel: {
        value: 2.9, min: 0.5, max: 6, step: 0.1,
        hint: 'sample confidence sharpness — higher = crisper, slower convergence',
      },
      taauLumaReject: {
        value: 0.3, min: 0, max: 1, step: 0.05,
        hint: 'luminance-change rejection — 0 stable, 1 reactive',
      },
      taauFilter: {
        value: 'catmullrom', options: ['catmullrom', 'bilinear'],
        hint: 'history resampling — catmullrom fights blur',
      },
      taauDebug: {
        value: 'off', options: ['off', 'confidence', 'clip', 'history', 'motion'],
        hint: 'diagnostic views: clip shows instability hotspots, motion shows reprojection error',
      },
    }),
  })

  const preset = SENSOR_PRESETS[DEFAULT_SENSOR]

  const [values, set] = useControls(() => ({
    Exposure: folder({
      exposureMode: {
        value: preset.exposureMode ?? 'manual',
        options: ['manual', 'auto-iso', 'auto-shutter', 'auto-aperture', 'auto-ev'],
        hint: 'priority modes: fix everything else, the named variable floats to meet the meter (auto-iso→grain, auto-shutter→roll/brightness, auto-aperture→depth of field)',
      },
      ev: { value: preset.ev, min: -8, max: 6, step: 0.1 },
      iso: {
        value: preset.iso, min: 25, max: 25600, step: 25,
        hint: 'base ISO sensitivity — auto-iso trades gain from here against the aperture',
      },
      fNumber: { value: preset.fNumber, min: 1.4, max: 16, step: 0.1 },
      shutter: {
        value: preset.shutter ?? 60,
        options: [15, 30, 60, 125, 250, 500, 1000],
        hint: 'shutter speed 1/N — slower = brighter (+ more rolling-shutter skew), faster = darker',
      },
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
      aeBias: {
        value: preset.aeBias ?? 0, min: -3, max: 3, step: 0.1,
        hint: "auto-exposure compensation — negative keeps dark scenes dark, like a real camera's +/- dial",
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
        options: ['manual', 'instant', 'lazy', 'hunting', 'zone', 'cinerack', 'macro'],
        hint: 'autofocus character; manual uses the focusDistance slider. zone = stable area AF; cinerack = smooth constant-speed focus pull; macro = close-up biased, hunts on far targets',
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
      rollingShutter: {
        value: preset.rollingShutter ?? 0, min: 0, max: 1, step: 0.05,
        hint: 'sensor readout skew — verticals lean when panning, jello under shake; no blur',
      },
      motionBlur: {
        value: preset.motionBlur ?? 0, min: 0, max: 1, step: 0.05,
        hint: 'camera motion blur — off by default, it rarely feels right in games',
      },
      flare: {
        value: preset.flare ?? 0, min: 0, max: 1, step: 0.05,
        hint: 'internal-reflection ghosts from bright sources',
      },
      anamorphic: {
        value: preset.anamorphic ?? 0, min: 0, max: 1, step: 0.05,
        hint: 'horizontal blue streak from highlights',
      },
      halation: {
        value: preset.halation ?? 0, min: 0, max: 1, step: 0.05,
        hint: 'film halation — red-orange glow bleeding around highlights',
      },
      gateWeave: {
        value: preset.gateWeave ?? 0, min: 0, max: 1, step: 0.05,
        hint: 'analog gate weave — slow frame drift and pull-down bumps',
      },
      dust: {
        value: preset.dust ?? 0, min: 0, max: 1, step: 0.05,
        hint: 'film dust and scratches, per-frame',
      },
    }),
    Signal: folder({
      crt: {
        value: preset.crt ?? 0, min: 0, max: 1, step: 0.05,
        hint: 'CRT display simulation — scanlines, phosphor mask, refresh band; applied after the dither, like a real monitor',
      },
      crtCurve: {
        value: preset.crtCurve ?? 0, min: 0, max: 0.35, step: 0.01,
        hint: 'barrel curvature + bezel',
      },
      crtMask: {
        value: preset.crtMask ?? 'grille',
        options: ['grille', 'slot', 'dot'],
        hint: 'phosphor mask pattern',
      },
      crtFlicker: {
        value: preset.crtFlicker ?? 0, min: 0, max: 1, step: 0.05,
        hint: 'CRT refresh-band flicker — 0 = temporally rock-solid screen',
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
      colorMode: {
        value: preset.colorMode,
        options: ['true', 'rgb332', 'rgb', 'ramp'],
        hint: 'true = full 24-bit colour, no quantisation or dithering',
      },
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
      uvGain: { value: preset.uvGain ?? 1, min: 0, max: 2, step: 0.05, hint: 'band sensitivity' },
      irGain: { value: preset.irGain ?? 1, min: 0, max: 2, step: 0.05, hint: 'band sensitivity' },
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

  focalSetterRef = (mm) => set({ focalLength: Math.round(Math.min(135, Math.max(18, mm))) })

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

  return {
    sensor, scene, textures, moveMode, perf,
    timeOfDay, renderScaleX, renderScaleY, outputScale, sharpen, taauEnabled, aa, ao, aoStrength, fogDensity, fogHeight, godRays,
    taauBlend, taauGamma, taauKernel, taauLumaReject, taauFilter, taauDebug,
    ...values,
  }
}
