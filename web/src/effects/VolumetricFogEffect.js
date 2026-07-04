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

// cheap screen-space hash for the per-pixel march jitter (hides step banding)
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

// Henyey-Greenstein phase function, forward-peaked toward the light for g > 0
float phaseHG(float mu, float g) {
  float g2 = g * g;
  return (1.0 - g2) / pow(max(1.0 + g2 - 2.0 * g * mu, 1e-4), 1.5);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  if (uEnabled < 0.5) {
    outputColor = inputColor;
    return;
  }

  // Reconstruct the world-space point the depth buffer sees at this pixel.
  // The camera ray for a given uv is fixed regardless of depth, so unprojecting
  // the actual sampled depth gives both the surface point *and* a point on the
  // exact view ray in one shot — no separate direction reconstruction needed.
  float depth = readDepth(uv);
  vec3 ndc = vec3(uv * 2.0 - 1.0, depth * 2.0 - 1.0);
  vec4 viewPos = uProjInv * vec4(ndc, 1.0);
  viewPos /= viewPos.w;
  vec4 worldPos4 = uCamWorld * viewPos;
  vec3 worldPos = worldPos4.xyz;

  vec3 camPos = uCamWorld[3].xyz;
  vec3 toSurface = worldPos - camPos;
  float rayLen = min(length(toSurface), 80.0);
  vec3 rayDir = toSurface / max(rayLen, 1e-5);

  const int STEPS = 24; // steps * lights is the perf budget — tune these two knobs first
  float stepLen = rayLen / float(STEPS);

  float jitter = hash(gl_FragCoord.xy) * stepLen;
  float transmittance = 1.0;
  vec3 accum = vec3(0.0);

  // hoisted out of the loop: constant across steps
  float densityStep = uDensity * stepLen;
  vec3 ambientTerm = uFogColor * densityStep * 0.6;

  vec3 pos = camPos + rayDir * jitter;
  for (int i = 0; i < STEPS; i++) {
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

    accum += ambientTerm * transmittance;
    pos += rayDir * stepLen;
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
      this.lightColors[i].set(color)
    }
    this.uniforms.get('uLightCount').value = count
  }

  setParams({ density, fogColor, enabled }) {
    if (density !== undefined) this.uniforms.get('uDensity').value = density
    if (fogColor !== undefined) this.uniforms.get('uFogColor').value.set(fogColor)
    this.uniforms.get('uEnabled').value = enabled === false ? 0 : 1
  }

  updateCamera(camera) {
    this.uniforms.get('uCamWorld').value.copy(camera.matrixWorld)
    this.uniforms.get('uProjInv').value.copy(camera.projectionMatrixInverse)
  }
}
