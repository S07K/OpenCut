"use client";

import { defaultFilterVert, Filter, GlProgram, UniformGroup } from "pixi.js";

/**
 * A chroma-key (green-screen) filter.
 *
 * Makes pixels near a key colour transparent so the layer on the track below
 * shows through — the classic "green screen → replace the background" flow, and
 * the reason it pairs with multiple video tracks. Keying is a simple RGB-distance
 * test with a soft edge: pixels within `similarity` of the key are fully cut,
 * and `smoothness` widens the falloff so the matte isn't a hard, jagged line.
 *
 * The maths runs on un-premultiplied colour (Pixi stores premultiplied), which
 * is why the shader divides out alpha before comparing and multiplies it back
 * before writing — the same dance Pixi's own filters do.
 */
const fragment = /* glsl */ `
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec3 uKeyColor;
uniform float uSimilarity;
uniform float uSmoothness;

void main() {
    vec4 color = texture(uTexture, vTextureCoord);
    if (color.a > 0.0) color.rgb /= color.a; // un-premultiply

    float dist = distance(color.rgb, uKeyColor);
    // Below similarity: keyed out (alpha 0); fades to opaque over smoothness.
    float alpha = smoothstep(uSimilarity, uSimilarity + uSmoothness + 0.0001, dist);

    color.a *= alpha;
    color.rgb *= color.a; // premultiply again
    finalColor = color;
}
`;

export class ChromaKeyFilter extends Filter {
  constructor() {
    super({
      glProgram: GlProgram.from({ vertex: defaultFilterVert, fragment, name: "chroma-key" }),
      resources: {
        chromaUniforms: new UniformGroup({
          uKeyColor: { value: [0, 1, 0], type: "vec3<f32>" },
          uSimilarity: { value: 0.4, type: "f32" },
          uSmoothness: { value: 0.1, type: "f32" },
        }),
      },
    });
  }

  private get uniforms() {
    return (this.resources.chromaUniforms as UniformGroup).uniforms as {
      uKeyColor: number[];
      uSimilarity: number;
      uSmoothness: number;
    };
  }

  /** Key colour as linear 0..1 RGB. */
  set keyColor(rgb: [number, number, number]) {
    this.uniforms.uKeyColor = rgb;
  }

  set similarity(value: number) {
    this.uniforms.uSimilarity = value;
  }

  set smoothness(value: number) {
    this.uniforms.uSmoothness = value;
  }
}
