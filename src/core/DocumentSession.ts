import type { PageState, Stroke, SerializableDoc } from "./models";
import { HistoryService } from "./HistoryService";
import type { Settings } from "../app/PdfInkApp";

export class DocumentSession {
  private pages = new Map<number, PageState>();
  private history = new Map<number, HistoryService>();
  constructor(public settings: Settings) {}

  getPages(): Record<number, PageState> {
    const out: Record<number, PageState> = {};
    for (const [i, p] of this.pages) out[i] = { strokes: [...p.strokes] };
    return out;
  }

  page(i: number): PageState {
    if (!this.pages.has(i)) this.pages.set(i, { strokes: [] });
    return this.pages.get(i)!;
  }

  addStroke(i: number, s: Stroke) {
    this.historyFor(i).clearRedo();
    this.page(i).strokes.push(s);
  }

  undo(i: number) {
    const p = this.page(i);
    const s = p.strokes.pop();
    if (s) this.historyFor(i).pushRedo(s);
  }

  redo(i: number) {
    const s = this.historyFor(i).popRedo();
    if (s) this.page(i).strokes.push(s);
  }

  toJSON(): SerializableDoc {
    const pages = this.getPages();
    return { version: 4, updated: Date.now(), pages };
  }

  fromJSON(json: any) {
    const raw = json?.pages ?? json;
    this.pages.clear();
    Object.keys(raw || {}).forEach(k => {
      const i = Number(k);
      const page = raw[k];
      if (page?.strokes?.length) this.pages.set(i, { strokes: page.strokes });
    });
  }

  private historyFor(i: number) {
    if (!this.history.has(i)) this.history.set(i, new HistoryService());
    return this.history.get(i)!;
  }
}
