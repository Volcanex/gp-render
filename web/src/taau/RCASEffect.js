// RCAS — AMD FidelityFX Robust Contrast-Adaptive Sharpening (FSR 1.0,
// ffx_fsr1.h, MIT). In the TAAU pipeline this runs strictly AFTER temporal
// accumulation (FSR2 pass order) to recover sharpness lost to resampling.
import { Effect } from 'postprocessing'
import { Uniform } from 'three'

const fragmentShader = `
uniform float uSharpness;

float rcasLuma(vec3 c) {
  return c.g + 0.5 * (c.r + c.b);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  if (uSharpness <= 0.0) {
    outputColor = inputColor;
    return;
  }

  vec3 centerColor = inputColor.rgb;
  vec3 northColor = texture2D(inputBuffer, uv + vec2(0.0, -texelSize.y)).rgb;
  vec3 southColor = texture2D(inputBuffer, uv + vec2(0.0,  texelSize.y)).rgb;
  vec3 eastColor  = texture2D(inputBuffer, uv + vec2( texelSize.x, 0.0)).rgb;
  vec3 westColor  = texture2D(inputBuffer, uv + vec2(-texelSize.x, 0.0)).rgb;

  float lC = rcasLuma(centerColor);
  float lN = rcasLuma(northColor);
  float lS = rcasLuma(southColor);
  float lE = rcasLuma(eastColor);
  float lW = rcasLuma(westColor);

  float mn = min(min(lN, lS), min(lE, lW));
  float mx = max(max(lN, lS), max(lE, lW));
  mn = min(mn, lC);
  mx = max(mx, lC);

  // Noise-resistant clamp: caps the negative lobe by how close the local
  // neighbourhood already is to clipping, so flat/noisy areas don't ring.
  float hitMin = mn / (4.0 * mx + 1e-4);
  float hitMax = (1.0 - mx) / (4.0 * mn - 4.0 - 1e-4);
  float lobe = clamp(max(-hitMin, hitMax), -0.1848, 0.0);

  // sharpness 0..1 -> RCAS "stops" convention (0 stops = maximum sharpening).
  float peakScale = exp2(-2.0 * (1.0 - uSharpness));
  float weight = -lobe * peakScale;

  vec3 sharpened = (centerColor + (northColor + southColor + eastColor + westColor) * weight) / (1.0 + 4.0 * weight);

  outputColor = vec4(sharpened, inputColor.a);
}
`

export class RCASEffect extends Effect {
  constructor({ sharpness = 0 } = {}) {
    super('RCASEffect', fragmentShader, {
      uniforms: new Map([['uSharpness', new Uniform(sharpness)]]),
    })
  }

  get sharpness() {
    return this.uniforms.get('uSharpness').value
  }

  set sharpness(value) {
    this.uniforms.get('uSharpness').value = value
  }

  // titan-style params object support (kept for drop-in compatibility)
  setParams(params) {
    this.sharpness = params.sharpen || 0
  }
}
