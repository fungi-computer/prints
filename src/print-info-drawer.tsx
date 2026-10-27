import { useEffect, useRef, useState } from "react";
import type {
  AppRoot,
  AppBrowserAction,
  AppBrowserActionOutcome,
} from "@fungi.computer/agar";
import { useMutation, useQuery } from "@tanstack/react-query";
import { capabilityQuery, queryKeys } from "@fungi.computer/agar/query";
import { appMethods } from "@fungi.computer/agar/backend";
import * as z from "zod";
import { printStyleQuery } from "./media-queries.js";
import { Button } from "@fungi.computer/caps/components/button";
import { IconButton } from "@fungi.computer/caps/components/icon-button";
import { Surface } from "@fungi.computer/caps/components/surface";
import { DataList, DataRow } from "@fungi.computer/caps/components/data-list";
import { Clapperboard, Download, RotateCcw, Shuffle, X } from "lucide-react";
import type { Iteration, PrintLineage } from "./print-iteration.js";
import { modelFor, modelName, type MediaModel } from "./generation-model.js";
import type { GalleryImage, GallerySource } from "./media-gallery.js";
import {
  preparePrintDownload,
  describePrintDownloadError,
  describePrintDownloadRefusal,
} from "./prints-download.js";
import { reportCatchFailure } from "./log-event.js";

// Only the generation facts the drawer shows; getOutput's owner validates the rest.
const outputDetailsSchema = z.object({
  print: z.object({
    kind: z.enum(["image", "video"]),
    model: z.string(),
    width: z.number().nullable(),
    height: z.number().nullable(),
    steps: z.number().nullable(),
    createdAt: z.number(),
  }),
  typed: z.object({ prompt: z.string(), references: z.number() }),
  references: z.array(z.object({ path: z.string() })),
  characters: z.array(z.string()),
});
type OutputDetails = z.output<typeof outputDetailsSchema>;

const lineageOf = (
  details: OutputDetails,
  style: string | null,
): PrintLineage => ({
  style,
  kind: details.print.kind,
  model: details.print.model,
  typed: details.typed,
  references: details.references,
  steps: details.print.steps,
  width: details.print.width,
  height: details.print.height,
});

const divisor = (a: number, b: number): number =>
  b === 0 ? a : divisor(b, a % b);
const aspectOf = (width: number, height: number): string => {
  const common = divisor(width, height);
  return `${String(width / common)}:${String(height / common)}`;
};
const madeAt = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
});

/** The recorded model and reference images of a Computer file, when it is a print. */
function useOutputDetails(image: GalleryImage, app: AppRoot | null) {
  const source = image.source;
  const path = source.kind === "computer" ? source.path : null;
  const computerId = source.kind === "computer" ? source.computerId : null;
  return useQuery({
    ...capabilityQuery(
      app,
      appMethods,
      queryKeys.of(app, "prints", "output-details", computerId, path),
      async (methods, signal) => {
        const reply = await methods.call("getOutput", JSON.stringify({ path }));
        signal.throwIfAborted();
        const details = outputDetailsSchema.safeParse(reply);
        return details.success ? details.data : null;
      },
    ),
    enabled: Boolean(
      app && path && computerId && app.capabilities.has(appMethods),
    ),
    retry: false,
  });
}

function usePrintDownload(source: GallerySource, app: AppRoot | null) {
  const active = useRef<AbortController | null>(null);
  const preparation = useMutation({
    gcTime: 0,
    mutationFn: async (controller: AbortController) => {
      const file = await preparePrintDownload(source, controller.signal);
      const bytes = new Uint8Array(await file.arrayBuffer());
      controller.signal.throwIfAborted();
      return {
        kind: "saveFile",
        name: file.name,
        mime: file.type,
        bytes,
      } satisfies AppBrowserAction;
    },
    onError: (cause, controller) => {
      if (!controller.signal.aborted)
        reportCatchFailure("prepare-print-download", cause);
    },
  });
  const { mutate: prepare, reset } = preparation;
  useEffect(() => {
    const controller = new AbortController();
    active.current = controller;
    const cancel = () => {
      controller.abort();
      reset();
    };
    const context = app?.context.subscribe((value) => {
      if (source.kind === "computer" && value.computerId !== source.computerId)
        cancel();
    });
    const lifecycle = app?.lifecycle.subscribe((state) => {
      if (
        state === "disconnected" ||
        state === "disposing" ||
        state === "disposed"
      )
        cancel();
    });
    prepare(controller);
    return () => {
      context?.();
      lifecycle?.();
      controller.abort();
      if (active.current === controller) active.current = null;
    };
  }, [source, app, prepare, reset]);
  const download = useMutation({
    gcTime: 0,
    mutationFn: (outcome: Promise<AppBrowserActionOutcome>) => outcome,
    onError: (cause) => {
      reportCatchFailure("download-print", cause);
    },
  });
  const cause = preparation.error ?? download.error;
  const failure = cause
    ? describePrintDownloadError(cause)
    : download.data?.kind === "refused"
      ? describePrintDownloadRefusal(download.data)
      : null;
  const preparing = preparation.isIdle || preparation.isPending;
  return {
    preparing,
    isPending: download.isPending,
    disabled: !preparation.data || download.isPending,
    failure,
    start: () => {
      if (
        preparation.data &&
        !download.isPending &&
        !active.current?.signal.aborted
      ) {
        // Start the prepared host request in the click, before mutation
        // bookkeeping can yield or disable the focused button.
        const outcome = app
          ? app.ui.requestBrowserAction(preparation.data)
          : Promise.resolve<AppBrowserActionOutcome>({
              kind: "refused",
              reason: "unavailable",
            });
        download.mutate(outcome);
      }
    },
  };
}

/** One non-modal information panel owns file actions; tiles stay uncluttered. */
export function PrintInfoDrawer({
  image,
  app,
  referenceImages,
  models,
  canAnimate,
  onIterate,
  onClose,
}: {
  image: GalleryImage;
  app: AppRoot | null;
  /** Gallery images by path, for the reference thumbnails. */
  referenceImages: readonly { path: string; url: string }[];
  /** The granted catalog, for the recorded model's display name. */
  models: readonly MediaModel[];
  /** An image-to-video model is available. */
  canAnimate: boolean;
  /** Load the print into the composer; a message says why it could not. */
  onIterate: (action: Iteration, lineage: PrintLineage) => string | null;
  onClose: () => void;
}) {
  const [refusal, setRefusal] = useState<string | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const download = usePrintDownload(image.source, app);
  const failure = download.failure;
  const style = useQuery(
    printStyleQuery(
      app,
      image.source.kind === "computer" ? image.source.path : null,
    ),
  );
  const details = useOutputDetails(image, app).data;
  const lineage = details
    ? lineageOf(details, style.data?.style ?? null)
    : null;
  const recordedModel = details ? modelFor(models, details.print.model) : null;
  useEffect(() => {
    const previous = document.activeElement;
    panel.current?.focus();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    };
  }, []);
  return (
    <Surface
      ref={panel}
      className="prints-info-drawer"
      role="region"
      aria-label="Image information"
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="flex items-center justify-between gap-sm">
        <h2 className="text-base font-semibold">Image info</h2>
        <IconButton
          aria-label="Close image information"
          icon={<X />}
          onClick={onClose}
        />
      </div>
      <DataList density="compact">
        <DataRow>
          <span className="text-base-content/60">File</span>
          <span className="break-all">{image.file.name}</span>
        </DataRow>
        <DataRow>
          <span className="text-base-content/60">Size</span>
          <span>
            {image.width} × {image.height} ·{" "}
            {aspectOf(image.width, image.height)}
          </span>
        </DataRow>
        {style.data?.style ? (
          <DataRow>
            <span className="text-base-content/60">Style</span>
            <span>{style.data.style}</span>
          </DataRow>
        ) : null}
        {details ? (
          <DataRow>
            <span className="text-base-content/60">Prompt</span>
            <span className="whitespace-pre-wrap break-words" data-print-prompt>
              {details.typed.prompt}
            </span>
          </DataRow>
        ) : null}
        {details ? (
          <DataRow>
            <span className="text-base-content/60">Model</span>
            <span className="break-all" data-print-model>
              {recordedModel
                ? modelName(recordedModel)
                : `${details.print.model} (no longer available)`}
            </span>
          </DataRow>
        ) : null}
        {details && details.characters.length > 0 ? (
          <DataRow>
            <span className="text-base-content/60">Characters</span>
            <span data-print-characters>
              {details.characters.map((name) => `@${name}`).join(", ")}
            </span>
          </DataRow>
        ) : null}
        {details && details.references.length > 0 ? (
          <DataRow>
            <span className="text-base-content/60">
              References ({details.references.length})
            </span>
            <ul className="prints-info-references" data-print-references>
              {details.references.map((reference, index) => {
                const name = reference.path.split("/").at(-1);
                const thumbnail = referenceImages.find(
                  (entry) => entry.path === reference.path,
                );
                return (
                  <li
                    key={`${String(index)}:${reference.path}`}
                    title={reference.path}
                  >
                    {thumbnail ? <img src={thumbnail.url} alt={name} /> : name}
                  </li>
                );
              })}
            </ul>
          </DataRow>
        ) : null}
        {details ? (
          <DataRow>
            <span className="text-base-content/60">Made</span>
            <span>{madeAt.format(details.print.createdAt)}</span>
          </DataRow>
        ) : null}
      </DataList>
      {lineage && image.source.kind === "computer" ? (
        <div className="prints-info-actions" role="group" aria-label="Iterate">
          <Button
            disabled={style.isPending}
            onClick={() => {
              setRefusal(onIterate("reuse", lineage));
            }}
          >
            <RotateCcw aria-hidden="true" size={16} />
            Reuse
          </Button>
          <Button
            disabled={style.isPending}
            onClick={() => {
              setRefusal(onIterate("remix", lineage));
            }}
          >
            <Shuffle aria-hidden="true" size={16} />
            Remix
          </Button>
          {canAnimate && lineage.kind === "image" ? (
            <Button
              disabled={style.isPending}
              onClick={() => {
                setRefusal(onIterate("animate", lineage));
              }}
            >
              <Clapperboard aria-hidden="true" size={16} />
              Animate
            </Button>
          ) : null}
        </div>
      ) : null}
      {refusal ? (
        <p role="alert" className="text-sm">
          {refusal}
        </p>
      ) : null}
      <Button
        onClick={download.start}
        disabled={download.disabled}
        aria-busy={download.preparing || download.isPending}
      >
        <Download aria-hidden="true" size={16} />
        {download.preparing
          ? "Preparing download…"
          : download.isPending
            ? "Downloading…"
            : "Download"}
      </Button>
      {failure ? (
        <p role="alert" className="text-sm">
          {failure.title}. {failure.message}
        </p>
      ) : null}
    </Surface>
  );
}
