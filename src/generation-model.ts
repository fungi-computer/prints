import {
  describeAppError,
  type ErrorDescription,
} from "@fungi.computer/agar/errors";
import type {
  MediaGenerationInput,
  MediaGenerationResult,
  MediaGenerationSession,
} from "@fungi.computer/agar";
import { Result, Schema, SchemaIssue } from "effect";
import { words } from "@fungi.computer/cairn";

export type MediaModel = MediaGenerationSession["models"][number];
export type MediaReference = NonNullable<
  MediaGenerationInput["settings"]["references"]
>[number];

export const DEFAULT_MODEL_ID = "@cf/black-forest-labs/flux-2-klein-4b";
export const GENERATION_UNAVAILABLE_REASON =
  "Image creation is unavailable for this Computer right now.";

export const SIZE_PRESETS = {
  landscape: { height: 768, width: 1024 },
  portrait: { height: 1024, width: 768 },
  square: { height: 1024, width: 1024 },
} as const;
export const SIZE_MODES = ["landscape", "portrait", "square"] as const;

export type SizeMode = keyof typeof SIZE_PRESETS | "custom";

export type GenerationDraft = {
  destination?: string;
  height: number;
  model: string;
  prompt: string;
  references: readonly MediaReference[];
  steps?: number;
  /** Video models only: clip length in seconds. */
  durationSeconds?: number;
  width: number;
};

export type GenerationRecord = Readonly<{
  input: MediaGenerationInput;
  result: MediaGenerationResult;
}>;

type GenerationSettingsDraft = {
  height: number;
  model: string;
  prompt: string;
  references?: readonly MediaReference[];
  steps?: number;
  durationSeconds?: number;
  width: number;
};

export type GenerationState =
  | Readonly<{ kind: "unavailable"; reason: string }>
  | Readonly<{ kind: "loading" }>
  | Readonly<{ kind: "ready" }>
  | Readonly<{ draft: GenerationDraft; kind: "pending" }>
  | Readonly<{ kind: "completed"; record: GenerationRecord }>
  | Readonly<{
      kind: "error";
      message: string;
      action?: ErrorDescription["action"];
    }>;

/** Prints retains its own recovery copy while F5 owns the typed action. */
export function describeGenerationError(cause: unknown): ErrorDescription {
  return describeAppError(cause, {
    INSUFFICIENT_CREDIT: {
      title: "Couldn’t create image",
      message:
        "Media generation needs Team credits. Add credits in Billing, then retry.",
    },
  });
}

export function defaultGenerationDraft(): GenerationDraft {
  return {
    destination: undefined,
    height: 768,
    model: DEFAULT_MODEL_ID,
    prompt: "",
    references: [],
    steps: undefined,
    width: 1024,
  };
}

/** Format one collision-resistant destination per submission.
 *
 * The caller mints the token once before creating the durable attempt, so a
 * retry retains the captured input while a later window/reload cannot reuse
 * this file path.
 */
export function generatedMediaPath(
  token: string,
  directory: string,
  extension: "png" | "jpg" | "webp" | "mp4" = "png",
): string {
  if (token.trim().length === 0)
    throw new Error("Media generation token must not be empty.");
  const basename = token.trim();
  if (!/^[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)*$/.test(basename))
    throw new Error("Media generation basename contains invalid characters.");
  return `${directory.replace(/\/$/, "")}/generated-${basename}.${extension}`;
}

/** Resolve the destination once at operation admission. An omitted destination
 * gets a readable Cairn candidate; an explicit path is passed through intact.
 * The resolved value belongs to the durable attempt and therefore survives a
 * retry without minting another basename or probing for collisions. */
export function generationDestinationFor(
  draft: GenerationDraft,
  directory: string,
  model?: MediaModel,
): string {
  const explicit = draft.destination?.trim();
  if (explicit) return explicit;
  const format = model?.outputFormats.includes("png")
    ? "png"
    : (model?.outputFormats[0] ?? "png");
  const extension =
    model?.kind === "video" ? "mp4" : format === "jpeg" ? "jpg" : format;
  return generatedMediaPath(words({ count: 4 }), directory, extension);
}

export function sizeModeFor(width: number, height: number): SizeMode {
  for (const mode of SIZE_MODES) {
    const preset = SIZE_PRESETS[mode];
    if (preset.width === width && preset.height === height) return mode;
  }
  return "custom";
}

/** The send action names what the selected model makes. */
export function generateActionLabel(model: MediaModel | undefined): string {
  return model?.kind === "video" ? "Generate video" : "Generate image";
}

/** One size the composer offers: a catalog size or a generic preset. */
export type SizeChoice = Readonly<{
  value: string;
  label: string;
  width: number;
  height: number;
}>;

/** A model with catalog sizes offers exactly those; others get the presets. */
export function sizeChoicesFor(
  model: MediaModel | undefined,
): readonly SizeChoice[] {
  if (model !== undefined && model.sizes !== null)
    return model.sizes.flatMap((size) => {
      const match = /^(\d+)x(\d+)$/u.exec(size);
      if (match === null) return [];
      const width = Number(match[1]);
      const height = Number(match[2]);
      return [
        {
          value: size,
          label: `${String(width)} × ${String(height)}`,
          width,
          height,
        },
      ];
    });
  return SIZE_MODES.map((mode) => ({
    value: mode,
    label: `${String(SIZE_PRESETS[mode].width)} × ${String(SIZE_PRESETS[mode].height)}`,
    ...SIZE_PRESETS[mode],
  }));
}

/** Keep the chosen size when the next model accepts it; otherwise use its default. */
export function sizeForModel(
  draft: Readonly<{ width: number; height: number }>,
  model: MediaModel,
): { width: number; height: number } {
  const accepted =
    model.input.dimensions !== "none" &&
    Result.isSuccess(
      Schema.decodeUnknownResult(generationParametersSchema(() => model))({
        model: model.id,
        width: draft.width,
        height: draft.height,
      }),
    );
  return accepted
    ? { width: draft.width, height: draft.height }
    : { width: model.input.defaultWidth, height: model.input.defaultHeight };
}

export function modelFor(
  models: readonly MediaModel[],
  id: string,
): MediaModel | undefined {
  return models.find((model) => model.id === id);
}

export function draftForModel(
  draft: GenerationDraft,
  model: MediaModel,
): GenerationDraft {
  return {
    ...draft,
    height: model.input.defaultHeight,
    model: model.id,
    steps:
      model.input.steps === "fixed"
        ? undefined
        : (model.input.defaultSteps ?? undefined),
    durationSeconds: model.video?.defaultSeconds,
    width: model.input.defaultWidth,
  };
}

export function generationInputFor(
  draft: GenerationDraft,
): MediaGenerationInput {
  const settings: GenerationSettingsDraft = {
    height: draft.height,
    model: draft.model,
    prompt: draft.prompt.trim(),
    width: draft.width,
  };
  if (draft.steps !== undefined) settings.steps = draft.steps;
  if (draft.durationSeconds !== undefined)
    settings.durationSeconds = draft.durationSeconds;
  if (draft.references.length > 0) settings.references = draft.references;
  return {
    destination: {
      path: draft.destination?.trim() ?? "",
    },
    settings,
  };
}

/** Model-owned numeric constraints used by the composer's submission check. */
export function generationParametersSchema(
  resolveModel: (id: string) => MediaModel | undefined,
) {
  return Schema.Struct({
    model: Schema.String,
    width: Schema.Number,
    height: Schema.Number,
    durationSeconds: Schema.optionalKey(Schema.UndefinedOr(Schema.Number)),
    steps: Schema.optionalKey(Schema.UndefinedOr(Schema.Number)),
  }).check(
    Schema.makeFilter((draft) => {
      const model = resolveModel(draft.model);
      if (!Number.isSafeInteger(draft.width) || draft.width < 1)
        return { path: ["width"], issue: "Width must be a positive integer." };
      if (!Number.isSafeInteger(draft.height) || draft.height < 1)
        return {
          path: ["height"],
          issue: "Height must be a positive integer.",
        };
      if (model === undefined) return undefined;
      if (model.input.dimensions === "own") {
        const maximum = model.input.maxDimension ?? 4096;
        if (draft.width < 256 || draft.height < 256)
          return {
            path: [draft.width < 256 ? "width" : "height"],
            issue: `${model.label} requires dimensions of at least 256 × 256.`,
          };
        if (draft.width > maximum || draft.height > maximum)
          return {
            path: [draft.width > maximum ? "width" : "height"],
            issue: `${model.label} accepts dimensions up to ${String(maximum)}.`,
          };
      }
      if (
        model.sizes !== null &&
        !model.sizes.includes(`${String(draft.width)}x${String(draft.height)}`)
      )
        return {
          path: ["width"],
          issue: `${model.label} accepts only these sizes: ${model.sizes.join(", ")}.`,
        };
      if (
        model.video !== null &&
        draft.durationSeconds !== undefined &&
        (!Number.isSafeInteger(draft.durationSeconds) ||
          draft.durationSeconds < model.video.minSeconds ||
          draft.durationSeconds > model.video.maxSeconds)
      )
        return {
          path: ["durationSeconds"],
          issue: `${model.label} makes clips from ${String(model.video.minSeconds)} to ${String(model.video.maxSeconds)} seconds.`,
        };
      if (model.input.steps === "fixed" && draft.steps !== undefined)
        return { path: ["steps"], issue: `${model.label} uses fixed steps.` };
      if (
        draft.steps !== undefined &&
        (!Number.isSafeInteger(draft.steps) ||
          draft.steps < 1 ||
          (model.input.maxSteps !== null && draft.steps > model.input.maxSteps))
      )
        return {
          path: ["steps"],
          issue: `${model.label} accepts at most ${String(model.input.maxSteps ?? "the provider limit")} steps.`,
        };
      return undefined;
    }),
  );
}

export function validationMessage(
  draft: GenerationDraft,
  model: MediaModel | undefined,
): string | undefined {
  if (draft.destination?.trim().length === 0)
    return "A destination file path is required.";
  if (draft.prompt.trim().length === 0)
    return "Describe the image to generate.";
  if (model === undefined) return "Choose a model from the granted registry.";
  const parameters = Schema.decodeUnknownResult(
    generationParametersSchema(() => model),
  )(draft);
  if (Result.isFailure(parameters))
    return SchemaIssue.makeFormatterStandardSchemaV1()(parameters.failure.issue)
      .issues.map((issue) => issue.message)
      .join(" ");
  if (draft.references.length > model.input.maxReferences)
    return `${model.label} accepts at most ${String(model.input.maxReferences)} reference images.`;
  if (draft.references.length > 0 && model.input.referenceField === null)
    return `${model.label} does not accept reference images.`;
  return undefined;
}
