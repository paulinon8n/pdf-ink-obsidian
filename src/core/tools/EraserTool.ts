import type { Tool, StrokeInit } from "./Tool";
import type { Stroke } from "../models";

export class EraserTool implements Tool {
  id: "eraser" = "eraser";
  createStroke(init: StrokeInit): Stroke {
    return {
      tool: "eraser",
      device: init.device,
      color: "#000000", // ignorado no renderer
      size: Math.max(4, init.settings.penSize),
      opacity: 1,
      refW: init.refW,
      refH: init.refH,
      points: [init.point],
    };
  }
}