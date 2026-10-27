import {
  draftForModel,
  modelFor,
  modelName,
  sizeForModel,
  type GenerationDraft,
  type MediaModel,
  type MediaReference,
} from "./generation-model.js";

/** Iterate from a print: load its request, add it as a reference, or animate it. */
export type Iteration = "reuse" | "remix" | "animate";

/** What a print remembers about how it was made; absent facts stay absent. */
export type PrintLineage = Readonly<{
  kind: "image" | "video";
  model: string;
  /** The prompt as typed, with saved characters, and how many references were the person's own. */
  typed: Readonly<{ prompt: string; references: number }>;
  references: readonly Readonly<{ path: string }>[];
  /** The style block it was made with, by name. */
  style: string | null;
  steps: number | null;
  width: number | null;
  height: number | null;
}>;

export type IterationOutcome =
  | Readonly<{
      kind: "draft";
      draft: GenerationDraft;
      /** Said to the person when the draft could not be what the print recorded. */
      notice: string | null;
    }>
  | Readonly<{ kind: "refused"; message: string }>;

/**
 * The video model that takes this print as its first frame: the first Seedance
 * model the catalog lists, else any video model that accepts a first frame.
 */
export function animateModelFor(
  models: readonly MediaModel[],
): MediaModel | undefined {
  const candidates = models.filter(
    (model) =>
      model.kind === "video" &&
      model.video !== null &&
      model.input.maxReferences >= 1 &&
      model.video.referenceRoles.includes("first-frame"),
  );
  return (
    candidates.find((model) => model.video?.provider === "seedance") ??
    candidates.at(0)
  );
}

/** The video format whose shape is closest to the print, at the default resolution. */
function formatNear(model: MediaModel, width: number, height: number) {
  const video = model.video;
  if (video === null) return undefined;
  const wanted = Math.log(width / height);
  const distance = (format: { width: number; height: number }) =>
    Math.abs(Math.log(format.width / format.height) - wanted);
  const formats = video.formats.filter(
    (format) => format.resolution === video.defaultResolution,
  );
  return formats.reduce<(typeof formats)[number] | undefined>(
    (best, format) =>
      best === undefined || distance(format) < distance(best) ? format : best,
    undefined,
  );
}

/**
 * Build the composer draft for one action. Nothing is sent: the person tweaks
 * and presses send. `printPath` is the print's own file, added by Remix and
 * Animate as a reference. Nothing is trimmed to fit the model: a draft over its
 * prompt or reference limit shows the composer's over-limit state instead.
 */
export function iterationDraft(
  action: Iteration,
  input: Readonly<{
    lineage: PrintLineage;
    printPath: string;
    models: readonly MediaModel[];
    /** Names of the styles that still exist. */
    styles: readonly string[];
    current: GenerationDraft;
  }>,
): IterationOutcome {
  const { lineage, printPath, models, current } = input;
  const animateModel =
    action === "animate" ? animateModelFor(models) : undefined;
  if (action === "animate" && animateModel === undefined)
    return {
      kind: "refused",
      message: "No video model on this Computer takes a first frame.",
    };
  const recorded = modelFor(models, lineage.model);
  const model = animateModel ?? recorded ?? modelFor(models, current.model);
  if (model === undefined)
    return {
      kind: "refused",
      message: "Choose a model from the granted registry.",
    };
  const notice =
    animateModel === undefined && recorded === undefined
      ? `This print was made with ${lineage.model}, which is no longer available. Loaded it with ${modelName(model)} instead.`
      : null;
  const own = lineage.references.slice(0, lineage.typed.references);
  // Animate makes the print the clip's first frame.
  const print: MediaReference =
    action === "animate"
      ? { path: printPath, role: "first-frame" }
      : { path: printPath };
  const withPrint = [print, ...own.filter((entry) => entry.path !== printPath)];
  if (action !== "reuse" && model.input.maxReferences === 0)
    return {
      kind: "refused",
      message: `${model.label} does not take reference images.`,
    };
  const references =
    action === "reuse" ? own : action === "remix" ? withPrint : [print];
  const base = draftForModel(current, model);
  const recordedSize = {
    width: lineage.width ?? base.width,
    height: lineage.height ?? base.height,
  };
  const size =
    animateModel === undefined
      ? sizeForModel(recordedSize, model, undefined)
      : (formatNear(model, recordedSize.width, recordedSize.height) ?? base);
  const steps =
    animateModel === undefined &&
    model.input.steps !== "fixed" &&
    lineage.steps !== null &&
    model.id === lineage.model
      ? lineage.steps
      : base.steps;
  const style =
    lineage.style !== null && input.styles.includes(lineage.style)
      ? lineage.style
      : undefined;
  return {
    kind: "draft",
    notice,
    draft: {
      ...base,
      destination: undefined,
      prompt: lineage.typed.prompt,
      references,
      steps,
      style,
      width: size.width,
      height: size.height,
    },
  };
}
