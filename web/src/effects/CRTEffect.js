// CRT display simulation: the device the dithered feed is viewed on, so it
// runs last in the chain, after quantisation. Barrel distortion + bezel,
// scanlines, phosphor mask and a faint refresh-band shimmer.
import { Effect } from 'postprocessing'
import { Uniform } from 'three'

const fragmentShader = /* glsl */ `
uniform float uAmount;
uniform float uCurvature;
uniform int uMaskType;
uniform float uScanIntensity;
uniform float uTime;
uniform float uFlicker;

vec3 phosphorMask(vec3 color, vec2 uv, float amount) {
  float x = uv.x * resolution.x;
  vec3 boosted;

  if (uMaskType == 1) {
    // slot mask: RGB triads, alternate rows offset by 1.5 columns
    float y = uv.y * resolution.y;
    float rowOffset = step(1.0, mod(floor(y / 2.0), 2.0)) * 1.5;
    int idx = int(mod(x + rowOffset, 3.0));
    vec3 gain = vec3(0.85);
    if (idx == 0) gain.r = 1.15; else if (idx == 1) gain.g = 1.15; else gain.b = 1.15;
    boosted = color * gain;
  } else if (uMaskType == 2) {
    // shadow dot: 2D dot cells, brighter at cell centre
    vec2 cell = fract(vec2(x, uv.y * resolution.y) / 3.0) - 0.5;
    float d = smoothstep(0.5, 0.2, length(cell));
    boosted = color * mix(0.85, 1.15, d);
  } else {
    // aperture grille: vertical RGB stripes
    int idx = int(mod(x, 3.0));
    vec3 gain = vec3(0.85);
    if (idx == 0) gain.r = 1.15; else if (idx == 1) gain.g = 1.15; else gain.b = 1.15;
    boosted = color * gain;
  }

  return mix(color, boosted, amount);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  if (uAmount <= 0.0) {
    outputColor = inputColor;
    return;
  }

  vec2 cc = (uv - 0.5) * 2.0;
  vec2 sampleUv = uv;
  if (uCurvature > 0.0) {
    float dist2 = dot(cc, cc);
    vec2 warped = cc * (1.0 + uCurvature * dist2);
    sampleUv = warped * 0.5 + 0.5;
  }

  // Outside [0,1] on any side: never sample inputBuffer (it's a clamped
  // texture, so an out-of-range sampleUv reads back the edge column/row
  // instead of black). Bail to pure black symmetrically on all four sides.
  if (sampleUv.x < 0.0 || sampleUv.x > 1.0 || sampleUv.y < 0.0 || sampleUv.y > 1.0) {
    outputColor = vec4(0.0, 0.0, 0.0, inputColor.a);
    return;
  }

  // Rounded-corner bezel falloff for samples still inside [0,1], symmetric
  // in sampleUv so all four edges/corners behave identically.
  vec2 p = abs(sampleUv - 0.5) * 2.0;
  float cornerRadius = 0.25 * uCurvature;
  vec2 q = p - (1.0 - cornerRadius);
  float roundedDist = length(max(q, 0.0)) - cornerRadius;
  float bezelMask = 1.0 - smoothstep(0.0, 0.004, roundedDist);

  vec3 color = texture2D(inputBuffer, sampleUv).rgb * bezelMask;

  // Scanlines and phosphor mask are evaluated in the distorted (sampleUv)
  // space so the pattern follows the curved image rather than staying flat.
  float scanPhase = cos(sampleUv.y * resolution.y * 3.14159265 * 2.0 / 2.0);
  float scan = 1.0 - uScanIntensity * uAmount * (0.5 + 0.5 * scanPhase);
  color *= scan;

  color = phosphorMask(color, sampleUv, uAmount);

  // Compensate for scanline/mask darkening so switching the CRT on doesn't
  // just dim the image.
  color *= 1.0 / (1.0 - 0.3 * uAmount);

  // Refresh band: faint bright band sweeping down the tube every ~2.5s.
  // Gated entirely by uFlicker: at 0 the image is temporally stable
  // (mask/scanlines/curvature only, no per-frame animation).
  float bandPos = fract(uTime / 2.5);
  float bandDist = abs(uv.y - bandPos);
  bandDist = min(bandDist, 1.0 - bandDist);
  float band = smoothstep(0.05, 0.0, bandDist) * 0.05 * uFlicker * uAmount;
  color += band;

  outputColor = vec4(color, inputColor.a);
}
`

const MASK_IDS = { grille: 0, slot: 1, dot: 2 }

export class CRTEffect extends Effect {
  constructor() {
    super('CRTEffect', fragmentShader, {
      uniforms: new Map([
        ['uAmount', new Uniform(0)],
        ['uCurvature', new Uniform(0)],
        ['uMaskType', new Uniform(MASK_IDS.grille)],
        ['uScanIntensity', new Uniform(1)],
        ['uTime', new Uniform(0)],
        ['uFlicker', new Uniform(0)],
      ]),
    })
  }

  setParams(params) {
    this.uniforms.get('uAmount').value = params.crt ? Math.max(0, Math.min(1, params.crt)) : 0
    this.uniforms.get('uCurvature').value = params.crtCurve ? Math.max(0, Math.min(0.35, params.crtCurve)) : 0
    if (params.crtMask !== undefined) {
      this.uniforms.get('uMaskType').value = MASK_IDS[params.crtMask] ?? MASK_IDS.grille
    }
    this.uniforms.get('uFlicker').value = Math.max(0, Math.min(1, params.crtFlicker ?? 0))
  }

  setTime(t) {
    this.uniforms.get('uTime').value = t
  }
}
