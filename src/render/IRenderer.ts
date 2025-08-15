import type { PageState, Stroke } from "../core/models";
import type { Settings } from "../app/PdfInkApp";

export type RendererInfo = {
  backend: "Canvas2D" | "WebGL";
  mode?: "composite2D" | "dom";
  vendor?: string | null;
  renderer?: string | null;
  antialias?: boolean | null;
  /** true quando o conteúdo do canvas persiste entre frames (preserveDrawingBuffer) */
  persistent?: boolean | null;
};

export interface IRenderer {
  drawStroke(
    ctx: CanvasRenderingContext2D,
    stroke: Stroke,
    W: number,
    H: number,
    settings: Settings
  ): void;

  redrawPage(
    ctx: CanvasRenderingContext2D,
    page: PageState,
    W: number,
    H: number,
    settings: Settings
  ): void;

  /** Renderização incremental do "tail" do traço atual (opcional; usado no WebGL DOM) */
  drawStrokeTail?(
    stroke: Stroke,
    W: number,
    H: number,
    settings: Settings,
    fromIndex?: number
  ): void;

  /** Canvas próprio quando apresentado diretamente no DOM (ex.: WebGL DOM) */
  getDomCanvas?(): HTMLCanvasElement | null;

  /** Para o overlay informar o tamanho ao backend */
  resize?(W: number, H: number): void;

  /** Informação de diagnóstico (UI) */
  getInfo?(): RendererInfo;

  /** Força apresentação imediata (ex.: gl.flush em WebGL DOM) */
  present?(): void;
}
