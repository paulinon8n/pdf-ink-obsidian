export interface SidecarPathStrategy {
  resolvePath(pdfPath: string): string;
  candidatePaths(pdfPath: string): string[];
}
export const SIDECAR_SUFFIX = ".ink.json";