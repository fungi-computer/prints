import { resultRows } from "@fungi.computer/agar/method-presentation";
import { recentOutputsGill } from "./gills.js";
import { outputPageInputSchema, outputPageSchema } from "./output-page.js";
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
  validateMediaGenerationSelection,
  mediaModelSchema,
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
import { indexedOutput, indexedOutputs } from "./print-records.js";

const empty = z.strictObject({});
const id = z.string().min(1).max(256);
const path = z.string().startsWith("/").min(2).max(4096);
const catalogModel = mediaModelSchema.unwrap();
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
    MEDIA?: Readonly<{
      models?(input: Record<string, never>): Promise<WhistleJsonValue>;
      generate?(
        input: z.output<typeof generationCommandSchema>,
      ): Promise<WhistleJsonValue>;
    }>;
    COMPUTER?: Readonly<{
      list?(input: {
        path: string;
        limit: number;
        offset: number;
      }): Promise<WhistleJsonValue>;
      read?(input: {
        path: string;
        byteOffset: number;
        byteLength: number;
      }): Promise<WhistleJsonValue>;
    }>;
  }>;
}>;
const refusal = (
  error: "not_granted" | "unavailable" | "conflict" | "not_found",
) => methodRefusalSchema.parse({ error });

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
        if (!context.env.MEDIA?.models) return refusal("not_granted");
        const reply = await context.env.MEDIA.models(input);
        const refused = methodRefusalSchema.safeParse(reply);
        return refused.success ? refused.data : models.parse({ models: reply });
      },
    }),
    listOutputs: defineAppMethod({
      description:
        "List this App's recorded outputs in its selected library on the admitted Computer, newest first. A file may have been removed since recording.",
      effect: "read",
      requires: ["computer.list"],
      input: outputPageInputSchema,
      output: z.union([outputPageSchema, methodRefusalSchema]),
      handler: (input, context, caller) => {
        if (!context.env.COMPUTER?.list || caller.computerId === null)
          return refusal("not_granted");
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
        if (!context.env.COMPUTER?.read || caller.computerId === null)
          return refusal("not_granted");
        const selected = selectedLibrary(context, caller.computerId);
        if (selected === null) return missingLibrary();
        const item = indexedOutput(
          context.ctx.storage.sql,
          caller.computerId,
          input.printId,
          selected,
        );
        if (!item) return refusal("not_found");
        const reply = await context.env.COMPUTER.read({
          path: item.path,
          byteOffset: input.byteOffset,
          byteLength: input.byteLength,
        });
        const refused = methodRefusalSchema.safeParse(reply);
        if (refused.success) return refused.data;
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
        if (
          !context.env.MEDIA?.generate ||
          caller.computerId === null ||
          caller.actor.kind === "team-key"
        )
          return refusal("not_granted");
        const requestId =
          input.requestId ??
          (caller.idempotencyKey === undefined
            ? undefined
            : await requestIdForCaller("generateVideo", caller.idempotencyKey));
        if (requestId === undefined)
          return methodRefusalSchema.parse({ error: "invalid" });
        const command = mediaVideoBindingInputSchema.parse({
          kind: "video",
          ...generateVideoCommandSchema.parse({ ...input, requestId }),
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
        const reply = await context.env.MEDIA.generate(command);
        const refused = methodRefusalSchema.safeParse(reply);
        if (refused.success) return refused.data;
        const working = pendingSchema.safeParse(reply);
        if (working.success) return pending(working.data.retryAfterMs);
        const result = generatedVideoSchema.parse(reply);
        const completed = completeMethodGeneration(
          context.ctx.storage,
          actor,
          caller.computerId,
          command,
          result,
        );
        if ("error" in completed) return refusal("conflict");
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
        "Generate one image in this App's library. The host chooses the path. Workflows may omit requestId to derive it from the trusted caller's idempotency key. Other callers form requestId as media_request_ followed by 21 random lowercase letters or digits. Reuse the same identity and inputs for recovery. The default is the model-native image format; PNG, JPEG or WebP may be pinned only when the model supports it. The result reports the actual format. Optional settings.references contains path-only image references on the admitted Computer. Select a model from listModels whose input.maxReferences supports their count; unsupported references return INVALID_ARGUMENT at stage settings before recording or dispatch. No video settings. Existing Team billing and attachment budgets apply.",
      effect: "write",
      requires: ["media.generation", "computer.writeFile"],
      input: generateImageInputSchema,
      output: z.union([
        generatedImageSchema.extend({ printId: id }),
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
        if (
          !context.env.MEDIA?.generate ||
          caller.computerId === null ||
          caller.actor.kind === "team-key"
        )
          return refusal("not_granted");
        const requestId =
          input.requestId ??
          (caller.idempotencyKey === undefined
            ? undefined
            : await requestIdForCaller("generateImage", caller.idempotencyKey));
        if (requestId === undefined)
          return methodRefusalSchema.parse({ error: "invalid" });
        const command = mediaImageBindingInputSchema.parse({
          kind: "image",
          ...generateImageCommandSchema.parse({ ...input, requestId }),
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
        const reply = await context.env.MEDIA.generate(command);
        const refused = methodRefusalSchema.safeParse(reply);
        if (refused.success) return refused.data;
        const result = generatedImageSchema.parse(reply);
        const completed = completeMethodGeneration(
          context.ctx.storage,
          actor,
          caller.computerId,
          command,
          result,
        );
        if ("error" in completed) return refusal("conflict");
        context.ctx.storage.sql.exec(
          "INSERT OR IGNORE INTO media_library_folders(computer_id,path) VALUES (?,?)",
          caller.computerId,
          command.libraryPath,
        );
        return {
          ...generatedImageSchema.parse(completed.result),
          printId: command.requestId,
        };
      },
    }),
  },
});
