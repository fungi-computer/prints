/** Retained b6eabe5 Caps upload filename normalization; no global collision guarantee. */
export function normalizeUploadFilename(name: string): string {
  return name.replace(/\s/gu, " ").replace(/ +/g, " ").trim();
}

/** `dusk.png` first, then `dusk 2.png`, `dusk 3.png` while `isTaken`. */
export function uniqueUploadPath(
  directory: string,
  filename: string,
  isTaken: (path: string) => boolean,
): string {
  const base = directory.replace(/\/$/, "");
  const dot = filename.lastIndexOf(".");
  const stem = dot > 0 ? filename.slice(0, dot) : filename;
  const extension = dot > 0 ? filename.slice(dot) : "";
  let path = `${base}/${filename}`;
  for (let attempt = 2; isTaken(path); attempt += 1)
    path = `${base}/${stem} ${String(attempt)}${extension}`;
  return path;
}

/** Every file name already stored in `directory`, however many listing pages. */
export async function listTakenPaths(
  directory: string,
  listPage: (offset: number) => Promise<{
    entries: readonly { name: string }[];
    nextOffset: number | null;
  }>,
): Promise<ReadonlySet<string>> {
  const base = directory.replace(/\/$/, "");
  const taken = new Set<string>();
  let offset: number | null = 0;
  while (offset !== null) {
    const page = await listPage(offset);
    if (page.nextOffset !== null && page.nextOffset <= offset)
      throw new Error("Directory pagination did not advance");
    for (const entry of page.entries) taken.add(`${base}/${entry.name}`);
    offset = page.nextOffset;
  }
  return taken;
}
