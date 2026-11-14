import { resultRows } from "@fungi.computer/agar/method-presentation";
import { formatMoney } from "@fungi.computer/caps/lib/format-money";
import { mediaCatalogModelSchema } from "@fungi.computer/darkroom/app-media-contracts";
import { recentOutputsGill } from "./gills.js";
import {
  outputAtPathInputSchema,
  outputItemSchema,
  outputPageInputSchema,
  outputPageSchema,
} from "./output-page.js";
import {
  mediaAudioBindingInputSchema,
  mediaImageBindingInputSchema,
  mediaVideoBindingInputSchema,
} from "@fungi.computer/darkroom/media-binding";
import { defaultMediaLibraryPath } from "../library-folder.js";
import { isInside, isRelativeFolder, joinFolder } from "../src/library-view.js";
import {
  pending,
  pendingSchema,
} from "@fungi.computer/agar/backend-definition";
import type { WhistleJsonValue } from "@fungi.computer/whistle";
import * as z from "zod";
import * as Schema from "effect/Schema";
import { Base64 } from "effect/encoding";
import {
  MediaSettingsError,
  listMediaModels,
  validateMediaGenerationSelection,
} from "@fungi.computer/darkroom";
import { mediaRequestIdSchema } from "@fungi.computer/agar/media-request-id";
import { mediaLibraryPathSchema } from "@fungi.computer/agar/media-library";
import {
  defineAppBackend,
  defineAppMethod,
} from "@fungi.computer/agar/backend-definition";
import {
  type MethodActor,
  folderArgumentSchema,
  generateImageInputSchema,
  generateImageCommandSchema,
  generatedImageSchema,
  generatedAudioSchema,
  generateSoundCommandSchema,
  generateSoundInputSchema,
  generateVideoInputSchema,
  generateVideoCommandSchema,
  generationCommandSchema,
  generatedVideoSchema,
  methodRefusalSchema,
} from "./method-contracts.js";
import {
  rememberMethodGeneration,
  completeMethodGeneration,
} from "./method-pending.js";
import {
  favoritePaths,
  indexedOutput,
  indexedOutputAtPath,
  indexedOutputs,
  listFavorites,
  printReferences,
  printTyped,
  rewriteMovedPaths,
  setFavorites,
  type MovedPath,
  type TypedInput,
} from "./print-records.js";
import {
  listPromptStyles,
  printStyle,
  promptStyleNamed,
  recordPrintStyle,
} from "./prompt-styles.js";
import {
  composePrompt,
  BUILT_IN_STYLES,
  MAX_STYLES,
  STYLE_NAME_LIMIT,
  STYLE_TEXT_LIMIT,
  promptLengthMessage,
  promptLimitFor,
} from "../src/prompt-styles.js";
import {
  listPromptCharacters,
  printCharacters,
  recordPrintCharacters,
} from "./prompt-characters.js";
import {
  CHARACTER_DESCRIPTION_LIMIT,
  MAX_CHARACTERS,
  MAX_CHARACTER_REFERENCES,
  CHARACTER_NAME_LIMIT,
  mentionNames,
  planCharacters,
} from "../src/prompt-characters.js";
import { referenceWording } from "../src/reference-mentions.js";

const empty = z.strictObject({});
const id = z.string().min(1).max(256);
const path = z.string().startsWith("/").min(2).max(4096);
const catalogModel = mediaCatalogModelSchema.unwrap();
const catalogSizes = catalogModel.shape.sizes.unwrap().unwrap();
const model = catalogModel
  .extend({
    sizes: z.array(catalogSizes.element.max(32)).max(32).readonly().nullable(),
  })
  .readonly();
const models = z.strictObject({ models: z.array(model).max(128) });
const byteRead = z.strictObject({
  path,
  byteOffset: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  content: z.string().max(174764),
  encoding: z.literal("base64"),
  truncated: z.boolean(),
});

/** One logical host call maps to one canonical Media identity inside this Installation. */
async function requestIdForCaller(
  method: "generateImage" | "generateVideo" | "generateSound",
  key: string,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(["prints", method, key])),
  );
  const hex = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  const suffix = BigInt(`0x${hex}`).toString(36).padStart(21, "0").slice(0, 21);
  return mediaRequestIdSchema.parse(`media_request_${suffix}`);
}

/** Only the reviewed scoped bindings and App-local durable state reach handlers. */
export type PrintsMethodContext = Readonly<{
  ctx: Readonly<{
    storage: Pick<DurableObjectStorage, "sql" | "transactionSync">;
  }>;
  env: Readonly<{
    MEDIA: Readonly<{
      models(input: Record<string, never>): Promise<WhistleJsonValue>;
      generate(
        input: z.output<typeof generationCommandSchema>,
      ): Promise<WhistleJsonValue>;
    }>;
    COMPUTER: Readonly<{
      list(input: {
        path: string;
        limit: number;
        offset: number;
      }): Promise<WhistleJsonValue>;
      read(input: {
        path: string;
        byteOffset: number;
        byteLength: number;
      }): Promise<WhistleJsonValue>;
      move(input: {
        from: string;
        to: string;
        createParents: boolean;
      }): Promise<WhistleJsonValue>;
    }>;
  }>;
}>;
const refusal = (
  error:
    | "not_granted"
    | "unavailable"
    | "conflict"
    | "not_found"
    | "invalid_path"
    | "invalid",
) => ({ error });

function presentRefusal(value: z.output<typeof methodRefusalSchema>) {
  if (
    "provider" in value &&
    value.stage === "provider" &&
    value.provider !== undefined &&
    "reason" in value.provider &&
    value.provider.reason === "credits_exhausted"
  )
    return {
      ...value,
      message:
        "Cloudflare AI Gateway couldn't fund this request. Check the account's credits and billing in the Cloudflare dashboard under AI Gateway, or choose a Workers AI model such as Flux. Nothing was charged.",
      retryable: false,
    };
  return value;
}

/** Only the admitted Media charge belongs on a saved-image receipt. */
function imageReceipt(result: z.output<typeof generatedImageSchema>): string {
  const cost = formatMoney(result.costMilliunits / 100_000, {
    precision: "exact",
  });
  return `Image saved to ${result.destination.computerId}:${result.destination.path} (${String(result.bytes)} bytes, ${String(result.width)}x${String(result.height)}, charge ${cost}).`;
}

const bindingNotGranted = z.object({
  code: z.literal("binding_not_granted"),
});

async function bindingCall(
  call: () => Promise<WhistleJsonValue>,
): Promise<WhistleJsonValue> {
  try {
    return await call();
  } catch (cause) {
    if (!bindingNotGranted.safeParse(cause).success) throw cause;
    return refusal("not_granted");
  }
}

const refuseArgument = (message: string) =>
  methodRefusalSchema.parse({
    error: "INVALID_ARGUMENT",
    message,
    stage: "settings",
    retryable: false,
  });

/**
 * Compose one generation from the caller's choices: each named or `@`-mentioned
 * saved character adds its description to the prompt and its images to the
 * references, a named style leads the prompt, and the result must fit the
 * model's reference and prompt limits. Anything unknown or over a limit is
 * refused before Media is called.
 */
export function composeGeneration<
  Settings extends {
    prompt: string;
    model: string;
    references?: readonly { path: string }[] | undefined;
  },
>(
  sql: SqlStorage,
  computerId: string,
  choices: Readonly<{
    style: string | undefined;
    characters: readonly string[] | undefined;
  }>,
  settings: Settings,
):
  | { settings: Settings; characters: readonly string[] }
  | { refusal: z.output<typeof methodRefusalSchema> } {
  const { style } = choices;
  const savedStyle = style === undefined ? null : promptStyleNamed(sql, style);
  if (style !== undefined && savedStyle === null)
    return { refusal: refuseArgument(`No style named "${style}".`) };
  const saved = listPromptCharacters(sql);
  const unknown = (choices.characters ?? []).filter(
    (name) =>
      !saved.some((entry) => entry.name.toLowerCase() === name.toLowerCase()),
  );
  if (unknown.length > 0)
    return {
      refusal: refuseArgument(
        `No character named ${unknown.map((name) => `"${name}"`).join(", ")}.`,
      ),
    };
  const model = listMediaModels().find((entry) => entry.id === settings.model);
  const plan = planCharacters({
    prompt: settings.prompt,
    names: choices.characters,
    saved,
    references: settings.references ?? [],
    // `@image1` is the first reference as the caller sent it, 1-based.
    wording: (merged) => referenceWording(merged, model),
    computerId,
    model:
      model === undefined
        ? undefined
        : { label: model.label, maxReferences: model.input.maxReferences },
  });
  if (plan.kind === "refused") return { refusal: refuseArgument(plan.message) };
  const characters = plan.characters.map((entry) => entry.name);
  const prompt = composePrompt(savedStyle?.text, plan.prompt);
  // Nothing added: the command's own settings validation names the limit.
  if (style === undefined && characters.length === 0)
    return { settings: { ...settings, prompt }, characters };
  const tooLong = promptLengthMessage(
    prompt,
    promptLimitFor(model),
    style,
    characters,
  );
  if (tooLong !== undefined) return { refusal: refuseArgument(tooLong) };
  return {
    settings:
      characters.length === 0
        ? { ...settings, prompt }
        : { ...settings, prompt, references: plan.references },
    characters,
  };
}

/** The request as the caller typed it: named characters read as mentions. */
function typedOf(
  settings: Readonly<{
    prompt: string;
    references?: readonly unknown[] | undefined;
  }>,
  characters: readonly string[] | undefined,
): TypedInput {
  return {
    prompt: mentionNames(settings.prompt, characters ?? []),
    references: settings.references?.length ?? 0,
  };
}

function selectedLibrary(
  context: PrintsMethodContext,
  computerId: string,
): string | null {
  const folder = context.ctx.storage.sql
    .exec<{ path: string }>(
      "SELECT path FROM media_library_folders WHERE computer_id=?",
      computerId,
    )
    .toArray()[0];
  if (!folder) return null;
  const decoded = Schema.decodeUnknownOption(mediaLibraryPathSchema)(
    folder.path,
  );
  return decoded._tag === "Some" ? decoded.value : null;
}
const missingLibrary = () =>
  methodRefusalSchema.parse({
    error: "library_unavailable",
    message: "Choose a Prints library folder on the selected Computer.",
  });

const pathArgument = path.describe(
  "An absolute path inside the library folder, as listOutputs returns it.",
);
const moveRefusals = [
  "not_granted",
  "not_found",
  "conflict",
  "invalid",
  "unavailable",
] as const;
const movedReply = z.strictObject({ from: path, to: path });
const listingReply = z.object({
  entries: z.array(z.object({ name: z.string().min(1), type: z.string() })),
  nextOffset: z.number().int().nonnegative().nullable(),
});
const notInLibrary = () => refusal("invalid_path");

/** The folder's absolute path and the library's, or the refusal to return. */
function libraryOf(
  context: PrintsMethodContext,
  caller: Readonly<{ computerId: string | null }>,
) {
  if (caller.computerId === null) return refusal("not_granted");
  const selected = selectedLibrary(context, caller.computerId);
  if (selected === null) return missingLibrary();
  return { computerId: caller.computerId, selected };
}

/** What one Computer move said, as the single failure a caller can act on. */
function moveFailure(reply: WhistleJsonValue): (typeof moveRefusals)[number] {
  const refused = methodRefusalSchema.safeParse(reply);
  if (!refused.success) return "unavailable";
  const known = moveRefusals.find((error) => error === refused.data.error);
  return known ?? "unavailable";
}

export const appBackend = defineAppBackend<PrintsMethodContext>({
  gills: [recentOutputsGill],
  methods: {
    listModels: defineAppMethod({
      description:
        "List image, video and audio models available through this App's admitted Media access.",
      effect: "read",
      requires: ["media.generation"],
      input: empty,
      output: z.union([models, methodRefusalSchema]),
      handler: async (input, context) => {
        const reply = await bindingCall(() => context.env.MEDIA.models(input));
        const refused = methodRefusalSchema.safeParse(reply);
        return refused.success
          ? presentRefusal(refused.data)
          : models.parse({ models: reply });
      },
    }),
    listCharacters: defineAppMethod({
      description:
        "List the saved Prints characters, by name. Each has a description and reference images (paths on the Computer; the count summed over the characters you pass is what the model's maxReferences must cover). Pass names as generateImage characters, or write @name in the prompt; the description joins the prompt and the references join settings.references. Names are case-insensitive. If the user names a character that is not listed, ask before generating.",
      effect: "read",
      requires: [],
      input: empty,
      output: z.strictObject({
        characters: z
          .array(
            z.strictObject({
              name: z.string().min(1).max(CHARACTER_NAME_LIMIT),
              description: z.string().max(CHARACTER_DESCRIPTION_LIMIT),
              references: z
                .array(z.strictObject({ path }))
                .max(MAX_CHARACTER_REFERENCES),
            }),
          )
          .max(MAX_CHARACTERS),
      }),
      handler: (_input, context) => ({
        characters: listPromptCharacters(context.ctx.storage.sql).map(
          ({ name, description, references }) => ({
            name,
            description,
            references: references.map((reference) => ({
              path: reference.path,
            })),
          }),
        ),
      }),
    }),
    listStyles: defineAppMethod({
      description:
        "List the saved Prints styles: built-in starters first, then the user's own. Pass a name as generateImage style; its text leads the prompt, so the model's maxPromptLength must cover style text + character descriptions + the prompt. Style names are exact and case-sensitive. If the user names a style that is not listed, ask before generating.",
      effect: "read",
      requires: [],
      input: empty,
      output: z.strictObject({
        styles: z
          .array(
            z.strictObject({
              name: z.string().min(1).max(STYLE_NAME_LIMIT),
              text: z.string().min(1).max(STYLE_TEXT_LIMIT),
              builtIn: z.boolean(),
            }),
          )
          .max(MAX_STYLES + BUILT_IN_STYLES.length),
      }),
      handler: (_input, context) => ({
        styles: listPromptStyles(context.ctx.storage.sql).map(
          ({ name, text, builtIn }) => ({ name, text, builtIn }),
        ),
      }),
    }),
    listOutputs: defineAppMethod({
      description:
        "List this App's recorded outputs in its selected library on the admitted Computer, newest first. Pass folder (like Characters/Mira) to list one folder inside the library and recursive: true to include every folder beneath it; by default the library folder's own files. Each item carries its model and, for a video, its duration (print.model, print.durationSeconds). A file may have been removed since recording.",
      effect: "read",
      requires: ["computer.list"],
      input: outputPageInputSchema,
      output: z.union([outputPageSchema, methodRefusalSchema]),
      handler: (input, context, caller) => {
        const library = libraryOf(context, caller);
        if ("error" in library) return library;
        return outputPageSchema.parse(
          indexedOutputs(
            context.ctx.storage.sql,
            library.computerId,
            joinFolder(library.selected, input.folder),
            input.after ?? null,
            input.limit,
            input.recursive,
          ),
        );
      },
    }),
    listFolders: defineAppMethod({
      description:
        "List the sub-folders of one folder in the selected library on the admitted Computer, by name (dot-folders are skipped). Pass folder (like Characters) for a folder inside the library; omit it for the library folder. A page holds at most the underlying listing page; pass next as after for more.",
      effect: "read",
      requires: ["computer.list"],
      input: z.strictObject({
        folder: folderArgumentSchema.optional(),
        after: z
          .number()
          .int()
          .nonnegative()
          .max(Number.MAX_SAFE_INTEGER)
          .nullable()
          .optional(),
        limit: z.number().int().min(1).max(100).default(100),
      }),
      output: z.union([
        z.strictObject({
          folders: z
            .array(
              z.strictObject({
                name: z.string().min(1),
                folder: folderArgumentSchema,
              }),
            )
            .max(100),
          next: z.number().int().nonnegative().nullable(),
        }),
        methodRefusalSchema,
      ]),
      handler: async (input, context, caller) => {
        const library = libraryOf(context, caller);
        if ("error" in library) return library;
        const reply = await bindingCall(() =>
          context.env.COMPUTER.list({
            path: joinFolder(library.selected, input.folder),
            limit: input.limit,
            offset: input.after ?? 0,
          }),
        );
        const refused = methodRefusalSchema.safeParse(reply);
        if (refused.success) return presentRefusal(refused.data);
        const listing = listingReply.parse(reply);
        const folders = listing.entries
          .filter(
            (entry) =>
              entry.type === "directory" && !entry.name.startsWith("."),
          )
          .map((entry) => ({
            name: entry.name,
            folder:
              input.folder === undefined
                ? entry.name
                : `${input.folder}/${entry.name}`,
          }))
          .filter((entry) => isRelativeFolder(entry.folder));
        return { folders, next: listing.nextOffset };
      },
    }),
    moveFiles: defineAppMethod({
      description:
        "Move files or folders into a folder inside the selected library on the admitted Computer, keeping each one's name. Use this, not a shell mv: it keeps each print's prompt, references, favorite and saved-character links with the file. paths are absolute paths inside the library (as listOutputs returns them); folder is relative to the library (like Characters/Mira), omitted for the library folder itself; createFolder: true makes a missing folder. Pass name with exactly one path to rename it. Nothing is overwritten: a name already in the folder is a conflict, and a folder cannot move into itself. Returns what moved and, per path, why anything did not.",
      effect: "write",
      requires: ["computer.writeFile"],
      input: z.strictObject({
        paths: z.array(pathArgument).min(1).max(100),
        folder: folderArgumentSchema.optional(),
        createFolder: z.boolean().default(false),
        name: z
          .string()
          .refine(isRelativeFolder, "A single new name")
          .refine((name) => !name.includes("/"), "A single new name")
          .optional()
          .describe(
            "Rename: the new name of the one path given, kept in folder.",
          ),
      }),
      output: z.union([
        z.strictObject({
          moved: z.array(z.strictObject({ from: path, to: path })).max(100),
          failed: z
            .array(z.strictObject({ path, error: z.enum(moveRefusals) }))
            .max(100),
        }),
        methodRefusalSchema,
      ]),
      handler: async (input, context, caller) => {
        const library = libraryOf(context, caller);
        if ("error" in library) return library;
        const sources = [...new Set(input.paths)];
        if (!sources.every((source) => isInside(library.selected, source)))
          return notInLibrary();
        if (input.name !== undefined && sources.length !== 1)
          return refusal("invalid");
        const target = joinFolder(library.selected, input.folder);
        const moved: MovedPath[] = [];
        const failed: { path: string; error: (typeof moveRefusals)[number] }[] =
          [];
        for (const from of sources) {
          const to = `${target}/${input.name ?? from.slice(from.lastIndexOf("/") + 1)}`;
          const reply = await bindingCall(() =>
            context.env.COMPUTER.move({
              from,
              to,
              createParents: input.createFolder,
            }),
          );
          const done = movedReply.safeParse(reply);
          if (done.success && done.data.from === from && done.data.to === to)
            moved.push({ from, to });
          else failed.push({ path: from, error: moveFailure(reply) });
        }
        // The index follows what the Computer actually moved, in one commit.
        if (moved.length > 0)
          context.ctx.storage.transactionSync(() => {
            rewriteMovedPaths(
              context.ctx.storage.sql,
              library.computerId,
              moved,
            );
          });
        return { moved, failed };
      },
    }),
    describeFiles: defineAppMethod({
      description:
        "Describe up to 24 files in the selected library on the admitted Computer in one call: for each path, whether Prints recorded it (kind image, video or audio, model, modelLabel, and a video or music track's durationSeconds, all null for a file Prints did not make) and whether the Team favorited it.",
      effect: "read",
      requires: ["computer.list"],
      input: z.strictObject({
        paths: z.array(pathArgument).min(1).max(24),
      }),
      output: z.union([
        z.strictObject({
          files: z
            .array(
              z.strictObject({
                path,
                kind: z.enum(["image", "video", "audio"]).nullable(),
                model: z.string().min(1).max(256).nullable(),
                modelLabel: z.string().min(1).max(256).nullable(),
                durationSeconds: z.number().int().nonnegative().nullable(),
                favorite: z.boolean(),
              }),
            )
            .max(24),
        }),
        methodRefusalSchema,
      ]),
      handler: (input, context, caller) => {
        const library = libraryOf(context, caller);
        if ("error" in library) return library;
        if (!input.paths.every((entry) => isInside(library.selected, entry)))
          return notInLibrary();
        const sql = context.ctx.storage.sql;
        const favorites = favoritePaths(sql, library.computerId, input.paths);
        const labels = new Map(
          listMediaModels().map((entry) => [entry.id, entry.label]),
        );
        return {
          files: input.paths.map((entry) => {
            const indexed = indexedOutputAtPath(
              sql,
              library.computerId,
              entry,
              library.selected,
            );
            return {
              path: entry,
              kind: indexed?.print.kind ?? null,
              model: indexed?.print.model ?? null,
              modelLabel:
                indexed === null
                  ? null
                  : (labels.get(indexed.print.model) ?? indexed.print.model),
              durationSeconds: indexed?.print.durationSeconds ?? null,
              favorite: favorites.has(entry),
            };
          }),
        };
      },
    }),
    setFavorite: defineAppMethod({
      description:
        "Favorite or unfavorite files in the selected library for the whole Team. paths are absolute paths inside the library. Repeating a call is harmless.",
      effect: "write",
      requires: [],
      input: z.strictObject({
        paths: z.array(pathArgument).min(1).max(100),
        favorite: z.boolean(),
      }),
      output: z.union([
        z.strictObject({
          favorite: z.boolean(),
          count: z.number().int().positive().max(100),
        }),
        methodRefusalSchema,
      ]),
      handler: (input, context, caller) => {
        const library = libraryOf(context, caller);
        if ("error" in library) return library;
        const paths = [...new Set(input.paths)];
        if (!paths.every((entry) => isInside(library.selected, entry)))
          return notInLibrary();
        context.ctx.storage.transactionSync(() => {
          setFavorites(
            context.ctx.storage.sql,
            library.computerId,
            paths,
            input.favorite,
          );
        });
        return { favorite: input.favorite, count: paths.length };
      },
    }),
    listFavorites: defineAppMethod({
      description:
        "List the Team's favorited files in the selected library, in path order. Pass folder to limit it to one folder and everything beneath it; pass next as after for the next page.",
      effect: "read",
      requires: [],
      input: z.strictObject({
        folder: folderArgumentSchema.optional(),
        after: path.nullable().optional(),
        limit: z.number().int().min(1).max(100).default(100),
      }),
      output: z.union([
        z.strictObject({
          paths: z.array(path).max(100),
          next: path.nullable(),
        }),
        methodRefusalSchema,
      ]),
      handler: (input, context, caller) => {
        const library = libraryOf(context, caller);
        if ("error" in library) return library;
        return listFavorites(
          context.ctx.storage.sql,
          library.computerId,
          joinFolder(library.selected, input.folder),
          input.after ?? null,
          input.limit,
        );
      },
    }),
    getOutput: defineAppMethod({
      description:
        "Read one recorded output by its file path, at any depth in the selected library on the admitted Computer: its prompt, model, the reference images it was generated from, the saved characters it used (characters) and the saved style it used (style, null when none). To remake or vary it, pass the same characters and style to generateImage with a new prompt.",
      effect: "read",
      requires: ["computer.list"],
      input: outputAtPathInputSchema,
      output: z.union([outputItemSchema, methodRefusalSchema]),
      handler: (input, context, caller) => {
        if (caller.computerId === null) return refusal("not_granted");
        const selected = selectedLibrary(context, caller.computerId);
        if (selected === null) return missingLibrary();
        const item = indexedOutputAtPath(
          context.ctx.storage.sql,
          caller.computerId,
          input.path,
          selected,
        );
        if (!item) return refusal("not_found");
        return outputItemSchema.parse({
          ...item,
          references: printReferences(
            context.ctx.storage.sql,
            item.print.printId,
          ),
          characters: printCharacters(
            context.ctx.storage.sql,
            item.print.printId,
          ),
          style: printStyle(context.ctx.storage.sql, item.print.printId),
          typed: printTyped(context.ctx.storage.sql, item.print.printId),
        });
      },
    }),
    openOutput: defineAppMethod({
      description:
        "Read at most 128 KiB of an indexed output, from any folder in the selected library on the admitted Computer, as base64. Use byteOffset to read the next chunk.",
      effect: "read",
      requires: ["computer.readFile"],
      input: z.strictObject({
        printId: id,
        byteOffset: z
          .number()
          .int()
          .nonnegative()
          .max(Number.MAX_SAFE_INTEGER)
          .default(0),
        byteLength: z
          .number()
          .int()
          .min(1)
          .max(128 * 1024)
          .default(128 * 1024),
      }),
      output: z.union([byteRead.extend({ printId: id }), methodRefusalSchema]),
      handler: async (input, context, caller) => {
        if (caller.computerId === null) return refusal("not_granted");
        const selected = selectedLibrary(context, caller.computerId);
        if (selected === null) return missingLibrary();
        const item = indexedOutput(
          context.ctx.storage.sql,
          caller.computerId,
          input.printId,
          selected,
        );
        if (!item) return refusal("not_found");
        const reply = await bindingCall(() =>
          context.env.COMPUTER.read({
            path: item.path,
            byteOffset: input.byteOffset,
            byteLength: input.byteLength,
          }),
        );
        const refused = methodRefusalSchema.safeParse(reply);
        if (refused.success) return presentRefusal(refused.data);
        const bytes = byteRead.parse(reply);
        const decoded = Base64.decode(bytes.content);
        if (
          decoded._tag === "Failure" ||
          decoded.success.byteLength > input.byteLength ||
          bytes.path !== item.path ||
          bytes.byteOffset !== input.byteOffset
        )
          return refusal("unavailable");
        return { printId: item.print.printId, ...bytes };
      },
    }),
    generateVideo: defineAppMethod({
      description:
        "Generate one short MP4 in this App's library with a video model from listModels. Resolution, aspect, duration, audio and path-only frame references follow that model's catalog. @imageN in the prompt names the Nth reference sent; frames read as first or last frame. The host chooses the Computer path. Workflows may omit requestId to derive it from the trusted caller key; otherwise use media_request_ followed by 21 random lowercase letters or digits. Pending means retry the same inputs and key after retryAfterMs. Existing billing and attachment budgets apply; the Workflow owns human review.",
      effect: "write",
      requires: ["media.generation", "computer.writeFile"],
      pending: true,
      input: generateVideoInputSchema,
      output: z.union([
        generatedVideoSchema.extend({ printId: id }),
        methodRefusalSchema,
      ]),
      present: {
        rows: resultRows,
        verb: "made",
        row: ({ output }) =>
          "error" in output
            ? {
                id: "refused",
                title: "Prints could not make this clip",
                detail: output.error,
                tone: "error",
              }
            : {
                id: output.printId,
                title: "Prints made this clip",
                detail: `${output.model} · ${String(output.width)}×${String(output.height)}`,
                media: { path: output.destination.path, format: "fungi:video" },
                open: { params: [{ key: "print", value: output.printId }] },
              },
      },
      handler: async (input, context, caller) => {
        if (caller.computerId === null || caller.actor.kind === "team-key")
          return refusal("not_granted");
        const requestId =
          input.requestId ??
          (caller.idempotencyKey === undefined
            ? undefined
            : await requestIdForCaller("generateVideo", caller.idempotencyKey));
        if (requestId === undefined)
          return methodRefusalSchema.parse({ error: "invalid" });
        const {
          folder,
          style,
          characters: characterNames,
          ...videoInput
        } = input;
        const library =
          selectedLibrary(context, caller.computerId) ??
          defaultMediaLibraryPath;
        const composed = composeGeneration(
          context.ctx.storage.sql,
          caller.computerId,
          { style, characters: characterNames },
          videoInput.settings,
        );
        if ("refusal" in composed) return composed.refusal;
        const command = mediaVideoBindingInputSchema.parse({
          kind: "video",
          ...generateVideoCommandSchema.parse({
            ...videoInput,
            settings: composed.settings,
            requestId,
          }),
          libraryPath: joinFolder(library, folder),
        });
        const actor: MethodActor =
          caller.actor.kind === "agent"
            ? { kind: "agent", id: caller.actor.agentId }
            : { kind: "member", id: caller.actor.memberId };
        const remembered = rememberMethodGeneration(
          context.ctx.storage,
          actor,
          caller.computerId,
          command,
        );
        if ("error" in remembered) return refusal("conflict");
        // Media rechecks admission and owns the existing provider/Billing retry identity.
        const reply = await bindingCall(() =>
          context.env.MEDIA.generate(command),
        );
        const refused = methodRefusalSchema.safeParse(reply);
        if (refused.success) return presentRefusal(refused.data);
        const working = pendingSchema.safeParse(reply);
        if (working.success) return pending(working.data.retryAfterMs);
        const result = generatedVideoSchema.parse(reply);
        const completed = completeMethodGeneration(
          context.ctx.storage,
          actor,
          caller.computerId,
          command,
          result,
          typedOf(videoInput.settings, characterNames),
        );
        if ("error" in completed) return refusal("conflict");
        if (style !== undefined)
          recordPrintStyle(context.ctx.storage.sql, command.requestId, style);
        recordPrintCharacters(
          context.ctx.storage.sql,
          command.requestId,
          composed.characters,
        );
        context.ctx.storage.sql.exec(
          "INSERT OR IGNORE INTO media_library_folders(computer_id,path) VALUES (?,?)",
          caller.computerId,
          library,
        );
        return {
          ...generatedVideoSchema.parse(completed.result),
          printId: command.requestId,
        };
      },
    }),
    generateSound: defineAppMethod({
      description:
        "Generate one MP3 in this App's library: speech or music, with an audio model from listModels (kind audio). A speech model reads the prompt aloud in settings.voiceId (default: the model's defaultVoiceId); a music model composes the prompt as a track of settings.durationSeconds (its audio.seconds bounds). Audio takes no references, styles or characters. The host chooses the Computer path. Workflows may omit requestId to derive it from the trusted caller key; otherwise use media_request_ followed by 21 random lowercase letters or digits. Pending means retry the same inputs and key after retryAfterMs. Existing billing and attachment budgets apply.",
      effect: "write",
      requires: ["media.generation", "computer.writeFile"],
      pending: true,
      input: generateSoundInputSchema,
      output: z.union([
        generatedAudioSchema.extend({ printId: id }),
        methodRefusalSchema,
      ]),
      present: {
        rows: resultRows,
        verb: "made",
        row: ({ output }) =>
          "error" in output
            ? {
                id: "refused",
                title: "Prints could not make this sound",
                detail: output.error,
                tone: "error",
              }
            : {
                id: output.printId,
                title: "Prints made this sound",
                detail: output.model,
                open: { params: [{ key: "print", value: output.printId }] },
              },
      },
      handler: async (input, context, caller) => {
        if (caller.computerId === null || caller.actor.kind === "team-key")
          return refusal("not_granted");
        const requestId =
          input.requestId ??
          (caller.idempotencyKey === undefined
            ? undefined
            : await requestIdForCaller("generateSound", caller.idempotencyKey));
        if (requestId === undefined)
          return methodRefusalSchema.parse({ error: "invalid" });
        const command = mediaAudioBindingInputSchema.parse({
          kind: "audio",
          ...generateSoundCommandSchema.parse({ ...input, requestId }),
          libraryPath:
            selectedLibrary(context, caller.computerId) ??
            defaultMediaLibraryPath,
        });
        try {
          validateMediaGenerationSelection(command.settings);
        } catch (cause) {
          if (!(cause instanceof MediaSettingsError)) throw cause;
          return methodRefusalSchema.parse({
            error: "INVALID_ARGUMENT",
            message: cause.message,
            stage: "settings",
            retryable: false,
          });
        }
        const actor: MethodActor =
          caller.actor.kind === "agent"
            ? { kind: "agent", id: caller.actor.agentId }
            : { kind: "member", id: caller.actor.memberId };
        const remembered = rememberMethodGeneration(
          context.ctx.storage,
          actor,
          caller.computerId,
          command,
        );
        if ("error" in remembered) return refusal("conflict");
        const reply = await bindingCall(() =>
          context.env.MEDIA.generate(command),
        );
        const refused = methodRefusalSchema.safeParse(reply);
        if (refused.success) return presentRefusal(refused.data);
        const working = pendingSchema.safeParse(reply);
        if (working.success) return pending(working.data.retryAfterMs);
        const result = generatedAudioSchema.parse(reply);
        const completed = completeMethodGeneration(
          context.ctx.storage,
          actor,
          caller.computerId,
          command,
          result,
          typedOf(input.settings, undefined),
        );
        if ("error" in completed) return refusal("conflict");
        context.ctx.storage.sql.exec(
          "INSERT OR IGNORE INTO media_library_folders(computer_id,path) VALUES (?,?)",
          caller.computerId,
          command.libraryPath,
        );
        return {
          ...generatedAudioSchema.parse(completed.result),
          printId: command.requestId,
        };
      },
    }),
    generateImage: defineAppMethod({
      description:
        "One image. Call listModels, listCharacters and listStyles first; prefer default. Input {requestId,characters,style,settings:{model,prompt,width,height,steps?,references?}}. steps: omit for fixed models; obey input.maxSteps. References {computerId?,path}: ANY attached Computer with its own read grant; omit computerId for selected. @imageN = Nth ref. characters/style compose the prompt. priceEstimate is an estimate for stated settings, not the charge. requestId: media_request_ + 21 random [a-z0-9]; reuse for recovery. For up to 8 panels, await one call per panel in ONE execute, distinct ids, same characters/style. On attachment_budget_exceeded wait retryAfterMs, reuse id. Never retry retryable:false (AI Gateway credits). Return results in panel order, printId, receipt, summed costMilliunits; if env.computers exists, files.read destination.path first. Never fetch image bytes.",
      effect: "write",
      requires: ["media.generation", "computer.writeFile"],
      input: generateImageInputSchema,
      output: z.union([
        generatedImageSchema.extend({
          printId: id,
          receipt: z
            .string()
            .min(1)
            .max(4608)
            .describe(
              "Receipt for the saved image, including Media's admitted charge.",
            ),
        }),
        methodRefusalSchema,
      ]),
      present: {
        rows: resultRows,
        verb: "made",
        row: ({ output }) =>
          "error" in output
            ? {
                id: "refused",
                title: "Prints could not make this panel",
                detail: output.error,
                tone: "error",
              }
            : {
                id: output.printId,
                title: "Prints made this panel",
                detail: `${output.model} · ${String(output.width)}×${String(output.height)}`,
                media: { path: output.destination.path, format: "fungi:image" },
                open: { params: [{ key: "print", value: output.printId }] },
              },
      },
      handler: async (input, context, caller) => {
        if (caller.computerId === null || caller.actor.kind === "team-key")
          return refusal("not_granted");
        const requestId =
          input.requestId ??
          (caller.idempotencyKey === undefined
            ? undefined
            : await requestIdForCaller("generateImage", caller.idempotencyKey));
        if (requestId === undefined)
          return methodRefusalSchema.parse({ error: "invalid" });
        const {
          folder,
          style,
          characters: characterNames,
          ...imageInput
        } = input;
        const library =
          selectedLibrary(context, caller.computerId) ??
          defaultMediaLibraryPath;
        const composed = composeGeneration(
          context.ctx.storage.sql,
          caller.computerId,
          { style, characters: characterNames },
          imageInput.settings,
        );
        if ("refusal" in composed) return composed.refusal;
        const command = mediaImageBindingInputSchema.parse({
          kind: "image",
          ...generateImageCommandSchema.parse({
            ...imageInput,
            settings: composed.settings,
            requestId,
          }),
          libraryPath: joinFolder(library, folder),
        });
        try {
          validateMediaGenerationSelection(command.settings);
        } catch (cause) {
          if (!(cause instanceof MediaSettingsError)) throw cause;
          return methodRefusalSchema.parse({
            error: "INVALID_ARGUMENT",
            message: cause.message,
            stage: "settings",
            retryable: false,
          });
        }
        const actor: MethodActor =
          caller.actor.kind === "agent"
            ? { kind: "agent", id: caller.actor.agentId }
            : { kind: "member", id: caller.actor.memberId };
        const remembered = rememberMethodGeneration(
          context.ctx.storage,
          actor,
          caller.computerId,
          command,
        );
        if ("error" in remembered) return refusal("conflict");
        // Always re-enter Media admission on replay; it owns provider/Billing idempotency.
        const reply = await bindingCall(() =>
          context.env.MEDIA.generate(command),
        );
        const refused = methodRefusalSchema.safeParse(reply);
        if (refused.success) return presentRefusal(refused.data);
        const result = generatedImageSchema.parse(reply);
        const completed = completeMethodGeneration(
          context.ctx.storage,
          actor,
          caller.computerId,
          command,
          result,
          typedOf(imageInput.settings, characterNames),
        );
        if ("error" in completed) return refusal("conflict");
        if (style !== undefined)
          recordPrintStyle(context.ctx.storage.sql, command.requestId, style);
        recordPrintCharacters(
          context.ctx.storage.sql,
          command.requestId,
          composed.characters,
        );
        context.ctx.storage.sql.exec(
          "INSERT OR IGNORE INTO media_library_folders(computer_id,path) VALUES (?,?)",
          caller.computerId,
          library,
        );
        return {
          ...generatedImageSchema.parse(completed.result),
          printId: command.requestId,
          receipt: imageReceipt(generatedImageSchema.parse(completed.result)),
        };
      },
    }),
  },
});
