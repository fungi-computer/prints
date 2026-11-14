import {
  mediaAudioBindingInputSchema,
  mediaImageBindingInputSchema,
  mediaVideoBindingInputSchema,
  mediaResultSchema,
} from "@fungi.computer/darkroom/media-binding";
import * as z from "zod";
import {
  validateMediaVideoSelection,
  MediaSettingsError,
} from "@fungi.computer/darkroom";
import { mediaRequestIdSchema } from "@fungi.computer/agar/media-request-id";
import { appMediaBrokerFailureSchema } from "@fungi.computer/darkroom/app-media-contracts";
import { isRelativeFolder } from "../src/library-view.js";

const id = z.string().min(1).max(256);
export const methodActorSchema = z.strictObject({
  kind: z.enum(["member", "agent"]),
  id,
});
export type MethodActor = z.output<typeof methodActorSchema>;
export const generateImageCommandSchema = mediaImageBindingInputSchema.omit({
  kind: true,
  libraryPath: true,
});
/** Optional name of a saved style block whose text leads the prompt. */
const styleArgumentSchema = z
  .string()
  .min(1)
  .max(64)
  .describe(
    "Name of a saved Prints style block. Its text is placed before the prompt; the combined prompt must fit the model's limit.",
  );
/** Optional names of saved Prints characters to weave into the prompt. */
const charactersArgumentSchema = z
  .array(z.string().min(1).max(32))
  .max(8)
  .describe(
    "Names of saved Prints characters. Each one's description is added to the prompt and its reference images to the references, counting against the model's reference limit. An unknown name is INVALID_ARGUMENT. The prompt may also mention characters as @name.",
  );
/** A folder inside the chosen destination; absent means the destination itself. */
export const folderArgumentSchema = z
  .string()
  .refine(isRelativeFolder, "A folder inside the library, like Characters/Mira")
  .describe(
    "A folder inside the library, relative to the library folder, like Characters/Mira. Omit it for the library folder itself.",
  );
export const generateImageInputSchema = generateImageCommandSchema.extend({
  folder: folderArgumentSchema.optional(),
  requestId: mediaRequestIdSchema.optional(),
  style: styleArgumentSchema.optional(),
  characters: charactersArgumentSchema.optional(),
});
/** Video grammar comes from Darkroom; defaults/combinations remain host-owned. */
const videoCommandSchema = mediaVideoBindingInputSchema.omit({
  kind: true,
  libraryPath: true,
});
function validateVideoCommand(
  selection: Pick<z.output<typeof videoCommandSchema>, "settings">,
  context: z.RefinementCtx,
) {
  try {
    validateMediaVideoSelection(selection.settings);
  } catch (cause) {
    if (!(cause instanceof MediaSettingsError)) throw cause;
    context.addIssue({ code: "custom", message: cause.message });
  }
}
export const generateVideoCommandSchema =
  videoCommandSchema.superRefine(validateVideoCommand);
export const generateVideoInputSchema = videoCommandSchema
  .extend({
    folder: folderArgumentSchema.optional(),
    requestId: mediaRequestIdSchema.optional(),
    style: styleArgumentSchema.optional(),
    characters: charactersArgumentSchema.optional(),
  })
  .superRefine(validateVideoCommand);
/**
 * Speech or music. Audio takes only a prompt, plus a voice for speech or a
 * length for music, so a style, characters and references do not apply.
 */
export const generateSoundCommandSchema = mediaAudioBindingInputSchema.omit({
  kind: true,
  libraryPath: true,
});
export const generateSoundInputSchema = generateSoundCommandSchema.extend({
  requestId: mediaRequestIdSchema.optional(),
});
/** Prints generates pictures, video and sound. */
export const generationCommandSchema = z.discriminatedUnion("kind", [
  mediaImageBindingInputSchema,
  mediaVideoBindingInputSchema,
  mediaAudioBindingInputSchema,
]);
export type GenerationCommand = z.output<typeof generationCommandSchema>;
export const generatedImageSchema = z.strictObject({
  bytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  costMilliunits: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  destination: z.strictObject({
    computerId: id,
    path: z.string().startsWith("/").min(2).max(4096),
  }),
  format: mediaResultSchema.shape.format.extract([
    "png",
    "jpeg",
    "gif",
    "webp",
  ]),
  height: z.number().int().positive().max(4096),
  width: z.number().int().positive().max(4096),
  model: id,
});
export const generatedVideoSchema = generatedImageSchema.extend({
  format: z.literal("mp4"),
});
/** A saved MP3: audio has no pixel size. */
export const generatedAudioSchema = generatedImageSchema
  .omit({ height: true, width: true })
  .extend({ format: z.literal("mp3") });
export const generatedMediaSchema = z.union([
  generatedImageSchema,
  generatedVideoSchema,
  generatedAudioSchema,
]);
export type GeneratedMedia = z.output<typeof generatedMediaSchema>;
export const methodRefusalSchema = z.union([
  z.strictObject({
    error: z.enum([
      "not_granted",
      "revoked",
      "grantor_lost_authority",
      "unavailable",
      "invalid",
      "too_large",
      "conflict",
      "invalid_path",
      "not_found",
    ]),
  }),
  z.strictObject({
    error: z.literal("library_unavailable"),
    message: z.string().max(4096),
  }),
  z.strictObject({
    error: z.literal("attachment_budget_exceeded"),
    kind: z.enum(["media", "write", "exec"]),
    retryAfterMs: z.number().int().positive().max(86400000),
  }),
  appMediaBrokerFailureSchema,
]);
