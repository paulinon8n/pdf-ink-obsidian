import { SidecarPathStrategy, SIDECAR_SUFFIX } from "./_types";

export class SiblingStrategy implements SidecarPathStrategy {
  resolvePath(pdfPath: string): string { return `${pdfPath}${SIDECAR_SUFFIX}`; }
  candidatePaths(pdfPath: string): string[] { return [ `${pdfPath}${SIDECAR_SUFFIX}` ]; }
}
