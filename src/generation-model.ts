import {
  appErrorCodes,
  describeAppError,
  type ErrorDescription,
} from "@fungi.computer/agar/errors";
import type { GenerationFailure } from "./media-recovery-contract.js";
import { MediaGenerationError } from "@fungi.computer/agar/media";
import type {
  MediaGenerationInput,
  MediaGenerationResult,
  MediaGenerationSession,
} from "@fungi.computer/agar";
import { Result, Schema, SchemaIssue } from "effect";
import { words } from "@fungi.computer/cairn";

export type MediaModel = MediaGenerationSession["models"][number];
import type { MediaReference } from "./reference-mentions.js";

/** An omitted selector means the selected Computer, not a global path. */
export function isReferenceOnComputer(
  reference: MediaReference,
  computerId: string,
): boolean {
  return (
    reference.computerId === undefined || reference.computerId === computerId
  );
}

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
      /** The failed attempt's model kind; null before a model is known. */
      mediaKind: MediaModel["kind"] | null;
      message: string;
      action?: ErrorDescription["action"];
      /** False when the same request cannot succeed again; absent for local validation. */
      retryable?: boolean;
    }>;

function needsGatewayCredits(cause: unknown): cause is MediaGenerationError {
  return (
    cause instanceof MediaGenerationError &&
    cause.stage === "provider" &&
    cause.provider !== undefined &&
    "reason" in cause.provider &&
    cause.provider.reason === "credits_exhausted"
  );
}

/** Prints owns recovery copy; the provider owns classification and F5 the typed action. */
export function describeGenerationError(cause: unknown): ErrorDescription {
  if (needsGatewayCredits(cause))
    return {
      title: "AI Gateway credits unavailable",
      message: `Cloudflare AI Gateway couldn't fund this request. Check the account's credits and billing in the Cloudflare dashboard under AI Gateway, or choose a Workers AI model such as Flux.${
        cause.code === "MEDIA_PROVIDER_FAILURE_UNCHARGED"
          ? " You weren't charged."
          : ""
      }`,
      retryable: false,
    };
  return describeAppError(cause, {
    INSUFFICIENT_CREDIT: {
      title: "Couldn’t create image",
      message:
        "Media generation needs Team credits. Add credits in Billing, then retry.",
    },
    DAILY_LIMIT_REACHED: {
      title: "Couldn’t create image",
      message:
        "Today's spending limit for this Oyster is used up. It resets at 00:00 UTC.",
    },
    // Each cause says what happened and what Retry changes, never a bare "failed".
    MEDIA_PROVIDER_FAILURE: {
      title: "Generation failed",
      message:
        "The model stopped before it finished. Retry, or pick another model.",
    },
    MEDIA_PROVIDER_FAILURE_UNCHARGED: {
      title: "Generation failed",
      message:
        "The model stopped before it finished. You weren’t charged. Retry, or pick another model.",
    },
    SAFETY_FILTER_REFUSED: {
      title: "Generation refused",
      message:
        "The model refused this prompt. Change the prompt or reference image, then retry.",
    },
    TIMEOUT: {
      title: "Still waiting",
      message: "The model didn’t answer in time. Retry to ask again.",
    },
    SETUP_REQUIRED: {
      title: "Setup needed",
      message:
        "This model isn’t connected. Connect one in Settings, then retry.",
    },
    DISCONNECTED: {
      title: "Connection lost",
      message: "Prints lost its connection. Reopen it, then retry.",
    },
    HOST_FAILURE: {
      title: "Couldn’t create image",
      message: "The service couldn’t finish this just now. Retry in a moment.",
    },
  });
}

/** The cause and sentence to remember for a failed generation. */
export function generationFailureOf(cause: unknown): GenerationFailure {
  const reason = Schema.decodeUnknownOption(
    Schema.Struct({ code: Schema.Literals(appErrorCodes) }),
  )(cause);
  return {
    reason:
      reason._tag === "Some"
        ? reason.value.code
        : needsGatewayCredits(cause)
          ? "INSUFFICIENT_CREDIT"
          : "UNKNOWN",
    message: describeGenerationError(cause).message,
  };
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
export function generationPendingLabel(
  model: MediaModel | undefined,
  elapsedMs?: number,
  resumed = false,
): string {
  if (model === undefined) return "Creating media…";
  if (model.kind !== "video") return "Creating image…";
  if (elapsedMs === undefined)
    return "Creating video… Videos take about 2 minutes";
  const seconds = Math.max(0, Math.floor(elapsedMs / 1000));
  return `Creating video… ${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, "0")} elapsed${resumed ? " since reopening" : ""} · Videos take about 2 minutes`;
}

/** One size the composer offers: a catalog size or a generic preset. */
export type SizeChoice = Readonly<{
  value: string;
  label: string;
  width: number;
  height: number;
  /** Menu group for a model that lists standard and largest sizes. */
  group?: "Standard" | "Largest";
}>;

const greatestCommonDivisor = (a: number, b: number): number =>
  b === 0 ? a : greatestCommonDivisor(b, a % b);

/** Pixel size with its reduced aspect ratio, e.g. "1536 × 1024 · 3:2". */
export const sizeLabel = (
  width: number,
  height: number,
  ratio?: readonly [number, number],
): string => {
  if (ratio !== undefined)
    return `${String(width)} × ${String(height)} · ${String(ratio[0])}:${String(ratio[1])}`;
  return `${String(width)} × ${String(height)} · ${ratioLabel(width, height)}`;
};

/** A width and height in pixels. */
export type PixelSize = Readonly<{ width: number; height: number }>;

/** The ratios people ask for; every one is offered wherever the model can make it. */
const COMMON_RATIOS = [
  [1, 1],
  [4, 3],
  [3, 4],
  [3, 2],
  [2, 3],
  [16, 9],
  [9, 16],
  [21, 9],
] as const;
const PIXEL_MULTIPLE = 16;
/** Smallest edge the host accepts for a model that sizes its own output. */
const MINIMUM_EDGE = 256;
/** A listed size at or above this many pixels is menu-grouped as the largest. */
const LARGEST_AREA = 4_000_000;
/** Pixels in a square of the retained 1024 px default. */
const STANDARD_AREA = 1_048_576;

/**
 * A size with this ratio for a model that sizes its own output: the largest
 * edge its provider documents, else about one megapixel (the retained scale),
 * on multiples of 16 and clamped to the host's bounds.
 */
function ownSizeFor(
  model: MediaModel,
  across: number,
  down: number,
  best: boolean,
): PixelSize {
  const maximum =
    Math.floor((model.input.maxDimension ?? 4_096) / PIXEL_MULTIPLE) *
    PIXEL_MULTIPLE;
  const roundDown = (value: number) =>
    Math.round(value / PIXEL_MULTIPLE) * PIXEL_MULTIPLE;
  const clamp = (value: number) =>
    Math.min(maximum, Math.max(MINIMUM_EDGE, value));
  const divisor = greatestCommonDivisor(across, down);
  const unitWidth = (across / divisor) * PIXEL_MULTIPLE;
  const unitHeight = (down / divisor) * PIXEL_MULTIPLE;
  const documented = best && model.input.maxDimensionDocumented;
  let width: number;
  let height: number;
  if (Math.max(unitWidth, unitHeight) <= maximum / 4) {
    // An exact ratio: whole multiples of the smallest 16-aligned unit.
    const steps = documented
      ? Math.floor(maximum / Math.max(unitWidth, unitHeight))
      : Math.max(
          1,
          Math.round(Math.sqrt(STANDARD_AREA / (unitWidth * unitHeight))),
        );
    width = unitWidth * steps;
    height = unitHeight * steps;
  } else {
    const ratio = across / down;
    width = documented
      ? ratio >= 1
        ? maximum
        : roundDown(maximum * ratio)
      : roundDown(Math.sqrt(STANDARD_AREA * ratio));
    height = documented
      ? ratio >= 1
        ? roundDown(maximum / ratio)
        : maximum
      : roundDown(width / ratio);
  }
  // Keep the ratio when an extreme ratio overruns the maximum edge.
  const over = Math.max(width, height) / maximum;
  if (over > 1) {
    width = roundDown(width / over);
    height = roundDown(height / over);
  }
  return { width: clamp(width), height: clamp(height) };
}

/**
 * Ratio presets for a model that sizes its own output: each common ratio at
 * the model's best size when its provider documents a maximum, otherwise at
 * the standard scale. The three retained presets stay first.
 */
function ratioChoices(model: MediaModel): readonly SizeChoice[] {
  if (model.kind !== "image" || model.input.dimensions !== "own") return [];
  const seen = new Set<string>();
  const retained = new Set<string>();
  for (const mode of SIZE_MODES) {
    const { width, height } = SIZE_PRESETS[mode];
    const divisor = greatestCommonDivisor(width, height);
    retained.add(`${String(width / divisor)}:${String(height / divisor)}`);
    seen.add(`${String(width)}x${String(height)}`);
  }
  const out: SizeChoice[] = [];
  for (const [across, down] of COMMON_RATIOS) {
    const sizes: { size: PixelSize; group: "Standard" | "Largest" }[] =
      retained.has(`${String(across)}:${String(down)}`)
        ? []
        : [{ size: ownSizeFor(model, across, down, false), group: "Standard" }];
    if (model.input.maxDimensionDocumented)
      sizes.push({
        size: ownSizeFor(model, across, down, true),
        group: "Largest",
      });
    for (const {
      size: { width, height },
      group,
    } of sizes) {
      const value = `${String(width)}x${String(height)}`;
      if (seen.has(value)) continue;
      seen.add(value);
      out.push({
        value,
        label: sizeLabel(width, height, [across, down]),
        width,
        height,
        group,
      });
    }
  }
  return out;
}

/** The common ratio a size is within 2% of, else its reduced form or a decimal. */
export function ratioLabel(width: number, height: number): string {
  const proportion = width / height;
  const near = COMMON_RATIOS.find(
    ([across, down]) => Math.abs(proportion / (across / down) - 1) <= 0.02,
  );
  if (near !== undefined) return `${String(near[0])}:${String(near[1])}`;
  const divisor = greatestCommonDivisor(width, height);
  const across = width / divisor;
  const down = height / divisor;
  return across <= 21 && down <= 21
    ? `${String(across)}:${String(down)}`
    : `${proportion.toFixed(2)}:1`;
}

/**
 * The size this model makes for a reference of the given proportions: the nearest
 * listed size by ratio (the standard one on a tie) when the model lists its
 * sizes, else about one megapixel in the reference's ratio on multiples of 16.
 * Undefined for a model that chooses its own output size.
 */
export function matchReferenceSize(
  model: MediaModel | undefined,
  referenceWidth: number,
  referenceHeight: number,
): PixelSize | undefined {
  if (
    model?.kind !== "image" ||
    model.input.dimensions !== "own" ||
    !(referenceWidth > 0 && referenceHeight > 0)
  )
    return undefined;
  const wanted = Math.log(referenceWidth / referenceHeight);
  if (model.sizes !== null) {
    let best: { width: number; height: number; gap: number } | undefined;
    for (const size of model.sizes) {
      const match = /^(\d+)x(\d+)$/u.exec(size);
      if (match === null) continue;
      const width = Number(match[1]);
      const height = Number(match[2]);
      const gap = Math.abs(Math.log(width / height) - wanted);
      if (best === undefined || gap < best.gap - 1e-9)
        best = { width, height, gap };
    }
    return best === undefined
      ? undefined
      : { width: best.width, height: best.height };
  }
  const common = COMMON_RATIOS.find(
    ([across, down]) =>
      Math.abs(referenceWidth / referenceHeight / (across / down) - 1) <= 0.02,
  );
  return common === undefined
    ? ownSizeFor(model, referenceWidth, referenceHeight, false)
    : ownSizeFor(model, common[0], common[1], false);
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
          group: width * height >= LARGEST_AREA ? "Largest" : "Standard",
        } satisfies SizeChoice,
      ];
    });
  return [
    ...SIZE_MODES.map((mode) => ({
      value: mode,
      label: sizeLabel(SIZE_PRESETS[mode].width, SIZE_PRESETS[mode].height),
      ...SIZE_PRESETS[mode],
      group: "Standard" as const,
    })),
    ...(model === undefined ? [] : ratioChoices(model)),
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
 * else references. Image models take no roles. `named` says the prompt
 * mentions attached references (`@image1`): naming them means they are
 * references, never a first/last frame pair, unless the person chose a frame.
 */
export function resolveReferenceRoles(
  references: readonly MediaReference[],
  model: MediaModel | undefined,
  named = false,
): readonly MediaReference[] {
  const supported = referenceRolesFor(model);
  if (model?.video == null)
    return references.map(({ path, computerId }) =>
      computerId === undefined ? { path } : { path, computerId },
    );
  const chosen = references.map((reference) =>
    reference.role !== undefined && supported.includes(reference.role)
      ? reference.role
      : undefined,
  );
  const has = (role: ReferenceRole) => chosen.includes(role);
  const lastFrame = supported.includes("last-frame");
  // More images than frames can hold are references.
  const asReferences =
    (named && supported.includes("reference")) ||
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
    return { ...reference, role };
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
