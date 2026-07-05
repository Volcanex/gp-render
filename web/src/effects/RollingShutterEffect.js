// Rolling shutter as pure geometric skew — no blur. Simulates a CMOS sensor
// reading rows top-to-bottom: each row samples where the world WAS at that
// row's readout moment, so panning skews verticals and shake wobbles them
// jello-style. Runs on the clean image, before depth-based effects.
import { Effect } from 'postprocessing'
import { Uniform, Vector2 } from 'three'

const fragmentShader = /* glsl */ `
uniform float uAmount;
uniform vec2 uVelocity;
uniform float uWobble;

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  if (uAmount <= 0.0) {
    outputColor = inputColor;
    return;
  }

  // readout progress relative to frame centre: top row read first (negative),
  // bottom row read last (positive) — this is what skews verticals on a pan
  float rowPhase = uv.y - 0.5;
  vec2 offset = uVelocity * rowPhase * uAmount * 3.0;

  // secondary jello wobble: a sine that travels with readout progress, scaled
  // by how much the camera is actually moving so it doesn't wobble at rest
  offset.x += sin(uv.y * 8.0 + rowPhase * 4.0) * length(uVelocity) * uWobble * uAmount;

  outputColor = texture(inputBuffer, clamp(uv + offset, vec2(0.001), vec2(0.999)));
}
`

export class RollingShutterEffect extends Effect {
  constructor() {
    super('RollingShutterEffect', fragmentShader, {
      uniforms: new Map([
        ['uAmount', new Uniform(0)],
        ['uVelocity', new Uniform(new Vector2())],
        ['uWobble', new Uniform(0.15)],
      ]),
    })
  }

  setParams(params) {
    this.uniforms.get('uAmount').value = params.rollingShutter ? Math.max(0, Math.min(1, params.rollingShutter)) : 0
  }

  // called once per frame by the pipeline: camera's screen-space angular
  // velocity in uv-units-per-frame
  setVelocity(vx, vy) {
    this.uniforms.get('uVelocity').value.set(vx, vy)
  }
}
