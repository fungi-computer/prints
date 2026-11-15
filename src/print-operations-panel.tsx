import { useState } from "react";
import type { MediaGenerationSession } from "@fungi.computer/agar";
import { KeycapButton } from "@fungi.computer/caps/components/keycap";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@fungi.computer/caps/components/tabs";
import { Eraser, Maximize2 } from "lucide-react";
import { generationLimitReason } from "./generation-limit.js";
import {
  useGenerationQuoteStatus,
  type QuoteStatus,
} from "./generation-quote.js";
import type { MediaModel } from "./generation-model.js";
import {
  OPERATION_LABELS,
  operationModelFor,
  operationRefusal,
  operationSettings,
  upscaleChoices,
  type OperationSource,
  type PrintOperation,
} from "./print-operations.js";

/** What the drawer needs to run an image action; absent when none can run. */
export type PrintOperations = Readonly<{
  session: Pick<MediaGenerationSession, "computerId" | "quote"> | undefined;
  /** Runs at the cap of simultaneous generations cannot start another. */
  atLimit: boolean;
  /**
   * Start the action. Anything that stops it from starting is the owner's to
   * report as a toast, so this only resolves once it has started or been refused.
   */
  onRun: (
    operation: PrintOperation,
    megapixels: number | undefined,
  ) => Promise<void>;
}>;

/** The key's face: the action, then what it will cost, or a waiting mark while the host prices it. */
function labelWithPrice(label: string, quote: QuoteStatus): string {
  if (quote.state === "loading") return `${label} · …`;
  if (quote.state === "ready" && quote.price !== null)
    return `${label} · ${quote.price}`;
  return label;
}

/**
 * Remove background and Upscale for one print. Each key carries its price
 * from the host's quote of the exact settings, and waits for it, before
 * anything runs; the result is a new print beside this one.
 */
export function PrintOperationsPanel({
  models,
  source,
  operations,
}: {
  models: readonly MediaModel[];
  source: OperationSource;
  operations: PrintOperations;
}) {
  const remove = operationModelFor(models, "remove_background");
  const upscale = operationModelFor(models, "upscale");
  const choices = upscale === undefined ? [] : upscaleChoices(upscale, source);
  const [chosen, setChosen] = useState<number | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const first = choices.find((choice) => choice.disabledReason === undefined);
  const megapixels =
    choices.find(
      (choice) =>
        choice.megapixels === chosen && choice.disabledReason === undefined,
    )?.megapixels ?? first?.megapixels;
  const removeRefusal =
    remove === undefined ? undefined : operationRefusal(remove, source);
  const upscaleRefusal =
    upscale === undefined ? undefined : operationRefusal(upscale, source);
  const removeQuote = useGenerationQuoteStatus(
    operations.session,
    remove === undefined || removeRefusal !== undefined
      ? null
      : operationSettings(remove, source, undefined),
  );
  const upscaleQuote = useGenerationQuoteStatus(
    operations.session,
    upscale === undefined ||
      upscaleRefusal !== undefined ||
      megapixels === undefined
      ? null
      : operationSettings(upscale, source, megapixels),
  );
  if (remove === undefined && upscale === undefined) return null;
  const start = (operation: PrintOperation, size: number | undefined) => {
    setBusy(true);
    void operations.onRun(operation, size).finally(() => {
      setBusy(false);
    });
  };
  const blocked = busy || operations.atLimit;
  const why = operations.atLimit ? generationLimitReason : undefined;
  const refused = choices.filter((choice) => choice.disabledReason);
  return (
    <section
      className="prints-info-operations"
      aria-label="Edit this image"
      data-print-operations
    >
      {remove ? (
        <KeycapButton
          label={labelWithPrice(
            OPERATION_LABELS.remove_background,
            removeQuote,
          )}
          icon={<Eraser />}
          disabled={
            blocked ||
            removeRefusal !== undefined ||
            removeQuote.state === "loading"
          }
          aria-busy={removeQuote.state === "loading"}
          title={removeRefusal ?? why}
          data-operation="remove_background"
          onClick={() => {
            start("remove_background", undefined);
          }}
        />
      ) : null}
      {upscale ? (
        <>
          <Tabs
            className="prints-info-sizes"
            value={megapixels === undefined ? "" : String(megapixels)}
            onValueChange={(value) => {
              setChosen(Number(value));
            }}
          >
            <TabsList variant="segmented" aria-label="Upscale output size">
              {choices.map((choice) => (
                <TabsTrigger
                  key={choice.megapixels}
                  value={String(choice.megapixels)}
                  disabled={choice.disabledReason !== undefined}
                  title={choice.disabledReason}
                >
                  {choice.megapixels} MP
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          {refused.length > 0 ? (
            <p className="prints-info-hint" data-operation-hint>
              {refused[0]?.disabledReason}
            </p>
          ) : null}
          <KeycapButton
            label={labelWithPrice(
              megapixels === undefined
                ? OPERATION_LABELS.upscale
                : `${OPERATION_LABELS.upscale} to ${String(megapixels)} MP`,
              upscaleQuote,
            )}
            icon={<Maximize2 />}
            disabled={
              blocked ||
              upscaleRefusal !== undefined ||
              megapixels === undefined ||
              upscaleQuote.state === "loading"
            }
            aria-busy={upscaleQuote.state === "loading"}
            title={
              upscaleRefusal ??
              (megapixels === undefined
                ? "This image is already larger than any size offered."
                : why)
            }
            data-operation="upscale"
            onClick={() => {
              start("upscale", megapixels);
            }}
          />
        </>
      ) : null}
    </section>
  );
}
