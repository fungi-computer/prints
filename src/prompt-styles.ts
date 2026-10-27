import { appBackend } from "@fungi.computer/agar/backend";
import type { CapabilityDirectory } from "@fungi.computer/agar";
import * as Schema from "effect/Schema";

/** The provider-wide prompt limit when a model names none of its own. */
const DEFAULT_PROMPT_LIMIT = 2_048;
export const MAX_STYLES = 50;
export const STYLE_NAME_LIMIT = 64;
export const STYLE_TEXT_LIMIT = 8_000;

/** Starter styles for anyone; negative ids never collide with saved rows. */
export const BUILT_IN_STYLES: readonly PromptStyle[] = [
  {
    name: "Anime cel",
    text: "Anime cel illustration with clean ink outlines, flat cel shading, and a limited palette of saturated colors. Soft painted backgrounds, expressive eyes, and crisp highlights, in the look of a hand-drawn animation frame.",
  },
  {
    name: "Cinematic film still",
    text: "Cinematic film still shot on anamorphic lenses with shallow depth of field. Moody, motivated lighting, subtle film grain, and a considered color grade, composed like a frame from a feature film.",
  },
  {
    name: "Watercolor",
    text: "Soft watercolor painting on textured paper, with translucent washes, visible pigment bleeds, and gentle color gradients. Loose brushwork, white paper left showing at the edges, and a calm, airy mood.",
  },
  {
    name: "Pixel art",
    text: "Pixel art with a limited color palette, crisp square pixels, and no anti-aliasing. Clear readable silhouettes, dithered shading, and the charm of a classic 16-bit game sprite or scene.",
  },
  {
    name: "Product photo",
    text: "Professional product photograph on a seamless studio background. Soft diffused lighting with gentle shadows, sharp focus across the subject, accurate colors, and clean, minimal composition suited to a catalog.",
  },
  {
    name: "Comic ink",
    text: "Comic book panel with bold black ink linework, hatching and crosshatched shadows, and flat vivid colors. Dynamic angles, strong contrast, and a printed halftone texture.",
  },
].map((style, index) => ({ ...style, id: -(index + 1), builtIn: true }));

export const styleName = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1)),
  Schema.check(Schema.isMaxLength(STYLE_NAME_LIMIT)),
);
const styleText = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1)),
  Schema.check(Schema.isMaxLength(STYLE_TEXT_LIMIT)),
);
const computerId = Schema.NonEmptyString;

/** A saved style block: reusable prompt text, picked by name. */
const promptStyleSchema = Schema.Struct({
  id: Schema.Int,
  name: styleName,
  text: styleText,
  /** Starter styles ship with Prints: read-only, duplicated to edit. */
  builtIn: Schema.Boolean,
});
export type PromptStyle = Schema.Schema.Type<typeof promptStyleSchema>;

/** Styles belong to this Prints installation; a Computer id only admits the call. */
export const promptStyleRequestSchema = Schema.Union([
  Schema.Struct({ operation: Schema.Literal("list-styles"), computerId }),
  Schema.Struct({
    operation: Schema.Literal("save-style"),
    computerId,
    /** Omitted to create; present to rename or rewrite that style. */
    id: Schema.optional(Schema.Int),
    name: styleName,
    text: styleText,
  }),
  Schema.Struct({
    operation: Schema.Literal("delete-style"),
    computerId,
    id: Schema.Int,
  }),
  Schema.Struct({
    operation: Schema.Literal("read-print-style"),
    computerId,
    path: Schema.NonEmptyString,
  }),
]);
type PromptStyleRequest = Schema.Schema.Type<typeof promptStyleRequestSchema>;
const promptStylesSchema = Schema.Struct({
  styles: Schema.Array(promptStyleSchema).pipe(
    Schema.check(Schema.isMaxLength(MAX_STYLES + BUILT_IN_STYLES.length)),
  ),
});
/** The style recorded on one print; null when it used none. */
const printStyleSchema = Schema.Struct({
  style: Schema.NullOr(styleName),
});

/** The final prompt: the style text first, then what the person typed. */
export function composePrompt(
  style: string | undefined,
  prompt: string,
): string {
  const typed = prompt.trim();
  return style === undefined ? typed : `${style.trim()}\n\n${typed}`;
}

/** What a model accepts in one prompt: its own limit, else the provider-wide one. */
export function promptLimitFor(
  model: Readonly<{ maxPromptLength: number }> | undefined,
): number {
  return model?.maxPromptLength ?? DEFAULT_PROMPT_LIMIT;
}

/**
 * Name the overflow, and the style and `@characters` that added to it, so the
 * person can act.
 */
export function promptLengthMessage(
  composed: string,
  limit: number,
  styleLabel: string | undefined,
  characters: readonly string[] = [],
): string | undefined {
  if (composed.length <= limit) return undefined;
  const total = `${String(composed.length)} characters; this model accepts at most ${String(limit)}.`;
  const named = characters.map((name) => `@${name}`).join(", ");
  if (styleLabel !== undefined && named !== "")
    return `The "${styleLabel}" style and your prompt with ${named} expanded total ${total}`;
  if (styleLabel !== undefined)
    return `The "${styleLabel}" style and your prompt total ${total}`;
  if (named !== "") return `Your prompt with ${named} expanded is ${total}`;
  return `The prompt is ${total}`;
}

const asking = (capabilities: CapabilityDirectory) =>
  capabilities.require(appBackend);
const body = (request: PromptStyleRequest): string => JSON.stringify(request);
const decodeStyles = Schema.decodeUnknownSync(promptStylesSchema);

export async function listStyles(
  capabilities: CapabilityDirectory,
  id: string,
) {
  return decodeStyles(
    await asking(capabilities).request(
      body({ operation: "list-styles", computerId: id }),
    ),
  );
}
export async function saveStyle(
  capabilities: CapabilityDirectory,
  id: string,
  style: Readonly<{ id?: number | undefined; name: string; text: string }>,
) {
  return decodeStyles(
    await asking(capabilities).request(
      body({
        operation: "save-style",
        computerId: id,
        id: style.id,
        name: style.name,
        text: style.text,
      }),
    ),
  );
}
export async function deleteStyle(
  capabilities: CapabilityDirectory,
  id: string,
  styleId: number,
) {
  return decodeStyles(
    await asking(capabilities).request(
      body({
        operation: "delete-style",
        computerId: id,
        id: styleId,
      }),
    ),
  );
}
/** The style name recorded when this print was made, if any. */
export async function readPrintStyle(
  capabilities: CapabilityDirectory,
  id: string,
  path: string,
) {
  return Schema.decodeUnknownSync(printStyleSchema)(
    await asking(capabilities).request(
      body({
        operation: "read-print-style",
        computerId: id,
        path,
      }),
    ),
  );
}
