import * as Schema from "effect/Schema";

/** The longest path the Prints library grammar admits, as the Computer's own bound. */
const maximumPathCharacters = 4096;
/** Most bytes one folder or file name may hold. */
const maximumSegmentBytes = 255;
const utf8 = new TextEncoder();

/**
 * A folder inside the chosen destination, written relative to it:
 * `Characters/Mira`. It has no leading slash, no `.` or `..`, no empty
 * segment and no NUL, so a join with the destination cannot leave it. The
 * destination root itself is the absent folder, never an empty string.
 */
const relativeFolderSchema = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1)),
  Schema.check(Schema.isMaxLength(maximumPathCharacters)),
  Schema.check(
    Schema.makeFilter(
      (folder) =>
        !folder.includes("\0") &&
        folder
          .split("/")
          .every(
            (segment) =>
              segment !== "" &&
              segment !== "." &&
              segment !== ".." &&
              utf8.encode(segment).byteLength <= maximumSegmentBytes,
          ),
      { description: "a relative folder inside the library" },
    ),
  ),
);
export type RelativeFolder = typeof relativeFolderSchema.Type;
export const isRelativeFolder = Schema.is(relativeFolderSchema);

/** The absolute path of `folder` inside `destination`; the destination itself when absent. */
export function joinFolder(
  destination: string,
  folder: RelativeFolder | undefined,
): string {
  return folder === undefined ? destination : `${destination}/${folder}`;
}

/** The folder of an absolute path inside `destination`, or undefined for the root or a path outside. */
export function folderOf(
  destination: string,
  path: string,
): RelativeFolder | undefined {
  const prefix = `${destination}/`;
  if (!path.startsWith(prefix)) return undefined;
  const parent = path.slice(prefix.length).split("/").slice(0, -1).join("/");
  return isRelativeFolder(parent) ? parent : undefined;
}

/** True when `path` is strictly inside `destination`, at any depth. */
export function isInside(destination: string, path: string): boolean {
  const prefix = `${destination}/`;
  return (
    path.startsWith(prefix) &&
    path.length > prefix.length &&
    !path.includes("\0") &&
    path
      .slice(prefix.length)
      .split("/")
      .every((segment) => segment !== "" && segment !== "." && segment !== "..")
  );
}

/** One crumb per level of a folder: `Characters/Mira` is `Characters`, then `Characters/Mira`. */
export function folderCrumbs(
  folder: RelativeFolder | undefined,
): readonly Readonly<{ name: string; folder: RelativeFolder }>[] {
  if (folder === undefined) return [];
  const names = folder.split("/");
  return names.map((name, index) => ({
    name,
    folder: names.slice(0, index + 1).join("/"),
  }));
}

/**
 * Where a breadth-first walk of the library stands: the folders still to read
 * (each relative to the destination, `""` for the root) and how far into the
 * first one it has read.
 */
export const walkCursorSchema = Schema.Struct({
  queue: Schema.Array(
    Schema.String.pipe(Schema.check(Schema.isMaxLength(maximumPathCharacters))),
  ).pipe(Schema.check(Schema.isMinLength(1))),
  offset: Schema.Number.pipe(
    Schema.check(Schema.isInt()),
    Schema.check(Schema.isGreaterThanOrEqualTo(0)),
  ),
});
