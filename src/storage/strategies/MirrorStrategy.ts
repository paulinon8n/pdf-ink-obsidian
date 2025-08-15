import { SidecarPathStrategy, SIDECAR_SUFFIX } from "./_types";

export class MirrorStrategy implements SidecarPathStrategy {
  constructor(private root: string) {}
  resolvePath(pdfPath: string): string { return `${this.root}/${pdfPath}${SIDECAR_SUFFIX}`; }
  candidatePaths(pdfPath: string): string[] {
    return [
      `${this.root}/${pdfPath}${SIDECAR_SUFFIX}`,
      `${pdfPath}${SIDECAR_SUFFIX}`, // legado ao lado
    ];
  }
}
