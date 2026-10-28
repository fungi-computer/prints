import {
  describeAppError,
  type ErrorDescription,
} from "@fungi.computer/agar/errors";
import { MediaGenerationError } from "@fungi.computer/agar/media";
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
  /** Name of the saved style block that leads the prompt; absent for none. */
  style?: string;
  /** Video models only: clip length in seconds. */
  durationSeconds?: number;
  /** Video models only: audio on or off; absent leaves the provider's default. */
  generateAudio?: boolean;
  width: number;
};

export type GenerationRecord = Readonly<{
  input: MediaGenerationInput;
  result: MediaGenerationResult;
}>;

type GenerationSettingsDraft = {
  -readonly [
    Key in keyof MediaGenerationInput["settings"]
  ]: MediaGenerationInput["settings"][Key];
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
      /** False when the same request cannot succeed again; absent for local validation. */
      retryable?: boolean;
    }>;

/** Prints retains its own recovery copy while F5 owns the typed action. */
/**
 * AI Gateway's refusal when the Cloudflare account has no Unified Billing
 * credits. Partner models (Seedance, Veo, MiniMax, GPT Image) are billed
 * through those credits, so every Prints video model depends on them.
 */
const AI_GATEWAY_INSUFFICIENT_CREDITS = 2021;

function needsGatewayCredits(cause: unknown): boolean {
  return (
    cause instanceof MediaGenerationError &&
    cause.stage === "provider" &&
    cause.provider !== undefined &&
    "code" in cause.provider &&
    cause.provider.code === AI_GATEWAY_INSUFFICIENT_CREDITS
  );
}

export function describeGenerationError(cause: unknown): ErrorDescription {
  if (needsGatewayCredits(cause))
    return {
      title: "Out of AI Gateway credits",
      message:
        "This model is paid with Cloudflare AI Gateway credits, and the account has none left. Add credits in the Cloudflare dashboard under AI Gateway, or choose a Workers AI model such as Flux. Nothing was charged.",
      retryable: false,
    };
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

/** Missing registry metadata must not relabel a restored attempt as an image. */
export function generationPendingLabel(model: MediaModel | undefined): string {
  if (model === undefined) return "Creating media…";
  return model.kind === "video" ? "Creating video…" : "Creating image…";
}

/** One size the composer offers: a catalog size or a generic preset. */
export type SizeChoice = Readonly<{
  value: string;
  label: string;
  width: number;
  height: number;
}>;

const greatestCommonDivisor = (a: number, b: number): number =>
  b === 0 ? a : greatestCommonDivisor(b, a % b);

/** Pixel size with its reduced aspect ratio, e.g. "1536 × 1024 · 3:2". */
const sizeLabel = (
  width: number,
  height: number,
  ratio?: readonly [number, number],
): string => {
  if (ratio !== undefined)
    return `${String(width)} × ${String(height)} · ${String(ratio[0])}:${String(ratio[1])}`;
  const divisor = greatestCommonDivisor(width, height);
  return `${String(width)} × ${String(height)} · ${String(width / divisor)}:${String(height / divisor)}`;
};

const WIDESCREEN_RATIOS = [
  [16, 9],
  [21, 9],
] as const;
const PIXEL_MULTIPLE = 16;

/**
 * Widescreen presets for a model whose provider documents its maximum
 * dimension: the largest width (a multiple of 16, within that maximum) with
 * the height rounded to the nearest multiple of 16.
 */
function widescreenChoices(model: MediaModel): readonly SizeChoice[] {
  const maximum = model.input.maxDimension;
  if (
    model.kind !== "image" ||
    model.input.dimensions !== "own" ||
    !model.input.maxDimensionDocumented ||
    maximum === null
  )
    return [];
  const width = Math.floor(maximum / PIXEL_MULTIPLE) * PIXEL_MULTIPLE;
  return WIDESCREEN_RATIOS.map(([w, h]) => {
    const height =
      Math.round((width * h) / w / PIXEL_MULTIPLE) * PIXEL_MULTIPLE;
    return {
      value: `${String(width)}x${String(height)}`,
      label: sizeLabel(width, height, [w, h]),
      width,
      height,
    };
  });
}

/**
 * The size in a few characters for the settings readout: a video's catalog
 * format ("720p 16:9"), an image's reduced ratio ("3:2"), or its pixels when
 * the ratio has no short name. Provider-sized models show nothing.
 */
export function shortSizeLabel(
  model: MediaModel | undefined,
  width: number,
  height: number,
): string | null {
  if (model?.input.dimensions === "none") return null;
  const format = model?.video?.formats.find(
    (entry) => entry.width === width && entry.height === height,
  );
  if (format !== undefined) return `${format.resolution} ${format.aspectRatio}`;
  const divisor = greatestCommonDivisor(width, height);
  const across = width / divisor;
  const down = height / divisor;
  return across <= 21 && down <= 21
    ? `${String(across)}:${String(down)}`
    : `${String(width)} × ${String(height)}`;
}

/** Videos name catalog formats; sized images keep their sizes, others get presets. */
export function sizeChoicesFor(
  model: MediaModel | undefined,
): readonly SizeChoice[] {
  if (model?.video !== undefined && model.video !== null)
    return model.video.formats.map((format) => ({
      value: `${String(format.width)}x${String(format.height)}`,
      label: `${format.resolution} · ${format.aspectRatio} · ${String(format.width)} × ${String(format.height)}`,
      width: format.width,
      height: format.height,
    }));
  if (model !== undefined && model.sizes !== null)
    return model.sizes.flatMap((size) => {
      const match = /^(\d+)x(\d+)$/u.exec(size);
      if (match === null) return [];
      const width = Number(match[1]);
      const height = Number(match[2]);
      return [
        {
          value: size,
          label: sizeLabel(width, height),
          width,
          height,
        },
      ];
    });
  return [
    ...SIZE_MODES.map((mode) => ({
      value: mode,
      label: sizeLabel(SIZE_PRESETS[mode].width, SIZE_PRESETS[mode].height),
      ...SIZE_PRESETS[mode],
    })),
    ...(model === undefined ? [] : widescreenChoices(model)),
  ];
}

/** Preserve video dimensions across model changes; refused sizes need an explicit choice. */
export function sizeForModel(
  draft: Readonly<{ width: number; height: number }>,
  model: MediaModel,
  previousModel: MediaModel | undefined,
) {
  if (previousModel?.kind === "video" && model.kind === "video")
    return { width: draft.width, height: draft.height };
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

/** The catalog's display name, without the label's description. */
export function modelName(model: Pick<MediaModel, "label">): string {
  return model.label.split(" — ")[0] ?? model.label;
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
    generateAudio: model.video?.defaultGenerateAudio ?? undefined,
    width: model.input.defaultWidth,
  };
}

export type ReferenceRole = NonNullable<MediaReference["role"]>;

/** What the composer calls each video reference role. */
export const REFERENCE_ROLE_LABELS = {
  "first-frame": "First frame",
  "last-frame": "Last frame",
  reference: "Reference",
} as const satisfies Record<ReferenceRole, string>;

/**
 * The role a tap on a reference's tag moves it to: the next documented role
 * that no other reference holds (any number may be plain references).
 */
export function nextReferenceRole(
  roles: readonly ReferenceRole[],
  references: readonly MediaReference[],
  at: number,
): ReferenceRole | undefined {
  const current = references[at]?.role;
  const after = current === undefined ? 0 : roles.indexOf(current) + 1;
  // Walk the roles once, starting after the current one.
  return [...roles.slice(after), ...roles.slice(0, after)].find(
    (role) =>
      role !== current &&
      (role === "reference" ||
        !references.some(
          (other, index) => index !== at && other.role === role,
        )),
  );
}

/** The roles the model documents, or none for an image model. */
export function referenceRolesFor(
  model: MediaModel | undefined,
): readonly ReferenceRole[] {
  return model?.video?.referenceRoles ?? [];
}

/**
 * Give every reference the role it will be sent with. A role the person chose
 * and the model documents is kept; the rest are filled in so the set is valid
 * whenever it can be: first frame, then last frame where the model has one,
 * else references. Image models take no roles.
 */
export function resolveReferenceRoles(
  references: readonly MediaReference[],
  model: MediaModel | undefined,
): readonly MediaReference[] {
  const supported = referenceRolesFor(model);
  if (model?.video == null)
    return references.map((reference) => ({ path: reference.path }));
  const chosen = references.map((reference) =>
    reference.role !== undefined && supported.includes(reference.role)
      ? reference.role
      : undefined,
  );
  const has = (role: ReferenceRole) => chosen.includes(role);
  const lastFrame = supported.includes("last-frame");
  // More images than frames can hold are references.
  const asReferences =
    has("reference") ||
    (!has("first-frame") &&
      !has("last-frame") &&
      references.length > (lastFrame ? 2 : 1));
  return references.map((reference, index) => {
    let role = chosen[index];
    if (role === undefined) {
      if (asReferences && supported.includes("reference")) role = "reference";
      else if (!has("first-frame") && supported.includes("first-frame"))
        role = "first-frame";
      else if (lastFrame && !has("last-frame")) role = "last-frame";
      else role = supported.includes("reference") ? "reference" : "first-frame";
      chosen[index] = role;
    }
    return { path: reference.path, role };
  });
}

/** Why these resolved references cannot be one video request, in plain words. */
export function referenceRoleMessage(
  references: readonly MediaReference[],
  model: MediaModel,
  resolution?: string,
): string | undefined {
  const video = model.video;
  if (video === null || references.length === 0) return undefined;
  const count = (role: ReferenceRole) =>
    references.filter((reference) => reference.role === role).length;
  const first = count("first-frame");
  const last = count("last-frame");
  const refs = count("reference");
  if (first > 1 || last > 1)
    return video.referenceRoles.includes("last-frame")
      ? `${model.label} takes one first frame and one last frame.`
      : `${model.label} takes one first frame.`;
  if (last > 0 && first === 0)
    return "A last frame needs a first frame as well.";
  if (refs > 0 && first + last > 0)
    return "Frames and references cannot be mixed. Use a first and last frame, or references.";
  if (refs > video.maxReferenceImages)
    return video.maxReferenceImages === 0
      ? `${model.label} takes no reference images.`
      : `${model.label} takes up to ${String(video.maxReferenceImages)} reference images.`;
  if (
    refs > 0 &&
    resolution !== undefined &&
    !video.referenceResolutions.some((allowed) => allowed === resolution)
  )
    return `${model.label} takes reference images only at ${video.referenceResolutions.join(", ")}.`;
  return undefined;
}

export function generationInputFor(
  draft: GenerationDraft,
  model: MediaModel,
): MediaGenerationInput {
  const format = model.video?.formats.find(
    (candidate) =>
      candidate.width === draft.width && candidate.height === draft.height,
  );
  if (model.kind === "video" && format === undefined)
    throw new Error("Choose a supported video resolution and aspect ratio.");
  const settings: GenerationSettingsDraft = {
    height: draft.height,
    model: draft.model,
    prompt: draft.prompt.trim(),
    width: draft.width,
  };
  if (format !== undefined) {
    settings.resolution = format.resolution;
    settings.aspectRatio = format.aspectRatio;
  }
  if (draft.steps !== undefined) settings.steps = draft.steps;
  if (draft.durationSeconds !== undefined)
    settings.durationSeconds = draft.durationSeconds;
  if (draft.references.length > 0)
    settings.references = resolveReferenceRoles(draft.references, model);
  if (model.video?.supportsAudio === true && draft.generateAudio !== undefined)
    settings.generateAudio = draft.generateAudio;
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

/** How far a trimmed prompt exceeds the model's limit, or null when it fits. */
function promptOverflow(
  prompt: string,
  model: Pick<MediaModel, "maxPromptLength">,
): { length: number; excess: number } | null {
  const length = prompt.trim().length;
  return length > model.maxPromptLength
    ? { length, excess: length - model.maxPromptLength }
    : null;
}

export function validationMessage(
  draft: GenerationDraft,
  model: MediaModel | undefined,
): string | undefined {
  if (draft.destination?.trim().length === 0)
    return "A destination file path is required.";
  if (draft.prompt.trim().length === 0)
    return model?.kind === "video"
      ? "Describe the video to generate."
      : "Describe the image to generate.";
  if (model === undefined) return "Choose a model from the granted registry.";
  const over = promptOverflow(draft.prompt, model);
  if (over !== null)
    return `${model.label} accepts prompts up to ${String(model.maxPromptLength)} characters; this one is ${String(over.length)}. Shorten it by ${String(over.excess)}.`;
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
  if (model.video !== null) {
    const format = model.video.formats.find(
      (candidate) =>
        candidate.width === draft.width && candidate.height === draft.height,
    );
    return referenceRoleMessage(
      resolveReferenceRoles(draft.references, model),
      model,
      format?.resolution,
    );
  }
  return undefined;
}
