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
  mediaImageBindingInputSchema,
  mediaVideoBindingInputSchema,
} from "@fungi.computer/darkroom/media-binding";
import { defaultMediaLibraryPath } from "../library-folder.js";
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
  generateImageInputSchema,
  generateImageCommandSchema,
  generatedImageSchema,
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
  indexedOutput,
  indexedOutputAtPath,
  indexedOutputs,
  printReferences,
  printTyped,
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
  method: "generateImage" | "generateVideo",
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
    }>;
  }>;
}>;
const refusal = (
  error: "not_granted" | "unavailable" | "conflict" | "not_found",
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

export const appBackend = defineAppBackend<PrintsMethodContext>({
  gills: [recentOutputsGill],
  methods: {
    listModels: defineAppMethod({
      description:
        "List image and video models available through this App's admitted Media access.",
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
        "List this App's recorded outputs in its selected library on the admitted Computer, newest first. A file may have been removed since recording.",
      effect: "read",
      requires: ["computer.list"],
      input: outputPageInputSchema,
      output: z.union([outputPageSchema, methodRefusalSchema]),
      handler: (input, context, caller) => {
        if (caller.computerId === null) return refusal("not_granted");
        const selected = selectedLibrary(context, caller.computerId);
        if (selected === null) return missingLibrary();
        return outputPageSchema.parse(
          indexedOutputs(
            context.ctx.storage.sql,
            caller.computerId,
            selected,
            input.after ?? null,
            input.limit,
          ),
        );
      },
    }),
    getOutput: defineAppMethod({
      description:
        "Read one recorded output by its file path in the selected library on the admitted Computer: its prompt, model, the reference images it was generated from, the saved characters it used (characters) and the saved style it used (style, null when none). To remake or vary it, pass the same characters and style to generateImage with a new prompt.",
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
        "Read at most 128 KiB of an indexed output in the selected library on the admitted Computer as base64. Use byteOffset to read the next chunk.",
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
        "Generate one short MP4 in this App's library with a video model from listModels. Resolution, aspect, duration, audio and path-only frame references follow that model's catalog. The host chooses the Computer path. Workflows may omit requestId to derive it from the trusted caller key; otherwise use media_request_ followed by 21 random lowercase letters or digits. Pending means retry the same inputs and key after retryAfterMs. Existing billing and attachment budgets apply; the Workflow owns human review.",
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
        const { style, characters: characterNames, ...videoInput } = input;
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
          libraryPath:
            selectedLibrary(context, caller.computerId) ??
            defaultMediaLibraryPath,
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
          command.libraryPath,
        );
        return {
          ...generatedVideoSchema.parse(completed.result),
          printId: command.requestId,
        };
      },
    }),
    generateImage: defineAppMethod({
      description:
        "One image. Call listModels, listCharacters and listStyles first; prefer default. Input {requestId,characters,style,settings:{model,prompt,width,height,steps?,references?}}. steps: omit for fixed models; obey input.maxSteps. References {computerId?,path}: ANY attached Computer with its own read grant; omit computerId for selected. characters/style compose the prompt. priceEstimate is an estimate for stated settings, not the charge. requestId: media_request_ + 21 random [a-z0-9]; reuse for recovery. For up to 8 panels, await one call per panel in ONE execute, distinct ids, same characters/style. On attachment_budget_exceeded wait retryAfterMs, reuse id. Never retry retryable:false (AI Gateway credits). Return results in panel order, printId, receipt, summed costMilliunits; if env.computers exists, files.read destination.path first. Never fetch image bytes.",
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
        const { style, characters: characterNames, ...imageInput } = input;
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
          command.libraryPath,
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
