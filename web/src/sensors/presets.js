// Sensor model presets — the "camera hardware" catalogue.
// Every param here is overridable live from the Controls panel; a preset is
// just a starting point. This file is the interface contract between the
// effect modules, the UI, and the scene: keep the shape stable.
//
// Param shape (all effects read from this):
// {
//   ev: float            — exposure compensation, applied as color *= 2^ev (pre-quantise)
//   iso: float           — 100..12800; real sensor gain: brightness x iso/100
//                          (one stop per doubling), plus grain amplitude and
//                          optional dither agitation
//   fNumber: float       — aperture, 1.4..16; exposure gain = (5.6/f)^2 relative to
//                          f/5.6, and drives DOF bokeh + focus range when dof is on
//   dof: bool            — depth-of-field pass
//   focusDistance: float — manual focus distance in WORLD UNITS (afMode 'manual')
//   focalLength: float   — lens focal length in mm (full-frame equivalent);
//                          drives camera FOV: vfov = 2*atan(12/mm)
//   afMode: string       — autofocus character, applies when dof is on:
//                          'manual'  — the focusDistance slider
//                          'instant' — pro AF, snaps to what you look at
//                          'lazy'    — slow underdamped servo, overshoots
//                          'hunting' — cheap contrast-detect: sweeps, sometimes
//                                      misses and settles wrong before correcting
//   exposureMode: string — 'manual' | 'auto-ev' | 'auto-iso'; auto meters the
//                          scene and lags a correction toward mid-grey;
//                          auto-iso raises ISO instead of EV, so low light
//                          gets bright AND grainy like a real camera
//   whiteBalance: float  — Kelvin the sensor corrects for; 6500 = neutral
//   wbAuto: bool         — gray-world auto white balance (lagged)
//   toneS: float         — 0..1 filmic S-curve (toe/shoulder) on top of the
//                          dynamic-range response
//   vignette: float      — 0..1 corner light falloff
//   chromAb: float       — 0..1 chromatic aberration (radial colour fringing)
//   bloom: float         — 0..1 highlight bloom/halation
//   dynamicRange: float  — sensor latitude in stops; 0 = plain linear response
//                          (shadows crush fast), higher = log-encoded shadow lift,
//                          the "expensive sensor sees into the dark" lever
//   grain: bool          — ISO sensor-noise overlay on/off
//   grainAnimated: bool  — re-seed grain per frame (sensor noise) vs frozen
//   isoAgitation: bool   — ISO also jitters the dither threshold (boiling/blocky
//                          texture at high ISO); off = clean dither at any ISO
//   colorMode: string    — 'rgb332' (true 8-bit through the editable CLUT)
//                        | 'rgb'    (levels per channel, levels^3 colours)
//                        | 'ramp'   (luminance -> palette ramp, the 1-bit/Obra look)
//   levels: int          — quantisation levels; per channel in 'rgb', luminance
//                          steps in 'ramp' (2 = 1-bit look); ignored in 'rgb332'
//   ditherMode: string   — 'bluenoise' | 'bayer8' | 'bayer4' | 'ign' |
//                          'halftone' | 'lines' | 'white' | 'none'
//   ditherScale: float   — pattern magnification (1 = native, 2 = chunky)
//   pinning: string      — 'off' | 'rotation'  (Pope screen-offset)
//   palette: string      — ramp id from PALETTES below (ramp mode only)
//   clutPreset: string   — rgb332-mode palette: a preset id from
//                          palette/clutPresets.js ('identity', hardware
//                          palettes like 'c64'/'cga'/'zx', or ramp-derived
//                          tonal CLUTs). Loaded into the editable CLUT;
//                          manual palette-editor tweaks apply on top.
//   pixelSize: int       — pixelation pass; 1 = off
//   outline: bool        — depth+normal sobel outline overlay
//   outlineStrength: float
//   seeVisible: bool     — sensor sees the visible band (geometry scene only)
//   seeUv: bool          — sensor sees UV markings, rendered in uvColor
//   seeIr: bool          — sensor sees IR/heat, rendered in irColor
//   uvColor: string      — hex colour assigned to the UV band
//   irColor: string      — hex colour assigned to the IR band
// }
//
// Global (not per-preset), all top-level in ui/Controls.jsx: `scene`
// ('geometry'|'raymarch'), `moveMode` ('orbit'|'fly'|'walk'), `textures`,
// `perf`, `timeOfDay` (0..24 sun for both scenes), `renderScale` (internal
// render resolution), `upscaler` ('pixelated'|'smooth'), `sharpen` (RCAS).
// In rgb332 mode the quantised output is displayed through an editable
// 256-entry CLUT (palette/clut.js + palette/PaletteEditor.jsx).

export const PALETTES = {
  // id: array of hex stops, left = black, right = white; sampled as a 1D ramp
  mono:      ['#000000', '#ffffff'],
  paper:     ['#1a1712', '#e8e0cf'],
  phosphor:  ['#001500', '#00ff66'],
  amber:     ['#100800', '#ffb000'],
  cyanotype: ['#0a1a3f', '#cfe8ff'],
  uvviolet:  ['#0b0014', '#4a00b4', '#e0b0ff'],
  irheat:    ['#000000', '#5b0060', '#ff3800', '#ffe08a', '#ffffff'],
  gameboy:   ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'],
  cga:       ['#000000', '#55ffff', '#ff55ff', '#ffffff'],
  sepia:     ['#1f1409', '#704c1e', '#c49a5c', '#f0e2c0'],
  blueprint: ['#04123a', '#1450b4', '#8ab8f0', '#ffffff'],
  matrix:    ['#000000', '#003b00', '#00b400', '#8cff8c'],
  redalert:  ['#100000', '#7a0000', '#ff2020', '#ffd0d0'],
  vaporwave: ['#1a0533', '#ff2975', '#f8b0ff', '#00fff0'],
  dusk:      ['#12071f', '#5a2a6e', '#c86478', '#ffc86e'],
  arctic:    ['#0a1420', '#2e5f7a', '#9ed4e0', '#ffffff'],
  ember:     ['#000000', '#3d1204', '#c2440a', '#ffc93c'],
  slime:     ['#0b1400', '#3e6414', '#9ac33c', '#f0ffb4'],
  bone:      ['#101014', '#4e4a52', '#a8a29a', '#fffaf0'],
  oceanic:   ['#020c1e', '#0a3d62', '#1fa2a6', '#c8fff4'],
  // photographic / darkroom tones
  silver:    ['#0b0b0d', '#4a4a4e', '#9c9c9e', '#faf8f2'],
  selenium:  ['#0d0b10', '#3d3644', '#8f8494', '#f2eef4'],
  platinum:  ['#141210', '#57504a', '#a89f95', '#f4efe6'],
  trix:      ['#050505', '#2e2c2a', '#787470', '#e8e4dc'],
  polaroid:  ['#1c1a14', '#6e6252', '#c9b898', '#fdf6e3'],
  aerochrome: ['#140208', '#8c1226', '#e6543c', '#ffd9c2'],
  nvgwhite:  ['#000000', '#3c4440', '#9fb0a8', '#eef4f0'],
  tungsten:  ['#100a04', '#5c3c1a', '#c98f4a', '#ffe9c4'],
  kodalith:  ['#0a0604', '#c41e10', '#ff9e2c', '#fff3d6'],
}

export const SENSOR_PRESETS = {
  eye: {
    label: 'Clean (debug baseline)',
    ev: 0, iso: 100, fNumber: 4, dof: false, focusDistance: 8, focalLength: 35, afMode: 'manual',
    exposureMode: 'manual', whiteBalance: 6500, wbAuto: false,
    aeBias: 0,
    toneS: 0, vignette: 0, chromAb: 0, bloom: 0,
    dynamicRange: 0, grain: false, grainAnimated: false, isoAgitation: false,
    colorMode: 'rgb', levels: 16, ditherMode: 'bluenoise', ditherScale: 1,
    pinning: 'rotation', palette: 'silver', pixelSize: 1, clutPreset: 'identity',
    outline: false, outlineStrength: 0,
    seeVisible: true, seeUv: false, seeIr: false, uvGain: 1, irGain: 1,
    uvColor: '#9040ff', irColor: '#ff5020',
  },
  cine: {
    label: 'Cine Prime 50',
    ev: -4, iso: 200, fNumber: 1.8, dof: true, focusDistance: 8, focalLength: 50, afMode: 'cinerack',
    exposureMode: 'manual', whiteBalance: 5600, wbAuto: false,
    aeBias: 0,
    toneS: 0.6, vignette: 0.25, chromAb: 0.08, bloom: 0.3,
    dynamicRange: 8, grain: true, grainAnimated: true, isoAgitation: false,
    colorMode: 'rgb', levels: 12, ditherMode: 'bluenoise', ditherScale: 1,
    pinning: 'rotation', palette: 'tungsten', pixelSize: 1, clutPreset: 'identity',
    outline: false, outlineStrength: 0,
    seeVisible: true, seeUv: false, seeIr: false, uvGain: 1, irGain: 1,
    uvColor: '#9040ff', irColor: '#ff5020',
  },
  handycam: {
    label: 'Handycam 98',
    ev: 0, iso: 400, fNumber: 4, dof: true, focusDistance: 8, focalLength: 28, afMode: 'hunting',
    exposureMode: 'auto-ev', whiteBalance: 6500, wbAuto: true,
    aeBias: 0,
    toneS: 0.2, vignette: 0.3, chromAb: 0.35, bloom: 0.15,
    dynamicRange: 4, grain: true, grainAnimated: true, isoAgitation: true,
    colorMode: 'rgb', levels: 6, ditherMode: 'ign', ditherScale: 1,
    pinning: 'off', palette: 'polaroid', pixelSize: 1, clutPreset: 'identity',
    outline: false, outlineStrength: 0,
    seeVisible: true, seeUv: false, seeIr: false, uvGain: 1, irGain: 1,
    uvColor: '#9040ff', irColor: '#ff5020',
  },
  press: {
    label: 'Press Mono 400',
    ev: -2, iso: 400, fNumber: 8, dof: true, focusDistance: 10, afMode: 'zone', focalLength: 35,
    exposureMode: 'manual', whiteBalance: 6500, wbAuto: false,
    aeBias: 0,
    toneS: 0.5, vignette: 0.2, chromAb: 0, bloom: 0.05,
    dynamicRange: 7, grain: true, grainAnimated: false, isoAgitation: false,
    colorMode: 'ramp', levels: 6, ditherMode: 'edapprox', ditherScale: 1,
    pinning: 'rotation', palette: 'trix', pixelSize: 1, clutPreset: 'identity',
    outline: false, outlineStrength: 0,
    seeVisible: true, seeUv: false, seeIr: false, uvGain: 1, irGain: 1,
    uvColor: '#9040ff', irColor: '#ff5020',
  },
  aerochrome: {
    label: 'Aerochrome IR',
    ev: -1, iso: 200, fNumber: 5.6, dof: false, focusDistance: 10, focalLength: 40, afMode: 'manual',
    exposureMode: 'manual', whiteBalance: 6500, wbAuto: false,
    aeBias: 0,
    toneS: 0.5, vignette: 0.2, chromAb: 0.05, bloom: 0.2,
    dynamicRange: 7, grain: true, grainAnimated: false, isoAgitation: false,
    colorMode: 'rgb', levels: 10, ditherMode: 'bluenoise', ditherScale: 1,
    pinning: 'rotation', palette: 'aerochrome', pixelSize: 1, clutPreset: 'identity',
    outline: false, outlineStrength: 0,
    seeVisible: true, seeUv: false, seeIr: true, uvGain: 1, irGain: 1.4,
    uvColor: '#9040ff', irColor: '#ff2038',
  },
  gen3: {
    label: 'NightOps Gen3',
    ev: 1, iso: 800, fNumber: 1.4, dof: false, focusDistance: 8, focalLength: 24, afMode: 'zone',
    exposureMode: 'auto-iso', whiteBalance: 6500, wbAuto: false,
    aeBias: -0.5,
    toneS: 0.3, vignette: 0.5, chromAb: 0.1, bloom: 0.5,
    dynamicRange: 9, grain: true, grainAnimated: true, isoAgitation: true,
    colorMode: 'ramp', levels: 8, ditherMode: 'bluenoise', ditherScale: 1,
    pinning: 'off', palette: 'phosphor', pixelSize: 1, clutPreset: 'identity',
    outline: false, outlineStrength: 0,
    seeVisible: true, seeUv: false, seeIr: true, uvGain: 1, irGain: 0.6,
    uvColor: '#9040ff', irColor: '#c8ffd8',
  },
  thermal: {
    label: 'MWIR Thermal',
    ev: 0, iso: 1600, fNumber: 2, dof: false, focusDistance: 12, focalLength: 60, afMode: 'lazy',
    exposureMode: 'manual', whiteBalance: 6500, wbAuto: false,
    aeBias: 0,
    toneS: 0.2, vignette: 0.45, chromAb: 0.15, bloom: 0.4,
    dynamicRange: 8, grain: true, grainAnimated: true, isoAgitation: true,
    colorMode: 'ramp', levels: 10, ditherMode: 'bluenoise', ditherScale: 1,
    pinning: 'off', palette: 'irheat', pixelSize: 1, clutPreset: 'identity',
    outline: false, outlineStrength: 0,
    seeVisible: false, seeUv: false, seeIr: true, uvGain: 1, irGain: 1.6,
    uvColor: '#9040ff', irColor: '#ff9a40',
  },
  forensic: {
    label: 'Forensic UV',
    ev: 1, iso: 800, fNumber: 2.8, dof: true, focusDistance: 5, focalLength: 24, afMode: 'macro',
    exposureMode: 'manual', whiteBalance: 6500, wbAuto: false,
    aeBias: 0,
    toneS: 0.35, vignette: 0.4, chromAb: 0.2, bloom: 0.35,
    dynamicRange: 8, grain: true, grainAnimated: true, isoAgitation: false,
    colorMode: 'ramp', levels: 6, ditherMode: 'bluenoise', ditherScale: 1,
    pinning: 'rotation', palette: 'uvviolet', pixelSize: 1, clutPreset: 'identity',
    outline: false, outlineStrength: 0,
    seeVisible: false, seeUv: true, seeIr: false, uvGain: 1.5, irGain: 1,
    uvColor: '#b070ff', irColor: '#ff5020',
  },
  monastic: {
    label: 'Monastic (1-bit)',
    ev: -2, iso: 400, fNumber: 5.6, dof: false, focusDistance: 8, focalLength: 32, afMode: 'manual',
    exposureMode: 'manual', whiteBalance: 6500, wbAuto: false,
    aeBias: 0,
    toneS: 0.3, vignette: 0.2, chromAb: 0, bloom: 0,
    dynamicRange: 4, grain: true, grainAnimated: true, isoAgitation: true,
    colorMode: 'ramp', levels: 2, ditherMode: 'bluenoise', ditherScale: 1,
    pinning: 'rotation', palette: 'paper', pixelSize: 1, clutPreset: 'identity',
    outline: true, outlineStrength: 1,
    seeVisible: true, seeUv: false, seeIr: false, uvGain: 1, irGain: 1,
    uvColor: '#9040ff', irColor: '#ff5020',
  },
}

export const DEFAULT_SENSOR = 'eye'
