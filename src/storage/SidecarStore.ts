import type { SerializableDoc } from "../core/models";
import type { DataAdapter } from "obsidian";
import type { SidecarPathStrategy } from "./strategies/_types";

export interface ISidecarStore {
  load(pdfPath: string): Promise<SerializableDoc | null>;
  save(pdfPath: string, data: SerializableDoc): Promise<void>;
}

export class SidecarStore implements ISidecarStore {
  constructor(private strategy: SidecarPathStrategy, private adapter: DataAdapter) {}

  async load(pdfPath: string): Promise<SerializableDoc | null> {
    for (const path of this.strategy.candidatePaths(pdfPath)) {
      try {
        const stat = await this.adapter.stat(path);
        if (!stat) continue;
        const txt = await this.adapter.read(path);
        const parsed = JSON.parse(txt);
        return parsed?.pages ? parsed : { version: 4, updated: Date.now(), pages: parsed };
      } catch {}
    }
    return null;
  }

  async save(pdfPath: string, data: SerializableDoc): Promise<void> {
    const outPath = this.strategy.resolvePath(pdfPath);
    await this.ensureFolder(outPath);
    await this.adapter.write(outPath, JSON.stringify(data, null, 2));
  }

  private async ensureFolder(filePath: string) {
    const dir = filePath.substring(0, filePath.lastIndexOf("/"));
    if (!dir) return;
    const mk = async (path: string) => {
      const stat = await this.adapter.stat(path);
      if (stat) return;
      const parent = path.substring(0, path.lastIndexOf("/"));
      if (parent) await mk(parent);
      try { await (this.adapter as any).mkdir(path); } catch {}
    };
    await mk(dir);
  }
}
