import type { MediaGenerationInput } from "@fungi.computer/agar";
import {
  generationDestinationFor,
  type GenerationDraft,
  type MediaModel,
} from "./generation-model.js";

/** What an image action does to a print; the catalog's `transform.operation`. */
export type PrintOperation = "remove_background" | "upscale";

export const OPERATION_LABELS = {
  remove_background: "Remove background",
  upscale: "Upscale",
} as const satisfies Record<PrintOperation, string>;

/** The print an action reads: its file, Computer and pixel size. */
export type OperationSource = Readonly<{
  computerId: string;
  path: string;
  width: number;
  height: number;
}>;

/** The catalog model that does `operation`, or undefined when this Computer lacks it. */
export function operationModelFor(
  models: readonly MediaModel[],
  operation: PrintOperation,
): MediaModel | undefined {
  return models.find((model) => model.transform?.operation === operation);
}

/** One output size an upscale offers, and why it cannot run for this print. */
export type UpscaleChoice = Readonly<{
  megapixels: number;
  disabledReason: string | undefined;
}>;

/** The sizes the model offers; one at or below the print's own size cannot enlarge it. */
export function upscaleChoices(
  model: MediaModel,
  source: Pick<OperationSource, "width" | "height">,
): readonly UpscaleChoice[] {
  const sourceMegapixels = (source.width * source.height) / 1_000_000;
  return (model.transform?.sizes ?? []).map(({ megapixels }) => ({
    megapixels,
    disabledReason:
      sourceMegapixels >= megapixels
        ? `This image is already ${sourceMegapixels.toFixed(1)} MP.`
        : undefined,
  }));
}

/** Why the print cannot take this operation before any request is made, or undefined. */
export function operationRefusal(
  model: MediaModel,
  source: Pick<OperationSource, "width" | "height">,
): string | undefined {
  const limits = model.transform?.source;
  if (limits === undefined) return `${model.label} is not an image action.`;
  if (source.width * source.height > limits.maxPixels)
    return `This image is over ${String(limits.maxPixels / 1_000_000)} MP, the most ${model.label} takes.`;
  return undefined;
}

/**
 * The settings one action sends: the print as the model's only reference and,
 * for an upscale, its output size. The prompt only labels the saved print.
 */
export function operationSettings(
  model: MediaModel,
  source: Pick<OperationSource, "computerId" | "path">,
  megapixels: number | undefined,
): MediaGenerationInput["settings"] {
  const transform = model.transform;
  if (transform === null) throw new Error(`${model.id} is not an image action`);
  const reference = { computerId: source.computerId, path: source.path };
  if (transform.operation === "upscale") {
    const size = megapixels ?? transform.defaultMegapixels;
    if (size === null) throw new Error(`${model.id} needs an output size`);
    return {
      model: model.id,
      prompt: `${OPERATION_LABELS.upscale} to ${String(size)} MP`,
      references: [reference],
      targetMegapixels: size,
    };
  }
  return {
    model: model.id,
    prompt: OPERATION_LABELS[transform.operation],
    references: [reference],
  };
}

/** The directory of `path`, so the result is saved beside the original. */
const directoryOf = (path: string): string => {
  const at = path.lastIndexOf("/");
  return at <= 0 ? "/" : path.slice(0, at);
};

/** One action's request and the draft its pending tile follows. */
export type OperationRun = Readonly<{
  input: MediaGenerationInput;
  draft: GenerationDraft;
}>;

/** The run an action starts: a new file beside the source, never over it. */
export function operationInputFor(
  model: MediaModel,
  source: OperationSource,
  megapixels: number | undefined,
): OperationRun {
  const settings = operationSettings(model, source, megapixels);
  const draft: GenerationDraft = {
    model: model.id,
    prompt: settings.prompt,
    references: settings.references ?? [],
    // The pending tile keeps the print's own shape until the new file is read.
    width: source.width,
    height: source.height,
  };
  const destination = generationDestinationFor(
    draft,
    directoryOf(source.path),
    model,
  );
  return {
    input: { destination: { path: destination }, settings },
    draft: { ...draft, destination },
  };
}
