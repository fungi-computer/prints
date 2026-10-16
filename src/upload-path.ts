/** Retained b6eabe5 Caps upload filename normalization; no global collision guarantee. */
export function normalizeUploadFilename(name: string): string {
  return name.replace(/\s/gu, " ").replace(/ +/g, " ").trim();
}
