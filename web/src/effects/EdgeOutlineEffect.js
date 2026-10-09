// Depth-sobel silhouette outline: last stage in the chain, composited over
// the already-dithered/palettised output. Inverts colour rather than drawing
// fixed black/white so it reads on any palette (Pope's readability trick).
import { Effect, EffectAttribute } from 'postprocessing'
import { Uniform } from 'three'

const fragmentShader = /* glsl */ `
uniform float uStrength;

// readDepth()/getViewZ() come from the shared EffectMaterial template
// (always declared, not gated behind the DEPTH attribute).
float linearDepth(vec2 uv) {
  return -getViewZ(readDepth(uv));
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  if (uStrength <= 0.0) {
    outputColor = inputColor;
    return;
  }

  float center = linearDepth(uv);

  float dL = linearDepth(uv - vec2(texelSize.x, 0.0));
  float dR = linearDepth(uv + vec2(texelSize.x, 0.0));
  float dT = linearDepth(uv + vec2(0.0, texelSize.y));
  float dB = linearDepth(uv - vec2(0.0, texelSize.y));

  float maxDiff = max(max(abs(center - dL), abs(center - dR)), max(abs(center - dT), abs(center - dB)));

  float threshold = 0.02 * center + 0.01;
  float e = smoothstep(threshold, threshold * 2.0, maxDiff) * uStrength;
  e = clamp(e, 0.0, 1.0);

  vec3 inv = vec3(1.0) - inputColor.rgb;
  outputColor = vec4(mix(inputColor.rgb, inv, e), inputColor.a);
}
`

export class EdgeOutlineEffect extends Effect {
  constructor() {
    super('EdgeOutlineEffect', fragmentShader, {
      attributes: EffectAttribute.DEPTH,
      uniforms: new Map([
        ['uStrength', new Uniform(0)],
      ]),
    })
  }

  setParams(params) {
    this.uniforms.get('uStrength').value = params.outline ? Math.max(0, params.outlineStrength) : 0
  }
}
