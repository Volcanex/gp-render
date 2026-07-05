// Depth-buffer raymarched volumetric fog with light inscattering — makes the
// coloured lamps glow through the murk with distance-correct occlusion.
// Runs early (on the clean render) so later stylisation stages dither/quantise
// the fogged result, not a flat haze on top.
import { Effect, EffectAttribute } from 'postprocessing'
import { Color, Matrix4, Uniform, Vector3 } from 'three'

const MAX_LIGHTS = 12

const fragmentShader = /* glsl */ `
#define MAX_LIGHTS ${MAX_LIGHTS}

uniform float uDensity;
uniform vec3 uFogColor;
uniform mat4 uCamWorld;
uniform mat4 uProjInv;
uniform vec3 uLightPos[MAX_LIGHTS];
uniform vec3 uLightColor[MAX_LIGHTS];
uniform int uLightCount;
uniform float uAnisotropy;
uniform float uEnabled;
uniform float uFogBase;
uniform float uFogHeight;
uniform float uTime;

// cheap screen-space hash for the per-pixel march jitter (hides step banding)
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

// Henyey-Greenstein phase function, forward-peaked toward the light for g > 0
float phaseHG(float mu, float g) {
  float g2 = g * g;
  return (1.0 - g2) / pow(max(1.0 + g2 - 2.0 * g * mu, 1e-4), 1.5);
}

// single-octave value noise (bilinear-interpolated hash) for drifting wisps —
// cheap on purpose, this runs once per march step (~24 evals/pixel)
float noise2D(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  if (uEnabled < 0.5) {
    outputColor = inputColor;
    return;
  }

  // Reconstruct the view ray depth-free (unprojecting the sampled depth
  // directly blows up to inf/NaN as w->0 near the far plane), then get the
  // march distance from the linearised depth via getViewZ — the same
  // approach the outline effect uses.
  float depth = readDepth(uv);
  vec4 vf = uProjInv * vec4(uv * 2.0 - 1.0, 1.0, 1.0);
  vec3 viewRay = vf.xyz / vf.w;
  viewRay /= -viewRay.z;                    // scale so view z = -1
  float viewZ = getViewZ(depth);            // negative view-space depth
  float rayLen = min(length(viewRay * (-viewZ)), 80.0);
  vec3 rayDir = normalize((uCamWorld * vec4(viewRay, 0.0)).xyz);
  vec3 camPos = uCamWorld[3].xyz;

  const int STEPS = 24; // steps * lights is the perf budget — tune these two knobs first
  float stepLen = rayLen / float(STEPS);

  float jitter = hash(gl_FragCoord.xy) * stepLen;
  float transmittance = 1.0;
  vec3 accum = vec3(0.0);

  vec3 pos = camPos + rayDir * jitter;
  for (int i = 0; i < STEPS; i++) {
    // height falloff: fog pools over the lake (uFogBase) and thins with
    // altitude over uFogHeight — looking up clears, looking across is thickest
    float heightAtten = exp(-max(pos.y - uFogBase, 0.0) / uFogHeight);
    // slow drifting patchiness, remapped from [0,1] noise to [0.55, 1.45]
    vec2 wispUv = pos.xz * 0.06 + vec2(uTime * 0.03, uTime * 0.017);
    float wisp = 0.55 + noise2D(wispUv) * 0.9;
    float dLocal = uDensity * heightAtten * wisp;
    float densityStep = dLocal * stepLen;

    transmittance *= exp(-densityStep);

    for (int l = 0; l < MAX_LIGHTS; l++) {
      if (l >= uLightCount) break;
      vec3 toLight = uLightPos[l] - pos;
      float d = length(toLight);
      vec3 lightDir = toLight / max(d, 1e-5);
      float falloff = 1.0 / (1.0 + 0.15 * d * d);
      float mu = dot(rayDir, lightDir);
      float phase = phaseHG(mu, uAnisotropy);
      accum += uLightColor[l] * falloff * phase * densityStep * transmittance;
    }

    accum += uFogColor * densityStep * 0.25 * transmittance;
    pos += rayDir * stepLen;
  }

  // debug view: uEnabled == 2 shows reconstructed ray length as grayscale
  if (uEnabled > 1.5) {
    outputColor = vec4(vec3(rayLen / 80.0), 1.0);
    return;
  }

  outputColor = vec4(inputColor.rgb * transmittance + accum, inputColor.a);
}
`

export class VolumetricFogEffect extends Effect {
  constructor() {
    const lightPositions = Array.from({ length: MAX_LIGHTS }, () => new Vector3())
    const lightColors = Array.from({ length: MAX_LIGHTS }, () => new Color(0, 0, 0))

    super('VolumetricFogEffect', fragmentShader, {
      attributes: EffectAttribute.DEPTH,
      uniforms: new Map([
        ['uDensity', new Uniform(0.03)],
        ['uFogColor', new Uniform(new Color('#331a0a'))],
        ['uCamWorld', new Uniform(new Matrix4())],
        ['uProjInv', new Uniform(new Matrix4())],
        ['uLightPos', new Uniform(lightPositions)],
        ['uLightColor', new Uniform(lightColors)],
        ['uLightCount', new Uniform(0)],
        ['uAnisotropy', new Uniform(0.35)],
        ['uEnabled', new Uniform(1)],
        ['uFogBase', new Uniform(-0.5)],
        ['uFogHeight', new Uniform(6.0)],
        ['uTime', new Uniform(0)],
      ]),
    })

    this.lightPositions = lightPositions
    this.lightColors = lightColors
  }

  setLights(lamps) {
    const count = Math.min(lamps.length, MAX_LIGHTS)
    for (let i = 0; i < count; i++) {
      const { position, color } = lamps[i]
      this.lightPositions[i].set(position[0], position[1], position[2])
      // 0.7: full-strength inscatter halos read as over-bright blooms
      this.lightColors[i].set(color).multiplyScalar(0.7)
    }
    this.uniforms.get('uLightCount').value = count
  }

  setParams({ density, fogColor, enabled, fogBase, fogHeight }) {
    if (density !== undefined) this.uniforms.get('uDensity').value = density
    if (fogColor !== undefined) this.uniforms.get('uFogColor').value.set(fogColor)
    if (fogBase !== undefined) this.uniforms.get('uFogBase').value = fogBase
    if (fogHeight !== undefined) this.uniforms.get('uFogHeight').value = fogHeight
    this.uniforms.get('uEnabled').value = enabled === false ? 0 : 1
  }

  // called once per frame by the pipeline to drive the drifting wisp noise
  setTime(t) {
    this.uniforms.get('uTime').value = t
  }

  updateCamera(camera) {
    this.uniforms.get('uCamWorld').value.copy(camera.matrixWorld)
    this.uniforms.get('uProjInv').value.copy(camera.projectionMatrixInverse)
  }
}
