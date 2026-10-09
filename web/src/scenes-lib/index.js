// scenes.mjs contract: the framework-free ES module render publishes so
// external consumers (currently the gdesign compositor) can dynamically
// import its 3D scenes as live layers, without pulling in React/R3F/Leva.
//
// Each entry in `scenes` is a plain object:
//   {
//     id: string,       // stable identifier, used as the import key
//     label: string,     // human-readable name for pickers/UI
//     params: Record<string, ParamSpec>,
//     create({ canvas }): { renderFrame, dispose }
//   }
//
// ParamSpec (subset of gdesign's vocabulary):
//   float:  { kind: 'float', default, min, max, step?, unit?, animatable?, label? }
//   bool:   { kind: 'bool', default, animatable?, label? }
//   enum:   { kind: 'enum', default, options: string[], animatable?, label? }
//
// create({ canvas }) sets up the scene against the given canvas and returns:
//   renderFrame(t, params, width, height): draws one frame synchronously.
//     MUST be deterministic in (t, params): no internal clocks, no
//     Date.now(), no randomness. The caller may copy the canvas contents
//     immediately after this call returns, so renderFrame must not leave
//     anything mid-flight (no pending async work, no queued GPU commands
//     without a flush via the render call itself).
//   dispose(): releases GPU resources (geometry, materials, renderer).
//
// contractVersion bumps whenever this shape changes in a breaking way, so
// consumers can guard against skew between render's build and their own.
import { raymarch } from './raymarch.js'

export const contractVersion = 1
export const scenes = [raymarch]
