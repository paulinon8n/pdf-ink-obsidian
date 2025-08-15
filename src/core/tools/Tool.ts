import type { Settings } from "../../app/PdfInkApp";
import type { Stroke } from "../models";

export type ToolId = "pen" | "eraser";

export type StrokeInit = {
  device: "pen" | "mouse";
  refW: number;
  refH: number;
  settings: Settings;
  point: { x: number; y: number; p: number; t: number; tilt?: number; twist?: number };
};

export interface Tool {
  id: ToolId;
  /** Constrói um novo Stroke com as configs atuais */
  createStroke(init: StrokeInit): Stroke;
}
