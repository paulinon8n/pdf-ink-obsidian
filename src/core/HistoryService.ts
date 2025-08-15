import type { Stroke } from "./models";

export class HistoryService {
  private redo: Stroke[] = [];
  clearRedo() { this.redo.length = 0; }
  pushRedo(s: Stroke) { this.redo.push(s); }
  popRedo(): Stroke | undefined { return this.redo.pop(); }
}
