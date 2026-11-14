import type {
  MediaGenerationInput,
  MediaGenerationSession,
} from "@fungi.computer/agar";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  generationInputFor,
  resolveReferenceRoles,
  validationMessage,
  type GenerationDraft,
  type MediaModel,
} from "./generation-model.js";
import { formatPrintCost } from "./print-cost.js";
import { planCharacters, type PromptCharacter } from "./prompt-characters.js";
import { composePrompt } from "./prompt-styles.js";
import {
  mentionedReferenceNumbers,
  referenceWording,
} from "./reference-mentions.js";

/** How long the draft must hold still before the host is asked for a price. */
const QUOTE_DELAY_MS = 400;

/**
 * The settings a send would hand the host for this draft: the same composed
 * prompt (style and characters), merged references with their resolved roles,
 * and generation input, so the quote prices what metering will charge. Null
 * when the draft could not be sent yet (no prompt, over a limit, a refused
 * mention), because a price for something that cannot be made misleads.
 */
export function quoteSettingsFor(
  input: Readonly<{
    draft: GenerationDraft;
    model: MediaModel | undefined;
    styleText: string | undefined;
    characters: readonly PromptCharacter[];
    /** Label number of each attached reference, as the prompt names them. */
    labels: readonly number[];
    computerId: string | null;
  }>,
): MediaGenerationInput["settings"] | null {
  const { draft, model } = input;
  if (model === undefined || draft.prompt.trim() === "") return null;
  const named = mentionedReferenceNumbers(draft.prompt).length > 0;
  const plan = planCharacters({
    prompt: draft.prompt,
    saved: input.characters,
    references: draft.references,
    labels: input.labels,
    wording: (merged) =>
      referenceWording(resolveReferenceRoles(merged, model, named), model),
    computerId: input.computerId,
    model: { label: model.label, maxReferences: model.input.maxReferences },
  });
  if (plan.kind === "refused") return null;
  const references = resolveReferenceRoles(plan.references, model, named);
  const composed = {
    ...draft,
    prompt: composePrompt(input.styleText, plan.prompt),
    references,
  };
  if (validationMessage(composed, model) !== undefined) return null;
  // generationInputFor refuses a video size the model does not list; that
  // is the form's own refusal, so there is nothing to price.
  if (
    model.video !== null &&
    !model.video.formats.some(
      (format) =>
        format.width === composed.width && format.height === composed.height,
    )
  )
    return null;
  return generationInputFor(composed, model).settings;
}

type Settled = Readonly<{
  key: string | null;
  settings: MediaGenerationInput["settings"] | null;
}>;

/** The settings, once their key has held still for `delay` milliseconds. */
function useSettled(
  settings: MediaGenerationInput["settings"] | null,
  delay: number,
): Settled {
  const key = settings === null ? null : JSON.stringify(settings);
  const latest = useRef(settings);
  latest.current = settings;
  const [settled, setSettled] = useState<Settled>({ key, settings });
  useEffect(() => {
    const timer = setTimeout(() => {
      setSettled({ key, settings: latest.current });
    }, delay);
    return () => {
      clearTimeout(timer);
    };
  }, [key, delay]);
  return settled;
}

/** One host price for settings that have held still; failures are not retried. */
function generationQuoteQuery(
  session: Pick<MediaGenerationSession, "computerId" | "quote"> | undefined,
  settled: Settled,
) {
  return queryOptions({
    queryKey: ["prints", "quote", session?.computerId ?? null, settled.key],
    enabled: session !== undefined && settled.settings !== null,
    queryFn: () =>
      session === undefined || settled.settings === null
        ? null
        : session.quote(settled.settings),
    staleTime: 60_000,
    retry: false,
  });
}

/**
 * The host's price for the draft as "$1.16", or null: nothing to price, the
 * draft is still changing, the host cannot quote, the request failed, or the
 * price is zero. A free or unknown price shows nothing, never "$0".
 */
export function useGenerationQuote(
  session: Pick<MediaGenerationSession, "computerId" | "quote"> | undefined,
  settings: MediaGenerationInput["settings"] | null,
): string | null {
  const key = settings === null ? null : JSON.stringify(settings);
  const settled = useSettled(settings, QUOTE_DELAY_MS);
  const query = useQuery(generationQuoteQuery(session, settled));
  if (settled.key !== key || query.data == null) return null;
  return formatPrintCost(query.data.costMilliunits);
}
