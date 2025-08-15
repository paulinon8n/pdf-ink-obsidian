import type { IRenderer, RendererInfo } from "./IRenderer";
import type { PageState, Stroke } from "../core/models";
import type { Settings } from "../app/PdfInkApp";
import { sizeFor } from "../core/StrokeEngine";

type PresentMode = "composite2D" | "dom";

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return [0, 0, 0];
  return [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255];
}

const VS = `
attribute vec2 a_pos;
uniform vec2 u_view;
void main() {
  float x = (a_pos.x / u_view.x) * 2.0 - 1.0;
  float y = 1.0 - (a_pos.y / u_view.y) * 2.0;
  gl_Position = vec4(x, y, 0.0, 1.0);
}
`;

const FS = `
precision mediump float;
uniform vec4 u_color;
void main(){ gl_FragColor = u_color; }
`;

function createProgram(gl: WebGLRenderingContext, vsSrc: string, fsSrc: string) {
  const vs = gl.createShader(gl.VERTEX_SHADER)!;
  gl.shaderSource(vs, vsSrc); gl.compileShader(vs);
  if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) throw new Error("VS compile error: " + gl.getShaderInfoLog(vs));
  const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
  gl.shaderSource(fs, fsSrc); gl.compileShader(fs);
  if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) throw new Error("FS compile error: " + gl.getShaderInfoLog(fs));
  const prog = gl.createProgram()!;
  gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error("Program link error: " + gl.getProgramInfoLog(prog));
  gl.deleteShader(vs); gl.deleteShader(fs);
  return prog;
}

type ProgramRefs = {
  prog: WebGLProgram;
  a_pos: number;
  u_view: WebGLUniformLocation;
  u_color: WebGLUniformLocation;
};

export class WebGLRenderer implements IRenderer {
  private glCanvas: HTMLCanvasElement;
  private gl: WebGLRenderingContext;
  private refs: ProgramRefs;
  private vbo: WebGLBuffer;
  private presentMode: PresentMode = "composite2D";

  // info p/ UI
  private infoVendor: string | null = null;
  private infoRenderer: string | null = null;
  private infoAA: boolean | null = null;
  private infoPersistent: boolean | null = null;

  constructor(mode: PresentMode = "composite2D") {
    this.presentMode = mode;
    this.glCanvas = document.createElement("canvas");

    // DOM: preservar o drawing buffer (sem fallback)
    const attrs: WebGLContextAttributes = {
      alpha: true,
      antialias: true,
      premultipliedAlpha: true,
      preserveDrawingBuffer: mode === "dom",
    };
    const gl = this.glCanvas.getContext("webgl", attrs);
    if (!gl) throw new Error("WebGL não suportado");
    this.gl = gl;

    const prog = createProgram(gl, VS, FS);
    const a_pos = gl.getAttribLocation(prog, "a_pos");
    const u_view = gl.getUniformLocation(prog, "u_view")!;
    const u_color = gl.getUniformLocation(prog, "u_color")!;
    this.refs = { prog, a_pos, u_view, u_color };

    const vbo = gl.createBuffer()!;
    this.vbo = vbo;

    gl.disable(gl.DITHER);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    try {
      const dbgExt = gl.getExtension("WEBGL_debug_renderer_info");
      const vendor = dbgExt ? gl.getParameter((dbgExt as any).UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
      const renderer = dbgExt ? gl.getParameter((dbgExt as any).UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      this.infoVendor = String(vendor || "") || null;
      this.infoRenderer = String(renderer || "") || null;
      const ca = gl.getContextAttributes();
      this.infoAA = !!ca?.antialias;
      this.infoPersistent = !!ca?.preserveDrawingBuffer;
      console.log("[PDF Ink][WebGL] Contexto OK:", { vendor, renderer, antialias: this.infoAA, preserveDrawingBuffer: this.infoPersistent, mode });
    } catch {}
    this.glCanvas.addEventListener("webglcontextlost", (e) => console.log("[PDF Ink][WebGL] context lost", e));
    this.glCanvas.addEventListener("webglcontextrestored", () => console.log("[PDF Ink][WebGL] context restored"));
  }

  getInfo(): RendererInfo {
    return {
      backend: "WebGL",
      mode: this.presentMode,
      vendor: this.infoVendor,
      renderer: this.infoRenderer,
      antialias: this.infoAA,
      persistent: this.infoPersistent,
    };
  }

  getDomCanvas(): HTMLCanvasElement | null {
    return this.presentMode === "dom" ? this.glCanvas : null;
  }

  resize(W: number, H: number) {
    if (this.glCanvas.width !== W || this.glCanvas.height !== H) {
      this.glCanvas.width = W; this.glCanvas.height = H;
      this.gl.viewport(0, 0, W, H);
    }
  }

  present() {
    try { this.gl.flush(); } catch {}
  }

  private clearGL() {
    const gl = this.gl;
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  private buildStrokeTrisRange(s: Stroke, W: number, H: number, settings: Settings, startIndex: number): Float32Array {
    const start = Math.max(1, Math.min(startIndex, s.points.length - 1));
    const segs = Math.max(0, (s.points.length - 1) - (start - 1));
    const out = new Float32Array(segs * 6 * 2);
    let o = 0;
    const pts = s.points;
    for (let i = start; i < pts.length; i++) {
      const p0 = pts[i - 1], p1 = pts[i];
      const dt = Math.max(1, p1.t - p0.t);
      const dist = Math.hypot(p1.x - p0.x, p1.y - p0.y);
      const speed = dist / (dt / 1000);
      const press = (p0.p + p1.p) * 0.5;
      const width = Math.max(0.75, sizeFor(press, speed, s.size, settings.velocityAffectsSize, s.device));

      const x0 = p0.x * W, y0 = p0.y * H;
      const x1 = p1.x * W, y1 = p1.y * H;

      let nx = y1 - y0;
      let ny = -(x1 - x0);
      const nlen = Math.hypot(nx, ny) || 1;
      nx /= nlen; ny /= nlen;
      const half = width * 0.5;

      const ax = x0 + nx * half, ay = y0 + ny * half;
      const bx = x1 + nx * half, by = y1 + ny * half;
      const cx = x1 - nx * half, cy = y1 - ny * half;
      const dx = x0 - nx * half, dy = y0 - ny * half;

      out[o++] = ax; out[o++] = ay;
      out[o++] = bx; out[o++] = by;
      out[o++] = cx; out[o++] = cy;
      out[o++] = cx; out[o++] = cy;
      out[o++] = dx; out[o++] = dy;
      out[o++] = ax; out[o++] = ay;
    }
    return out;
  }

  private drawStrokeRangeGL(s: Stroke, W: number, H: number, settings: Settings, startIndex: number) {
    const gl = this.gl;
    const { prog, a_pos, u_view, u_color } = this.refs;

    if (s.points.length < 2) return;

    if (s.tool === "eraser") {
      gl.blendFuncSeparate(gl.ZERO, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE_MINUS_SRC_ALPHA);
    } else {
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    }

    const [r, g, b] = hexToRgb(s.color || "#000000");
    const alpha = s.tool === "eraser" ? 1 : (s.opacity ?? 1);

    const tris = this.buildStrokeTrisRange(s, W, H, settings, startIndex);

    gl.useProgram(prog);
    gl.uniform2f(u_view, W, H);
    gl.uniform4f(u_color, r, g, b, alpha);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, tris, gl.STREAM_DRAW);
    gl.enableVertexAttribArray(a_pos);
    gl.vertexAttribPointer(a_pos, 2, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.TRIANGLES, 0, tris.length / 2);
    gl.flush();
  }

  private drawStrokeFullGL(s: Stroke, W: number, H: number, settings: Settings) {
    this.drawStrokeRangeGL(s, W, H, settings, 1);
  }

  drawStroke(ctx2d: CanvasRenderingContext2D, s: Stroke, W: number, H: number, settings: Settings): void {
    if (this.presentMode === "dom") {
      this.resize(W, H);
      const start = Math.max(1, s.points.length - 1);
      this.drawStrokeRangeGL(s, W, H, settings, start);
      return;
    }

    this.resize(W, H);
    this.clearGL();
    this.drawStrokeFullGL(s, W, H, settings);

    ctx2d.save();
    ctx2d.globalCompositeOperation = "source-over";
    ctx2d.globalAlpha = 1;
    ctx2d.drawImage(this.glCanvas, 0, 0, W, H);
    ctx2d.restore();
  }

  /** tail incremental quando em DOM */
  drawStrokeTail(s: Stroke, W: number, H: number, settings: Settings, fromIndex = 1) {
    if (this.presentMode !== "dom") {
      this.drawStroke(undefined as any, s, W, H, settings);
      return;
    }
    this.resize(W, H);
    this.drawStrokeRangeGL(s, W, H, settings, fromIndex);
  }

  redrawPage(ctx2d: CanvasRenderingContext2D, page: PageState, W: number, H: number, settings: Settings): void {
    this.resize(W, H);
    this.clearGL();

    for (const s of page.strokes) this.drawStrokeFullGL(s, W, H, settings);

    if (this.presentMode === "dom") return;

    ctx2d.save();
    ctx2d.globalCompositeOperation = "source-over";
    ctx2d.globalAlpha = 1;
    ctx2d.clearRect(0, 0, W, H);
    ctx2d.drawImage(this.glCanvas, 0, 0, W, H);
    ctx2d.restore();
  }
}
