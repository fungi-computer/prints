import * as z from "zod";
import type { AppRoot } from "@fungi.computer/agar";
import { appMethods } from "@fungi.computer/agar/backend";
import { AppError } from "@fungi.computer/agar/errors";
import type { WhistleJsonValue } from "@fungi.computer/whistle";

const refusal = z.object({ error: z.string() });
const path = z.string().min(1).max(4096);
const moveFailure = z.enum([
  "not_granted",
  "not_found",
  "conflict",
  "invalid",
  "unavailable",
]);
const movedSchema = z.object({
  moved: z.array(z.object({ from: path, to: path })),
  failed: z.array(z.object({ path, error: moveFailure })),
});
const describedSchema = z.object({
  files: z.array(
    z.object({
      path,
      kind: z.enum(["image", "video"]).nullable(),
      model: z.string().nullable(),
      modelLabel: z.string().nullable(),
      durationSeconds: z.number().nullable(),
      favorite: z.boolean(),
    }),
  ),
});
const favoritesSchema = z.object({
  paths: z.array(path),
  next: path.nullable(),
});
export type MoveOutcome = z.output<typeof movedSchema>;
export type FileDescription = z.output<typeof describedSchema>["files"][number];
export type FavoritesPage = z.output<typeof favoritesSchema>;

/** Prints' own backend answers a refusal as `{error}`; the UI says it as a thrown failure. */
async function call<T>(
  app: AppRoot,
  method: string,
  input: Record<string, WhistleJsonValue | undefined>,
  schema: z.ZodType<T>,
): Promise<T> {
  const reply = await app.capabilities
    .require(appMethods)
    .call(method, JSON.stringify(input));
  const parsed = schema.safeParse(reply);
  if (parsed.success) return parsed.data;
  const refused = refusal.safeParse(reply);
  throw new AppError(
    refused.success
      ? `Prints refused ${method}: ${refused.data.error}`
      : `Prints answered ${method} in an unexpected shape`,
    { code: "PROTOCOL", retryable: false },
  );
}

/** Move files or folders into a library folder, keeping their names. */
export function moveFiles(
  app: AppRoot,
  input: Readonly<{
    paths: readonly string[];
    folder: string | undefined;
    createFolder?: boolean;
    /** Give one moved item a new name, which renames it in place. */
    name?: string | undefined;
  }>,
): Promise<MoveOutcome> {
  return call(
    app,
    "moveFiles",
    {
      paths: [...input.paths],
      folder: input.folder,
      createFolder: input.createFolder ?? false,
      name: input.name,
    },
    movedSchema,
  );
}

/** Kind, model, duration and favorite for one page of paths. */
export async function describeFiles(
  app: AppRoot,
  paths: readonly string[],
): Promise<readonly FileDescription[]> {
  return (
    await call(app, "describeFiles", { paths: [...paths] }, describedSchema)
  ).files;
}

export async function setFavorite(
  app: AppRoot,
  paths: readonly string[],
  favorite: boolean,
): Promise<void> {
  await call(
    app,
    "setFavorite",
    { paths: [...paths], favorite },
    z.object({ favorite: z.boolean(), count: z.number() }),
  );
}

export function listFavorites(
  app: AppRoot,
  after: string | null,
  limit: number,
): Promise<FavoritesPage> {
  return call(app, "listFavorites", { after, limit }, favoritesSchema);
}
