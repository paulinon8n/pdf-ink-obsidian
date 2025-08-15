import type { Tool, StrokeInit } from "./Tool";
import type { Stroke } from "../models";

export class PenTool implements Tool {
  id: "pen" = "pen";
  createStroke(init: StrokeInit): Stroke {
    return {
      tool: "pen",
      device: init.device,
      color: init.settings.penColor,
      size: init.settings.penSize,
      opacity: init.settings.penOpacity,
      refW: init.refW,
      refH: init.refH,
      points: [init.point],
    };
  }
}
