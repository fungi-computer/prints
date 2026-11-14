import type { MediaGenerationInput } from "@fungi.computer/agar";

/**
 * One attached reference. Declared from Agar's own types, not Prints'
 * generation model, because the Prints backend imports this module too and
 * must not pull the browser form's modules into its own type check.
 */
export type MediaReference = NonNullable<
  MediaGenerationInput["settings"]["references"]
>[number];

/**
 * Attached references are named in a prompt as `@image1`, `@image2`, ... The
 * number is a label the composer hands out in attach order and never reuses
 * while a mention might still mean it, so removing a reference leaves the
 * other mentions where they were. The label is not the model's position:
 * `expandReferenceMentions` rewrites each one to the position the provider
 * will index the image at.
 */
const referenceMention = /(?<![\p{L}\p{N}_@-])@image(\d+)(?![\p{L}\p{N}_-])/giu;

/** The `@imageN` label a prompt uses for reference number `number`. */
export const referenceLabel = (number: number) => `image${String(number)}`;

/** Label numbers the prompt mentions, in order of first appearance. */
export function mentionedReferenceNumbers(prompt: string): number[] {
  const numbers: number[] = [];
  for (const match of prompt.matchAll(referenceMention)) {
    const number = Number(match.at(1));
    if (!numbers.includes(number)) numbers.push(number);
  }
  return numbers;
}

/** Which reference a label names: the file and, when given, its Computer. */
export const referenceKey = (
  reference: MediaReference,
  computerId: string | null,
) => JSON.stringify([reference.computerId ?? computerId, reference.path]);

/** The labels in use and the next number to hand out. */
export type ReferenceLedger = Readonly<{
  labels: ReadonlyMap<string, number>;
  next: number;
}>;
export const emptyLedger: ReferenceLedger = { labels: new Map(), next: 1 };

/**
 * The ledger after the attached references changed.
 * - A reference that stays keeps its label; a new one takes the next number.
 * - A removed reference's number is not reused, so a mention of it turns
 *   invalid instead of pointing at another image.
 * - Numbering restarts at 1 once nothing is attached and the prompt mentions
 *   no image, or when every attached reference was replaced in one step (a
 *   draft loaded from a print or the agent), which names a whole new set.
 */
export function advanceLedger(
  ledger: ReferenceLedger,
  keys: readonly string[],
  prompt: string,
): ReferenceLedger {
  const mentioned = mentionedReferenceNumbers(prompt).length > 0;
  if (keys.length === 0) {
    if (ledger.labels.size === 0 && (ledger.next === 1 || mentioned))
      return ledger;
    return mentioned ? { labels: new Map(), next: ledger.next } : emptyLedger;
  }
  const replaced =
    ledger.labels.size > 0 && keys.every((key) => !ledger.labels.has(key));
  const base = replaced ? emptyLedger : ledger;
  const labels = new Map<string, number>();
  let next = base.next;
  for (const key of keys) {
    if (labels.has(key)) continue;
    labels.set(key, base.labels.get(key) ?? next);
    if (!base.labels.has(key)) next += 1;
  }
  const same =
    labels.size === ledger.labels.size &&
    next === ledger.next &&
    [...labels].every(([key, number]) => ledger.labels.get(key) === number);
  return same ? ledger : { labels, next };
}

/** The label number of each reference, in attach order. */
export function referenceNumbers(
  ledger: ReferenceLedger,
  keys: readonly string[],
): number[] {
  return keys.map((key) => ledger.labels.get(key) ?? 0);
}

/**
 * What each reference is called to the model, in the order given (roles
 * already resolved). Providers index references by position: GPT Image's
 * `images[]`, the Flux inputs and Seedance's `reference_images[]` all keep
 * the order the references were sent in, 1-based in prose. A video model
 * sends its first and last frame as separate fields, not in
 * `reference_images`, so only plain references count toward "image N".
 */
export function referenceWording(
  references: readonly MediaReference[],
  model: Readonly<{ kind: "image" | "video" | "audio" }> | undefined,
): string[] {
  let position = 0;
  return references.map((reference) => {
    if (model?.kind === "video") {
      if (reference.role === "first-frame") return "the first frame";
      if (reference.role === "last-frame") return "the last frame";
    }
    position += 1;
    return `image ${String(position)}`;
  });
}

export type ReferenceExpansion =
  | Readonly<{ kind: "ready"; prompt: string }>
  | Readonly<{ kind: "missing"; labels: readonly string[] }>;

/**
 * Rewrite each `@imageN` to the wording of the reference that holds label N.
 * `numbers[i]` is the label of attached reference i and `wording[i]` what the
 * model should read for it. A label no attached reference holds is reported,
 * never guessed.
 */
export function expandReferenceMentions(
  prompt: string,
  numbers: readonly number[],
  wording: readonly string[],
): ReferenceExpansion {
  const missing: string[] = [];
  const expanded = prompt.replace(referenceMention, (typed, digits: string) => {
    const at = numbers.indexOf(Number(digits));
    const text = at < 0 ? undefined : wording.at(at);
    if (text === undefined) {
      const label = referenceLabel(Number(digits));
      if (!missing.includes(label)) missing.push(label);
      return typed;
    }
    return text;
  });
  return missing.length === 0
    ? { kind: "ready", prompt: expanded }
    : { kind: "missing", labels: missing };
}

/**
 * Relabel mentions through `map`: label N becomes `map(N)`, or stays when
 * `map` has no answer. Used to store a prompt in attach order and to carry a
 * recalled prompt onto a reshuffled reference list.
 */
export function relabelReferenceMentions(
  prompt: string,
  map: (number: number) => number | undefined,
): string {
  return prompt.replace(referenceMention, (typed, digits: string) => {
    const mapped = map(Number(digits));
    return mapped === undefined || mapped < 1
      ? typed
      : `@${referenceLabel(mapped)}`;
  });
}
