// Sensor model presets — the "camera hardware" catalogue.
// Every param here is overridable live from the Controls panel; a preset is
// just a starting point. This file is the interface contract between the
// effect modules, the UI, and the scene: keep the shape stable.
//
// Param shape (all effects read from this):
// {
//   ev: float            — exposure compensation, applied as color *= 2^ev (pre-quantise)
//   iso: float           — 100..12800; drives grain amplitude AND dither agitation
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
// Global (not per-preset): `scene` — 'geometry' | 'raymarch' — and
// `moveMode` — 'orbit' | 'fly' (WASD/QE noclip with pointer-lock mouse look),
// both top-level controls in ui/Controls.jsx.
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
}

export const SENSOR_PRESETS = {
  mk1: {
    label: 'MK-1 Optic (stock)',
    ev: 0, iso: 400, fNumber: 5.6, dof: false, focusDistance: 8, focalLength: 32, afMode: 'instant',
    dynamicRange: 6, grain: true, grainAnimated: true, isoAgitation: false,
    colorMode: 'rgb332', levels: 2, ditherMode: 'bluenoise', ditherScale: 1,
    pinning: 'rotation', palette: 'paper', pixelSize: 1, clutPreset: 'identity',
    outline: false, outlineStrength: 1,
    seeVisible: true, seeUv: false, seeIr: false,
    uvColor: '#9040ff', irColor: '#ff5020',
  },
  cine: {
    label: 'Cine Gate (shallow)',
    ev: -3, iso: 200, fNumber: 1.8, dof: true, focusDistance: 8, focalLength: 50, afMode: 'lazy',
    dynamicRange: 6, grain: true, grainAnimated: true, isoAgitation: false,
    colorMode: 'rgb', levels: 8, ditherMode: 'bluenoise', ditherScale: 1,
    pinning: 'rotation', palette: 'paper', pixelSize: 1, clutPreset: 'identity',
    outline: false, outlineStrength: 0,
    seeVisible: true, seeUv: false, seeIr: false,
    uvColor: '#9040ff', irColor: '#ff5020',
  },
  monastic: {
    label: 'Monastic (1-bit)',
    ev: 0, iso: 400, fNumber: 5.6, dof: false, focusDistance: 8, focalLength: 32, afMode: 'manual',
    dynamicRange: 4, grain: true, grainAnimated: true, isoAgitation: true,
    colorMode: 'ramp', levels: 2, ditherMode: 'bluenoise', ditherScale: 1,
    pinning: 'rotation', palette: 'paper', pixelSize: 1, clutPreset: 'identity',
    outline: true, outlineStrength: 1,
    seeVisible: true, seeUv: false, seeIr: false,
    uvColor: '#9040ff', irColor: '#ff5020',
  },
  salvage: {
    label: 'Salvage CCD (cheap)',
    ev: -0.5, iso: 1600, fNumber: 8, dof: false, focusDistance: 8, focalLength: 28, afMode: 'hunting',
    dynamicRange: 0, grain: true, grainAnimated: true, isoAgitation: true,
    colorMode: 'rgb', levels: 3, ditherMode: 'white', ditherScale: 2,
    pinning: 'off', palette: 'mono', pixelSize: 3, clutPreset: 'identity',
    outline: false, outlineStrength: 0,
    seeVisible: true, seeUv: false, seeIr: false,
    uvColor: '#9040ff', irColor: '#ff5020',
  },
  bayerCorp: {
    label: 'Ordnance Grid (bayer)',
    ev: 0, iso: 200, fNumber: 4, dof: false, focusDistance: 8, focalLength: 35, afMode: 'instant',
    dynamicRange: 5, grain: false, grainAnimated: false, isoAgitation: false,
    colorMode: 'rgb', levels: 4, ditherMode: 'bayer8', ditherScale: 1,
    pinning: 'rotation', palette: 'phosphor', pixelSize: 2, clutPreset: 'identity',
    outline: true, outlineStrength: 1,
    seeVisible: true, seeUv: false, seeIr: false,
    uvColor: '#9040ff', irColor: '#ff5020',
  },
  uvscope: {
    label: 'UV Scope',
    ev: 1, iso: 800, fNumber: 2.8, dof: false, focusDistance: 8, focalLength: 24, afMode: 'instant',
    dynamicRange: 7, grain: true, grainAnimated: true, isoAgitation: false,
    colorMode: 'ramp', levels: 3, ditherMode: 'bluenoise', ditherScale: 1,
    pinning: 'rotation', palette: 'uvviolet', pixelSize: 2, clutPreset: 'identity',
    outline: true, outlineStrength: 0.6,
    seeVisible: false, seeUv: true, seeIr: false,
    uvColor: '#b070ff', irColor: '#ff5020',
  },
  irscope: {
    label: 'IR Thermal',
    ev: 0, iso: 3200, fNumber: 2, dof: false, focusDistance: 8, focalLength: 60, afMode: 'lazy',
    dynamicRange: 6, grain: true, grainAnimated: true, isoAgitation: true,
    colorMode: 'ramp', levels: 8, ditherMode: 'bluenoise', ditherScale: 2,
    pinning: 'off', palette: 'irheat', pixelSize: 4, clutPreset: 'identity',
    outline: false, outlineStrength: 0,
    seeVisible: false, seeUv: false, seeIr: true,
    uvColor: '#9040ff', irColor: '#ff9a40',
  },
  fullspectrum: {
    label: 'Full Spectrum (vis+uv+ir)',
    ev: 0, iso: 800, fNumber: 4, dof: false, focusDistance: 8, focalLength: 35, afMode: 'instant',
    dynamicRange: 5, grain: true, grainAnimated: true, isoAgitation: false,
    colorMode: 'rgb332', levels: 2, ditherMode: 'bluenoise', ditherScale: 1,
    pinning: 'rotation', palette: 'paper', pixelSize: 1, clutPreset: 'identity',
    outline: true, outlineStrength: 0.8,
    seeVisible: true, seeUv: true, seeIr: true,
    uvColor: '#9040ff', irColor: '#ff5020',
  },
  handheld: {
    label: 'Handheld (gameboy)',
    ev: 0, iso: 100, fNumber: 11, dof: false, focusDistance: 8, focalLength: 26, afMode: 'manual',
    dynamicRange: 3, grain: false, grainAnimated: false, isoAgitation: false,
    colorMode: 'ramp', levels: 4, ditherMode: 'bayer8', ditherScale: 2,
    pinning: 'off', palette: 'gameboy', pixelSize: 4, clutPreset: 'identity',
    outline: false, outlineStrength: 0,
    seeVisible: true, seeUv: false, seeIr: false,
    uvColor: '#9040ff', irColor: '#ff5020',
  },
}

export const DEFAULT_SENSOR = 'mk1'
