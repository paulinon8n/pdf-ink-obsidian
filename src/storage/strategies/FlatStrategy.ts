import { SidecarPathStrategy, SIDECAR_SUFFIX } from "./_types";

export class FlatStrategy implements SidecarPathStrategy {
  constructor(private root: string) {}
  resolvePath(pdfPath: string): string {
    const base = pdfPath.split("/").pop()!;
    const h = shortHash(pdfPath);
    return `${this.root}/${base}.${h}${SIDECAR_SUFFIX}`;
  }
  candidatePaths(pdfPath: string): string[] {
    const base = pdfPath.split("/").pop()!;
    const h = shortHash(pdfPath);
    return [
      `${this.root}/${base}.${h}${SIDECAR_SUFFIX}`,
      `${this.root}/${pdfPath}${SIDECAR_SUFFIX}`,
      `${pdfPath}${SIDECAR_SUFFIX}`, // legado
    ];
  }
}

/** hash simples FNV-1a */
function shortHash(input: string): string {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i++) { h ^= input.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16).padStart(8, "0").slice(0, 8);
}
