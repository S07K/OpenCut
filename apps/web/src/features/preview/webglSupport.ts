"use client";

/**
 * WebGL capability probe.
 *
 * PixiJS reports shader failures to the console but still resolves its `init`,
 * so a broken WebGL stack produces a blank canvas and no error anyone can act
 * on. This probe front-runs that: it checks the specific capabilities the
 * renderer depends on and lets the UI say what is wrong instead of showing an
 * unexplained empty frame.
 *
 * The `getShaderSource` check is not hypothetical — some embedded and headless
 * WebKit builds return `null` from it, which is exactly the input that makes
 * Pixi fail with "Could not retrieve shader source".
 */

export type WebGLSupport = { supported: true } | { supported: false; reason: string };

export function probeWebGLSupport(): WebGLSupport {
  if (typeof document === "undefined") {
    return { supported: false, reason: "No document (server render)" };
  }

  const canvas = document.createElement("canvas");
  const gl =
    (canvas.getContext("webgl2") as WebGL2RenderingContext | null) ??
    (canvas.getContext("webgl") as WebGLRenderingContext | null);

  if (!gl) return { supported: false, reason: "WebGL is unavailable in this browser" };

  const shader = gl.createShader(gl.VERTEX_SHADER);
  if (!shader) return { supported: false, reason: "WebGL shaders cannot be created" };

  const source = "void main() { gl_Position = vec4(0.0, 0.0, 0.0, 1.0); }";
  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return { supported: false, reason: "WebGL shaders fail to compile" };
  }

  // The quirk that breaks Pixi: compilation succeeds, but the driver refuses to
  // hand the source back, and Pixi's shader system depends on being able to.
  const readBack = gl.getShaderSource(shader);
  gl.deleteShader(shader);

  if (readBack === null) {
    return {
      supported: false,
      reason: "This browser's WebGL does not support shader source read-back",
    };
  }

  return { supported: true };
}
