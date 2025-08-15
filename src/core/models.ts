export type ToolId = "pen" | "eraser"; // highlighter depois
export type Device = "pen" | "mouse" | "touch";

export type Point = { x: number; y: number; p: number; t: number; tilt?: number; twist?: number };

export type Stroke = {
  tool: ToolId;               // ← simplificado (antes: ToolId | "eraser")
  device: Device;
  color: string;
  size: number;
  refW: number;
  refH: number;
  opacity?: number;
  points: Point[];
};

export type PageState = { strokes: Stroke[] };

export interface SerializableDoc {
  version: number;
  updated: number;
  pages: Record<number, PageState>;
}