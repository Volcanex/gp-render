// Sensor model presets — the "camera hardware" catalogue.
// Every param here is overridable live from the Controls panel; a preset is
// just a starting point. This file is the interface contract between the
// effect modules, the UI, and the scene: keep the shape stable.
//
// Param shape (all effects read from this):
// {
//   ev: float            — exposure compensation, applied as color *= 2^ev (pre-quantise)
//   iso: float           — 100..12800; drives grain amplitude AND dither agitation
//   levels: int          — quantisation levels per channel (2 = 1-bit look)
//   ditherMode: string   — 'bluenoise' | 'bayer8' | 'white' | 'none'
//   ditherScale: float   — pattern magnification (1 = native, 2 = chunky)
//   pinning: string      — 'off' | 'rotation'  (Pope screen-offset: dither
//                          offset = screenSize * cameraRotation / fov)
//   palette: string      — ramp id from PALETTES below
//   pixelSize: int       — pixelation pass; 1 = off
//   outline: bool        — depth+normal sobel outline overlay
//   outlineStrength: float
//   grainAnimated: bool  — re-seed grain per frame (sensor noise) vs frozen
//   band: string         — 'visible' | 'uv' | 'ir'  (spectrum the sensor sees)
// }

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
    ev: 0, iso: 400, levels: 2, ditherMode: 'bluenoise', ditherScale: 1,
    pinning: 'rotation', palette: 'paper', pixelSize: 1,
    outline: true, outlineStrength: 1, grainAnimated: true, band: 'visible',
  },
  salvage: {
    label: 'Salvage CCD (cheap)',
    ev: -0.5, iso: 1600, levels: 2, ditherMode: 'white', ditherScale: 2,
    pinning: 'off', palette: 'mono', pixelSize: 3,
    outline: false, outlineStrength: 0, grainAnimated: true, band: 'visible',
  },
  bayerCorp: {
    label: 'Ordnance Grid (bayer)',
    ev: 0, iso: 200, levels: 4, ditherMode: 'bayer8', ditherScale: 1,
    pinning: 'rotation', palette: 'phosphor', pixelSize: 2,
    outline: true, outlineStrength: 1, grainAnimated: false, band: 'visible',
  },
  uvscope: {
    label: 'UV Scope',
    ev: 1, iso: 800, levels: 3, ditherMode: 'bluenoise', ditherScale: 1,
    pinning: 'rotation', palette: 'uvviolet', pixelSize: 2,
    outline: true, outlineStrength: 0.6, grainAnimated: true, band: 'uv',
  },
  irscope: {
    label: 'IR Thermal',
    ev: 0, iso: 3200, levels: 8, ditherMode: 'bluenoise', ditherScale: 2,
    pinning: 'off', palette: 'irheat', pixelSize: 4,
    outline: false, outlineStrength: 0, grainAnimated: true, band: 'ir',
  },
  handheld: {
    label: 'Handheld (gameboy)',
    ev: 0, iso: 100, levels: 4, ditherMode: 'bayer8', ditherScale: 2,
    pinning: 'off', palette: 'gameboy', pixelSize: 4,
    outline: false, outlineStrength: 0, grainAnimated: false, band: 'visible',
  },
}

export const DEFAULT_SENSOR = 'mk1'
