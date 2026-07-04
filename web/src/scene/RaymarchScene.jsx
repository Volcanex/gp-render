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
uniform vec3 uBackground;

in vec3 vRayDir;
layout(location = 0) out vec4 fragColor;

#define STEPS 112
#define MAX_DIST 60.0

float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
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

float sdPlaneY(vec3 p) {
  return p.y;
}

// checkerboard albedo on the ground, ~1m squares, two greys
vec3 groundColor(vec3 p) {
  vec2 c = floor(p.xz);
  float check = mod(c.x + c.y, 2.0);
  return mix(vec3(0.25), vec3(0.42), check);
}

vec2 opRep(vec2 p, float spacing, float count) {
  float halfCount = (count - 1.0) * 0.5;
  float i = clamp(round(p.x / spacing), -halfCount, halfCount);
  p.x -= spacing * i;
  return p;
}

// returns (distance, material id)
vec2 map(vec3 p) {
  float dGround = sdPlaneY(p);
  float mat = 0.0;
  float d = dGround;

  // three blobs, smooth-unioned, bobbing/orbiting near the origin
  vec3 b0 = vec3(0.6 * cos(uTime * 0.3), 1.2 + 0.15 * sin(uTime * 0.4), 0.6 * sin(uTime * 0.3));
  vec3 b1 = vec3(0.7 * cos(uTime * 0.22 + 2.1), 1.35 + 0.12 * sin(uTime * 0.5 + 1.0), 0.7 * sin(uTime * 0.22 + 2.1));
  vec3 b2 = vec3(0.5 * cos(uTime * 0.35 + 4.2), 1.05 + 0.18 * sin(uTime * 0.28 + 2.5), 0.5 * sin(uTime * 0.35 + 4.2));
  float dBlobs = sdSphere(p - b0, 0.5);
  dBlobs = smin(dBlobs, sdSphere(p - b1, 0.42), 0.6);
  dBlobs = smin(dBlobs, sdSphere(p - b2, 0.46), 0.6);
  if (dBlobs < d) { d = dBlobs; mat = 1.0; }

  // sharp box
  float dBox = sdBox(p - vec3(-1.6, 0.5, 0.8), vec3(0.5));
  if (dBox < d) { d = dBox; mat = 2.0; }

  // torus
  float dTorus = sdTorus(p - vec3(1.7, 0.55, -0.9), vec2(0.55, 0.18));
  if (dTorus < d) { d = dTorus; mat = 3.0; }

  // ring of domain-repeated columns further out
  vec3 pc = p - vec3(0.0, 0.0, -4.0);
  pc.xz = opRep(pc.xz, 1.6, 5.0);
  float dColumns = sdBox(pc - vec3(0.0, 0.9, 0.0), vec3(0.18, 0.9, 0.18));
  if (dColumns < d) { d = dColumns; mat = 4.0; }

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
  for (int i = 0; i < 32; i++) {
    if (t >= maxt) break;
    float h = mapDist(ro + rd * t);
    if (h < 1e-3) return 0.0;
    res = min(res, k * h / t);
    t += h;
  }
  return clamp(res, 0.0, 1.0);
}

vec3 materialColor(float id) {
  if (id < 1.5) return vec3(0.06, 0.55, 0.5);   // blobs — teal
  if (id < 2.5) return vec3(0.85, 0.4, 0.08);    // box — orange
  if (id < 3.5) return vec3(0.5, 0.15, 0.7);     // torus — purple
  return vec3(0.65, 0.65, 0.68);                 // columns — light grey
}

void main() {
  vec3 ro = cameraPosition;
  vec3 rd = normalize(vRayDir);
  vec3 lightDir = normalize(vec3(0.6, 0.7, 0.3));

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
    fragColor = vec4(uBackground, 1.0);
    gl_FragDepth = 1.0;
    return;
  }

  vec3 n = calcNormal(p);
  float diff = max(dot(n, lightDir), 0.0);
  float ao = calcAO(p, n);
  float shadow = softShadow(p + n * 0.02, lightDir, 0.02, 8.0, 16.0);

  vec3 albedo = matId < 0.5 ? groundColor(p) : materialColor(matId);
  vec3 color = albedo * (0.15 * ao + diff * shadow * 0.9);

  float fog = 1.0 - exp(-0.02 * t);
  color = mix(color, uBackground, fog);

  fragColor = vec4(color, 1.0);

  // world -> view -> NDC depth, matching the camera's own projection
  float viewZ = (viewMatrix * vec4(p, 1.0)).z;
  float ndcZ = (uProjA * viewZ + uProjB) / (-viewZ);
  gl_FragDepth = clamp(ndcZ * 0.5 + 0.5, 0.0, 1.0);
}
`

export default function RaymarchScene() {
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
        uBackground: { value: new THREE.Vector3(0.02, 0.03, 0.05) },
      },
    })
  }, [])

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
    }
  }, [material])

  useFrame((state) => {
    material.uniforms.uTime.value = state.clock.getElapsedTime()
  })

  return <mesh ref={meshRef} geometry={geometry} material={material} frustumCulled={false} />
}
