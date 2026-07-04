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
//                          f/5.6, and drives DOF bokeh when dof is on
//   dof: bool            — depth-of-field pass (bokehScale scales with 1/fNumber)
//   focusDistance: float — 0..1 normalised focus distance for the DOF pass
//   colorMode: string    — 'rgb332' (true 8-bit: 3-3-2 bits = 256 colours)
//                        | 'rgb'    (levels per channel, levels^3 colours)
//                        | 'ramp'   (luminance -> palette ramp, the 1-bit/Obra look)
//   levels: int          — quantisation levels; per channel in 'rgb', luminance
//                          steps in 'ramp' (2 = 1-bit look); ignored in 'rgb332'
//   ditherMode: string   — 'bluenoise' | 'bayer8' | 'white' | 'none'
//   ditherScale: float   — pattern magnification (1 = native, 2 = chunky)
//   pinning: string      — 'off' | 'rotation'  (Pope screen-offset: dither
//                          offset = screenSize * cameraRotation / fov)
//   palette: string      — ramp id from PALETTES below
//   pixelSize: int       — pixelation pass; 1 = off
//   outline: bool        — depth+normal sobel outline overlay
//   outlineStrength: float
//   grainAnimated: bool  — re-seed grain per frame (sensor noise) vs frozen
//   band: string         — 'visible' | 'uv' | 'ir'  (spectrum the sensor sees;
//                          geometry scene only — the raymarch scene ignores it)
// }
//
// Global (not per-preset): `scene` — 'geometry' | 'raymarch', a top-level
// control in ui/Controls.jsx choosing which scene the sensor looks at.
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
}

export const SENSOR_PRESETS = {
  mk1: {
    label: 'MK-1 Optic (stock)',
    ev: 0, iso: 400, fNumber: 5.6, dof: false, focusDistance: 0.05,
    colorMode: 'rgb332', levels: 2, ditherMode: 'bluenoise', ditherScale: 1,
    pinning: 'rotation', palette: 'paper', pixelSize: 1,
    outline: true, outlineStrength: 1, grainAnimated: true, band: 'visible',
  },
  cine: {
    label: 'Cine Gate (shallow)',
    ev: -3, iso: 200, fNumber: 1.8, dof: true, focusDistance: 0.05,
    colorMode: 'rgb', levels: 8, ditherMode: 'bluenoise', ditherScale: 1,
    pinning: 'rotation', palette: 'paper', pixelSize: 1,
    outline: false, outlineStrength: 0, grainAnimated: true, band: 'visible',
  },
  monastic: {
    label: 'Monastic (1-bit)',
    ev: 0, iso: 400, fNumber: 5.6, dof: false, focusDistance: 0.05,
    colorMode: 'ramp', levels: 2, ditherMode: 'bluenoise', ditherScale: 1,
    pinning: 'rotation', palette: 'paper', pixelSize: 1,
    outline: true, outlineStrength: 1, grainAnimated: true, band: 'visible',
  },
  salvage: {
    label: 'Salvage CCD (cheap)',
    ev: -0.5, iso: 1600, fNumber: 8, dof: false, focusDistance: 0.05,
    colorMode: 'rgb', levels: 3, ditherMode: 'white', ditherScale: 2,
    pinning: 'off', palette: 'mono', pixelSize: 3,
    outline: false, outlineStrength: 0, grainAnimated: true, band: 'visible',
  },
  bayerCorp: {
    label: 'Ordnance Grid (bayer)',
    ev: 0, iso: 200, fNumber: 4, dof: false, focusDistance: 0.05,
    colorMode: 'rgb', levels: 4, ditherMode: 'bayer8', ditherScale: 1,
    pinning: 'rotation', palette: 'phosphor', pixelSize: 2,
    outline: true, outlineStrength: 1, grainAnimated: false, band: 'visible',
  },
  uvscope: {
    label: 'UV Scope',
    ev: 1, iso: 800, fNumber: 2.8, dof: false, focusDistance: 0.05,
    colorMode: 'ramp', levels: 3, ditherMode: 'bluenoise', ditherScale: 1,
    pinning: 'rotation', palette: 'uvviolet', pixelSize: 2,
    outline: true, outlineStrength: 0.6, grainAnimated: true, band: 'uv',
  },
  irscope: {
    label: 'IR Thermal',
    ev: 0, iso: 3200, fNumber: 2, dof: false, focusDistance: 0.05,
    colorMode: 'ramp', levels: 8, ditherMode: 'bluenoise', ditherScale: 2,
    pinning: 'off', palette: 'irheat', pixelSize: 4,
    outline: false, outlineStrength: 0, grainAnimated: true, band: 'ir',
  },
  handheld: {
    label: 'Handheld (gameboy)',
    ev: 0, iso: 100, fNumber: 11, dof: false, focusDistance: 0.05,
    colorMode: 'ramp', levels: 4, ditherMode: 'bayer8', ditherScale: 2,
    pinning: 'off', palette: 'gameboy', pixelSize: 4,
    outline: false, outlineStrength: 0, grainAnimated: false, band: 'visible',
  },
}

export const DEFAULT_SENSOR = 'mk1'
