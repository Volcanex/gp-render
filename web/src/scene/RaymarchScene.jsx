import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

const vertexShader = /* glsl */ `
uniform mat4 uCamWorld;
uniform mat4 uProjInv;

out vec3 vRayDir;

void main() {
  vec4 viewFar = uProjInv * vec4(position.xy, 1.0, 1.0);
  viewFar /= viewFar.w;
  vRayDir = (uCamWorld * vec4(viewFar.xyz, 0.0)).xyz;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

const fragmentShader = /* glsl */ `
precision highp float;

uniform float uProjA;
uniform float uProjB;
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uAmbientColor;
uniform vec3 uSkyHorizon;
uniform vec3 uSkyZenith;
uniform float uDayFactor;
uniform float uSeeVis;
uniform float uSeeUv;
uniform float uSeeIr;
uniform vec3 uUvColor;
uniform vec3 uIrColor;
uniform float uUvGain;
uniform float uIrGain;
uniform float uTorch;
uniform vec3 uCamForward;

in vec3 vRayDir;
layout(location = 0) out vec4 fragColor;

#define STEPS 112
#define MAX_DIST 60.0

float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

float smax(float a, float b, float k) {
  return -smin(-a, -b, k);
}

float sdSphere(vec3 p, float r) {
  return length(p) - r;
}

float sdBox(vec3 p, vec3 b) {
  vec3 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}

float sdTorus(vec3 p, vec2 t) {
  vec2 q = vec2(length(p.xz) - t.x, p.y);
  return length(q) - t.y;
}

float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453123);
}

float hash3(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

// cheap 2D value noise for terrain / clouds — bilinear on a hashed lattice
float noise2D(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

float fbm2(vec2 p) {
  float f = 0.0;
  float amp = 0.55;
  for (int i = 0; i < 3; i++) {
    f += amp * noise2D(p);
    p *= 2.05;
    amp *= 0.5;
  }
  return f;
}

// trilinear 3D value noise — only sampled where an object's cheap bounding
// distance already gates it, so the 8 hash3 taps stay off the hot path
float noise3D(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hash3(i);
  float n100 = hash3(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash3(i + vec3(0.0, 1.0, 0.0));
  float n110 = hash3(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash3(i + vec3(0.0, 0.0, 1.0));
  float n101 = hash3(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash3(i + vec3(0.0, 1.0, 1.0));
  float n111 = hash3(i + vec3(1.0, 1.0, 1.0));
  float nx00 = mix(n000, n100, f.x);
  float nx10 = mix(n010, n110, f.x);
  float nx01 = mix(n001, n101, f.x);
  float nx11 = mix(n011, n111, f.x);
  float nxy0 = mix(nx00, nx10, f.y);
  float nxy1 = mix(nx01, nx11, f.y);
  return mix(nxy0, nxy1, f.z);
}

float fbm3(vec3 p) {
  float f = 0.0;
  float amp = 0.6;
  for (int i = 0; i < 2; i++) {
    f += amp * (noise3D(p) - 0.5);
    p *= 2.1;
    amp *= 0.5;
  }
  return f;
}

// checkerboard albedo, ~1m squares, two mid greys (kept off pure white/black
// so the post chain's exposure + shadow-lift lands near mid-grey, not washed)
vec3 groundColor(vec3 p) {
  vec2 c = floor(p.xz);
  float check = mod(c.x + c.y, 2.0);
  return mix(vec3(0.35), vec3(0.55), check);
}

// returns (distance, material id) — every branch below is gated by a cheap
// bounding-sphere/box test so the expensive noise/loop work only runs for
// rays actually near that object, keeping the 112-step march affordable
vec2 map(vec3 p) {
  // rolling terrain: heightfield SDF approximation (2-3 octave value noise,
  // low frequency/amplitude keeps slopes gentle so the approximation holds)
  float terrainH = fbm2(p.xz * 0.15) * 1.5 - 0.4;
  float d = p.y - terrainH;
  float mat = 0.0;

  // THE organism: 6 spheres orbiting/pulsing into one smooth-union blob —
  // constantly splitting and merging, the thing pure geometry can't do
  vec3 orgCenter = vec3(0.0, 1.7, 0.0);
  float boundOrg = length(p - orgCenter) - 1.35;
  if (boundOrg < d) {
    float dOrg = 1e5;
    for (int i = 0; i < 6; i++) {
      float fi = float(i);
      float ang = uTime * 0.35 + fi * 2.094;
      float orbitR = 0.55 + 0.15 * sin(uTime * 0.5 + fi);
      vec3 off = vec3(cos(ang) * orbitR, sin(uTime * 0.6 + fi * 1.3) * 0.35, sin(ang) * orbitR);
      float r = 0.42 + 0.08 * sin(uTime * 1.4 + fi * 1.7);
      dOrg = smin(dOrg, sdSphere(p - orgCenter - off, r), 0.8);
    }
    if (dOrg < d) { d = dOrg; mat = 1.0; }
  }

  // impossible carve: torus smoothly subtracted out of a box
  vec3 pc = p - vec3(-2.3, 0.75, 1.1);
  float boundCarve = length(pc) - 0.9;
  if (boundCarve < d) {
    float dBoxC = sdBox(pc, vec3(0.55));
    float dTorC = sdTorus(pc, vec2(0.5, 0.16));
    float dCarve = smax(dBoxC, -dTorC, 0.08);
    if (dCarve < d) { d = dCarve; mat = 2.0; }
  }

  // floating rocky asteroid: sphere + fbm surface displacement, slowly spun
  vec3 pa = p - vec3(2.6, 2.1 + sin(uTime * 0.3) * 0.25, -1.6);
  float boundAst = length(pa) - 0.75;
  if (boundAst < d) {
    float ang = uTime * 0.25;
    vec3 pr = vec3(pa.x * cos(ang) - pa.z * sin(ang), pa.y, pa.x * sin(ang) + pa.z * cos(ang));
    float dAst = length(pa) - 0.55 - fbm3(pr * 2.2) * 0.14;
    if (dAst < d) { d = dAst; mat = 3.0; }
  }

  // columns receding toward the horizon, domain-repeated with per-cell
  // height jitter — fog (not a repeat clamp) is what bounds the field
  if (p.y < 4.0) {
    vec2 cell = floor(p.xz / 2.2 + 0.5);
    vec2 local = p.xz - cell * 2.2;
    float h = 1.0 + 1.4 * hash21(cell);
    float dCol = sdBox(vec3(local.x, p.y - h * 0.5, local.y), vec3(0.16, h * 0.5, 0.16));
    if (dCol < d) { d = dCol; mat = 4.0; }
  }

  return vec2(d, mat);
}

float mapDist(vec3 p) {
  return map(p).x;
}

vec3 calcNormal(vec3 p) {
  // tetrahedron gradient — 4 SDF taps
  const float h = 1e-3;
  const vec2 k = vec2(1.0, -1.0);
  return normalize(
    k.xyy * mapDist(p + k.xyy * h) +
    k.yyx * mapDist(p + k.yyx * h) +
    k.yxy * mapDist(p + k.yxy * h) +
    k.xxx * mapDist(p + k.xxx * h)
  );
}

float calcAO(vec3 p, vec3 n) {
  float occ = 0.0;
  float sca = 1.0;
  for (int i = 0; i < 5; i++) {
    float hr = 0.01 + 0.12 * float(i) / 4.0;
    vec3 aopos = p + n * hr;
    float dd = mapDist(aopos);
    occ += (hr - dd) * sca;
    sca *= 0.6;
  }
  return clamp(1.0 - 3.0 * occ, 0.0, 1.0);
}

float softShadow(vec3 ro, vec3 rd, float mint, float maxt, float k) {
  float res = 1.0;
  float t = mint;
  for (int i = 0; i < 24; i++) {
    if (t >= maxt) break;
    float h = mapDist(ro + rd * t);
    if (h < 1e-3) return 0.0;
    res = min(res, k * h / t);
    t += h;
  }
  return clamp(res, 0.0, 1.0);
}

vec3 shadeAlbedo(float matId, vec3 p) {
  if (matId < 0.5) return groundColor(p);
  if (matId < 1.5) {
    // the organism is the centrepiece — kept saturated and bright (~0.8) so
    // it pops against the deliberately paler terrain/columns/carve/asteroid
    float pulse = 0.5 + 0.5 * sin(uTime * 0.8);
    return mix(vec3(0.02, 0.75, 0.62), vec3(0.85, 0.08, 0.6), pulse);
  }
  if (matId < 2.5) return vec3(0.15, 0.19, 0.25);
  if (matId < 3.5) {
    float variation = noise3D(p * 3.0);
    return mix(vec3(0.21, 0.1, 0.05), vec3(0.33, 0.17, 0.08), variation);
  }
  return vec3(0.42, 0.41, 0.4);
}

// spectrum-band glow, added on top of lit shading so it survives visible=false
// (a sensor blind to visible light still reads heat/UV markings)
vec3 spectrumEmission(float matId, vec3 p) {
  vec3 e = vec3(0.0);

  if (uSeeIr > 0.5) {
    // temperature per material: organism is alive and hot, asteroid mildly
    // warm, terrain carries faint residual warmth in patches (reuses the
    // terrain noise already computed for the heightfield — no extra taps),
    // columns/carve are cold and contribute nothing
    float heat = 0.0;
    if (matId < 0.5) heat = smoothstep(0.6, 0.9, fbm2(p.xz * 0.15)) * 0.15;
    else if (matId < 1.5) heat = 1.0;
    else if (matId < 3.5 && matId > 2.5) heat = 0.35;
    e += uIrColor * heat * uIrGain;
  }

  if (uSeeUv > 0.5) {
    if (matId > 3.5) {
      // rune rings: a threshold on the column's cell hash marks it as
      // inscribed, then a height band on that column glows
      vec2 cell = floor(p.xz / 2.2 + 0.5);
      float rune = hash21(cell + 7.7);
      if (rune > 0.6) {
        float band = fract(p.y * 1.5);
        float glow = smoothstep(0.42, 0.5, band) * (1.0 - smoothstep(0.5, 0.58, band));
        e += uUvColor * glow * 1.5 * uUvGain;
      }
    }
    if (matId < 0.5) {
      // large ring inscribed on the terrain, off-centre — pure distance test
      float ringDist = abs(length(p.xz - vec2(4.0, -3.5)) - 3.0);
      e += uUvColor * smoothstep(0.12, 0.0, ringDist) * 1.2 * uUvGain;
    }
  }

  return e;
}

// gradient sky (horizon glow -> dark zenith) + sun disc + fbm cloud band,
// all keyed off uSunDir/uSunColor/uSkyHorizon/uSkyZenith — the time-of-day
// trig runs once per frame on the JS side (computeSunState below), not here.
// Also doubles as the far-fog target so geometry fades into the same sky.
vec3 skyColor(vec3 rd) {
  float t = clamp(rd.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 col = mix(uSkyHorizon, uSkyZenith, pow(t, 0.5));

  float sun = pow(max(dot(rd, uSunDir), 0.0), 340.0);
  col += uSunColor * sun * 3.0;

  float cloud = fbm2(vec2(rd.x, rd.z) / max(abs(rd.y), 0.05) * 0.5 + uTime * 0.015);
  cloud = smoothstep(0.5, 0.8, cloud) * smoothstep(0.02, 0.2, rd.y) * (1.0 - smoothstep(0.35, 0.85, rd.y));
  // clouds capped at ~mid-grey even at full daylight — a bright-white band
  // would drag the frame average up right where the eye lands (horizon)
  vec3 cloudColor = mix(vec3(0.08, 0.09, 0.13), vec3(0.55, 0.56, 0.6), uDayFactor);
  col = mix(col, cloudColor, cloud * 0.45);
  return col;
}

void main() {
  vec3 ro = cameraPosition;
  vec3 rd = normalize(vRayDir);
  vec3 lightDir = uSunDir;

  float t = 0.0;
  float matId = -1.0;
  vec3 p = ro;

  for (int i = 0; i < STEPS; i++) {
    p = ro + rd * t;
    vec2 res = map(p);
    float eps = max(1e-3, t * 1e-3);
    if (res.x < eps) {
      matId = res.y;
      break;
    }
    t += res.x;
    if (t > MAX_DIST) break;
  }

  if (matId < 0.0 || t > MAX_DIST) {
    // a sensor blind to visible light receives zero visible light — no sky glow
    vec3 miss = uSeeVis > 0.5 ? skyColor(rd) : vec3(0.0);
    fragColor = vec4(miss, 1.0);
    gl_FragDepth = 1.0;
    return;
  }

  vec3 n = calcNormal(p);
  float diff = max(dot(n, lightDir), 0.0);
  float ao = calcAO(p, n);
  float shadow = softShadow(p + n * 0.02, lightDir, 0.02, 8.0, 16.0);

  vec3 albedo = shadeAlbedo(matId, p);
  // visible=false means zero visible light reaches the sensor — the world
  // then reads only through whatever spectrum bands (IR/UV) are enabled
  vec3 lit = uSeeVis > 0.5
    ? albedo * (uAmbientColor * ao + uSunColor * diff * shadow)
    : vec3(0.0);

  // camera-mounted torch: a spotlight along the view direction, visible-band
  // only (it's a physical light, not a sensor emulation like IR/UV)
  if (uTorch > 0.5 && uSeeVis > 0.5) {
    vec3 toCam = ro - p;
    float distSq = dot(toCam, toCam);
    vec3 toCamDir = toCam / sqrt(distSq);
    float cone = pow(max(dot(-toCamDir, uCamForward), 0.0), 24.0);
    float atten = 1.0 / (1.0 + 0.02 * distSq);
    float ndotl = max(dot(n, toCamDir), 0.0);
    lit += albedo * vec3(1.0, 0.92, 0.8) * 2.5 * cone * atten * ndotl;
  }

  vec3 color = lit + spectrumEmission(matId, p);

  // fog targets the flat horizon tone (not the direction-dependent sky/cloud
  // gradient) and at lower density than before, so mid-field keeps contrast
  // instead of washing into the sky well before the far plane. Mixing here
  // (after emission is added) fades the glow with distance too, for free.
  vec3 fogTarget = uSeeVis > 0.5 ? uSkyHorizon : vec3(0.0);
  float fog = 1.0 - exp(-0.012 * t);
  color = mix(color, fogTarget, fog);

  fragColor = vec4(color, 1.0);

  // world -> view -> NDC depth, matching the camera's own projection
  float viewZ = (viewMatrix * vec4(p, 1.0)).z;
  float ndcZ = (uProjA * viewZ + uProjB) / (-viewZ);
  gl_FragDepth = clamp(ndcZ * 0.5 + 0.5, 0.0, 1.0);
}
`

const clamp01 = (v) => Math.min(1, Math.max(0, v))

// Sun direction/colour from a 0..24 time-of-day float, computed in JS (cheap
// trig, runs once per prop change) rather than every fragment. Elevation
// follows sin((t-6)/12*PI): 0 at 6h/18h, +1 at noon, negative = below horizon.
function computeSunState(timeOfDay) {
  const elevation = Math.sin(((timeOfDay - 6) / 12) * Math.PI)
  const azimuth = ((timeOfDay - 6) / 12) * Math.PI
  const horiz = Math.sqrt(Math.max(0, 1 - elevation * elevation))
  const dir = new THREE.Vector3(horiz * Math.cos(azimuth), elevation, horiz * Math.sin(azimuth)).normalize()

  const day = clamp01(elevation)
  const night = clamp01(-elevation)
  const lowSun = 1 - Math.abs(Math.max(-1, Math.min(1, elevation)))

  const sunIntensity = clamp01(elevation * 1.4 + 0.05)
  const sunColor = new THREE.Vector3(1.0, 0.5, 0.25)
    .lerp(new THREE.Vector3(0.95, 0.97, 1.0), day)
    .multiplyScalar(sunIntensity)

  const ambientColor = new THREE.Vector3(0.16, 0.17, 0.2)
    .lerp(new THREE.Vector3(0.05, 0.07, 0.14), night)

  // day tones sit near luminance ~0.5 (mid-grey), not bright white-blue —
  // the post chain's exposure + shadow-lift pushes brightness up further
  // night sky must be near-zero: real night sky is orders of magnitude
  // darker than lit surfaces, so auto-ISO gain can't push it to white
  const skyHorizon = new THREE.Vector3(0.35, 0.45, 0.6)
    .lerp(new THREE.Vector3(0.85, 0.45, 0.25), lowSun)
    .lerp(new THREE.Vector3(0.003, 0.005, 0.012), night)

  const skyZenith = new THREE.Vector3(0.28, 0.48, 0.72)
    .lerp(new THREE.Vector3(0.001, 0.0015, 0.004), night)

  return { dir, sunColor, ambientColor, skyHorizon, skyZenith, day }
}

const camForward = new THREE.Vector3()

// JS replica of the fragment shader's terrain height (hash21/noise2D/fbm2 and
// the terrainH formula in `map()`) so walk mode can sample ground height
// without a GPU readback. Must stay numerically in sync with the GLSL above —
// any change to hash21/noise2D/fbm2 or the 0.15/1.5/-0.4 terrain constants
// there needs the same change mirrored here.
function hash21JS(x, y) {
  const s = Math.sin(x * 41.3 + y * 289.1) * 43758.5453123
  return s - Math.floor(s)
}

function noise2DJS(x, y) {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const fx = x - ix
  const fy = y - iy
  const a = hash21JS(ix, iy)
  const b = hash21JS(ix + 1, iy)
  const c = hash21JS(ix, iy + 1)
  const d = hash21JS(ix + 1, iy + 1)
  const ux = fx * fx * (3 - 2 * fx)
  const uy = fy * fy * (3 - 2 * fy)
  return a + (b - a) * ux + (c - a) * uy * (1 - ux) + (d - b) * ux * uy
}

function fbm2JS(x, y) {
  let f = 0
  let amp = 0.55
  let px = x
  let py = y
  for (let i = 0; i < 3; i++) {
    f += amp * noise2DJS(px, py)
    px *= 2.05
    py *= 2.05
    amp *= 0.5
  }
  return f
}

function terrainHeight(x, z) {
  return fbm2JS(x * 0.15, z * 0.15) * 1.5 - 0.4
}

export default function RaymarchScene({ timeOfDay = 14, bands = {}, torch = false }) {
  // walkable ground: CameraRig samples this so walk mode follows the terrain
  useEffect(() => {
    window.__groundFn = terrainHeight
    return () => { if (window.__groundFn === terrainHeight) window.__groundFn = null }
  }, [])

  const {
    visible = true, uv = false, ir = false,
    uvColor = '#9040ff', irColor = '#ff5020', uvGain = 1, irGain = 1,
  } = bands
  const meshRef = useRef()

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry()
    const verts = new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0])
    geo.setAttribute('position', new THREE.BufferAttribute(verts, 3))
    return geo
  }, [])

  const material = useMemo(() => {
    return new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader,
      fragmentShader,
      depthTest: true,
      depthWrite: true,
      uniforms: {
        uCamWorld: { value: new THREE.Matrix4() },
        uProjInv: { value: new THREE.Matrix4() },
        uProjA: { value: 0 },
        uProjB: { value: 0 },
        uTime: { value: 0 },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunColor: { value: new THREE.Vector3(1, 1, 1) },
        uAmbientColor: { value: new THREE.Vector3(0.16, 0.17, 0.2) },
        uSkyHorizon: { value: new THREE.Vector3(0.35, 0.45, 0.6) },
        uSkyZenith: { value: new THREE.Vector3(0.28, 0.48, 0.72) },
        uDayFactor: { value: 1 },
        uSeeVis: { value: 1 },
        uSeeUv: { value: 0 },
        uSeeIr: { value: 0 },
        uUvColor: { value: new THREE.Color(uvColor) },
        uIrColor: { value: new THREE.Color(irColor) },
        uUvGain: { value: 1 },
        uIrGain: { value: 1 },
        uTorch: { value: 0 },
        uCamForward: { value: new THREE.Vector3(0, 0, -1) },
      },
    })
  }, [])

  useEffect(() => {
    material.uniforms.uSeeVis.value = visible ? 1 : 0
    material.uniforms.uSeeUv.value = uv ? 1 : 0
    material.uniforms.uSeeIr.value = ir ? 1 : 0
    material.uniforms.uUvColor.value.set(uvColor)
    material.uniforms.uIrColor.value.set(irColor)
    material.uniforms.uUvGain.value = uvGain
    material.uniforms.uIrGain.value = irGain
  }, [visible, uv, ir, uvColor, irColor, uvGain, irGain, material])

  useEffect(() => {
    material.uniforms.uTorch.value = torch ? 1 : 0
  }, [torch, material])

  useEffect(() => {
    const s = computeSunState(timeOfDay)
    material.uniforms.uSunDir.value.copy(s.dir)
    material.uniforms.uSunColor.value.copy(s.sunColor)
    material.uniforms.uAmbientColor.value.copy(s.ambientColor)
    material.uniforms.uSkyHorizon.value.copy(s.skyHorizon)
    material.uniforms.uSkyZenith.value.copy(s.skyZenith)
    material.uniforms.uDayFactor.value = s.day
  }, [timeOfDay, material])

  useEffect(() => {
    return () => {
      geometry.dispose()
      material.dispose()
    }
  }, [geometry, material])

  useEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    mesh.onBeforeRender = (renderer, scene, camera) => {
      material.uniforms.uCamWorld.value.copy(camera.matrixWorld)
      material.uniforms.uProjInv.value.copy(camera.projectionMatrixInverse)
      material.uniforms.uProjA.value = camera.projectionMatrix.elements[10]
      material.uniforms.uProjB.value = camera.projectionMatrix.elements[14]
      camera.getWorldDirection(camForward)
      material.uniforms.uCamForward.value.copy(camForward)
    }
  }, [material])

  useFrame((state) => {
    material.uniforms.uTime.value = state.clock.getElapsedTime()
  })

  return <mesh ref={meshRef} geometry={geometry} material={material} frustumCulled={false} />
}
