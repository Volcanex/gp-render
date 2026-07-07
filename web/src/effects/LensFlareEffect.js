// Bright-pixel-driven internal-reflection lens flare — threshold-ghost approx.
// of the classic Chapman flare chain (John Chapman, "Pseudo Lens Flare",
// http://john-chapman-graphics.blogspot.com/2013/02/pseudo-lens-flare.html).
// No light-position plumbing: ghosts/streak are derived from whatever bright
// pixels (sun, lamps, torches) already made it into the frame.
import { Effect, EffectAttribute } from 'postprocessing'
import { Uniform } from 'three'

const fragmentShader = /* glsl */ `
uniform float uFlare;
uniform float uAnamorphic;
uniform float uThreshold;

vec3 flareThreshold(vec3 c) {
  return max(c - vec3(uThreshold), vec3(0.0)) / max(1.0 - uThreshold, 0.0001);
}

// small 3-tap blur so ghosts don't look like hard copies of the source pixel
vec3 blurredThreshold(vec2 uv) {
  vec3 c = flareThreshold(texture2D(inputBuffer, uv).rgb);
  c += flareThreshold(texture2D(inputBuffer, uv + vec2(texelSize.x, texelSize.y) * 1.5).rgb);
  c += flareThreshold(texture2D(inputBuffer, uv - vec2(texelSize.x, texelSize.y) * 1.5).rgb);
  return c / 3.0;
}

vec3 ghosts(vec2 uv) {
  const int GHOST_COUNT = 4;
  float spacings[GHOST_COUNT];
  spacings[0] = 0.3;
  spacings[1] = 0.6;
  spacings[2] = 1.1;
  spacings[3] = 1.7;

  vec3 warm = vec3(1.0, 0.75, 0.5);
  vec3 cool = vec3(0.5, 0.75, 1.0);

  vec2 center = vec2(0.5);
  vec2 toCenter = center - uv;

  vec3 sum = vec3(0.0);
  for (int i = 0; i < GHOST_COUNT; i++) {
    vec2 ghostUv = center + toCenter * spacings[i];
    vec3 c = blurredThreshold(ghostUv);

    float d = clamp(length(ghostUv - center) * 2.0, 0.0, 1.0);
    float falloff = pow(1.0 - d, 2.0);

    vec3 tint = mix(warm, cool, mod(float(i), 2.0));
    sum += c * falloff * tint;
  }
  return sum;
}

vec3 anamorphicStreak(vec2 uv) {
  const int TAP_COUNT = 8;
  vec3 tint = vec3(0.53, 0.67, 1.0);
  vec3 sum = vec3(0.0);
  for (int i = 1; i <= TAP_COUNT; i++) {
    float w = 1.0 / (1.0 + float(i));
    float offset = float(i) * 3.0 * texelSize.x;
    vec3 cPos = flareThreshold(texture2D(inputBuffer, uv + vec2(offset, 0.0)).rgb);
    vec3 cNeg = flareThreshold(texture2D(inputBuffer, uv - vec2(offset, 0.0)).rgb);
    sum += (cPos + cNeg) * w;
  }
  return sum * tint;
}

vec3 halo(vec2 uv) {
  vec2 center = vec2(0.5);
  vec2 dir = normalize(uv - center + 1e-5);
  float radius = 0.4;

  float rShift = 0.995;
  float bShift = 1.005;

  vec2 uvR = center + dir * radius * rShift;
  vec2 uvG = center + dir * radius;
  vec2 uvB = center + dir * radius * bShift;

  float r = flareThreshold(texture2D(inputBuffer, uvR).rgb).r;
  float g = flareThreshold(texture2D(inputBuffer, uvG).rgb).g;
  float b = flareThreshold(texture2D(inputBuffer, uvB).rgb).b;

  float d = length(uv - center);
  float ring = 1.0 - clamp(abs(d - radius) * 12.0, 0.0, 1.0);

  return vec3(r, g, b) * ring;
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  if (uFlare <= 0.0 && uAnamorphic <= 0.0) {
    outputColor = inputColor;
    return;
  }

  vec3 result = inputColor.rgb;

  if (uFlare > 0.0) {
    result += ghosts(uv) * uFlare;
    result += halo(uv) * uFlare * 0.5;
  }

  if (uAnamorphic > 0.0) {
    result += anamorphicStreak(uv) * uAnamorphic;
  }

  outputColor = vec4(result, inputColor.a);
}
`

export class LensFlareEffect extends Effect {
  constructor() {
    super('LensFlareEffect', fragmentShader, {
      attributes: EffectAttribute.NONE,
      uniforms: new Map([
        ['uFlare', new Uniform(0)],
        ['uAnamorphic', new Uniform(0)],
        ['uThreshold', new Uniform(0.75)],
      ]),
    })
  }

  setParams(params) {
    this.uniforms.get('uFlare').value = params.flare ? Math.max(0, params.flare) : 0
    this.uniforms.get('uAnamorphic').value = params.anamorphic ? Math.max(0, params.anamorphic) : 0
  }
}
