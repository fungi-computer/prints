import { useEffect, useRef, useState, type ReactNode } from "react";
import type { AppRoot } from "@fungi.computer/agar";
import { useQuery } from "@tanstack/react-query";
import { capabilityQuery, queryKeys } from "@fungi.computer/agar/query";
import { appMethods } from "@fungi.computer/agar/backend";
import * as z from "zod";
import { printStyleQuery } from "./media-queries.js";
import { KeycapButton } from "@fungi.computer/caps/components/keycap";
import { IconButton } from "@fungi.computer/caps/components/icon-button";
import { Surface } from "@fungi.computer/caps/components/surface";
import { DataList, DataRow } from "@fungi.computer/caps/components/data-list";
import { Sigil, type SigilName } from "@fungi.computer/sigils";
import { Clapperboard, RotateCcw, Shuffle, X } from "lucide-react";
import type { Iteration, PrintLineage } from "./print-iteration.js";
import {
  isReferenceOnComputer,
  modelFor,
  modelName,
  type MediaModel,
} from "./generation-model.js";
import type { GalleryImage } from "./media-gallery.js";
import { PrintDownloadButton } from "./print-download-button.js";

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
  references: z.array(
    z.object({ path: z.string(), computerId: z.string().optional() }),
  ),
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

/** One fact row: a fixed label column (Sigil and name) and a wrapping value. */
function Fact({
  sigil,
  label,
  children,
}: {
  sigil: SigilName;
  label: string;
  children: ReactNode;
}) {
  return (
    <DataRow>
      <span className="prints-info-label">
        <Sigil name={sigil} size={16} />
        {label}
      </span>
      <span className="prints-info-value">{children}</span>
    </DataRow>
  );
}

/** Keeps a long file name's extension in view; the middle gives way first. */
function FileName({ name }: { name: string }) {
  const tail = name.length > fileNameTail ? name.slice(-fileNameTail) : "";
  return (
    <span className="prints-info-file" title={name} data-print-file>
      <span className="prints-info-file-head">
        {name.slice(0, name.length - tail.length)}
      </span>
      {tail ? <span className="prints-info-file-tail">{tail}</span> : null}
    </span>
  );
}
const fileNameTail = 10;

/** One non-modal information panel owns file actions; tiles stay uncluttered. */
export function PrintInfoDrawer({
  image,
  app,
  download = <PrintDownloadButton source={image.source} app={app} />,
  referenceImages,
  models,
  canAnimate,
  onIterate,
  onClose,
}: {
  image: GalleryImage;
  app: AppRoot | null;
  /** A viewer can place Download outside this panel; null leaves it out here. */
  download?: ReactNode;
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
      <DataList density="compact" className="prints-info-facts">
        <Fact sigil="list" label="File">
          <FileName name={image.file.name} />
        </Fact>
        <Fact sigil="prints" label="Size">
          {image.width} × {image.height} · {aspectOf(image.width, image.height)}
        </Fact>
        {style.data?.style ? (
          <Fact sigil="write" label="Style">
            {style.data.style}
          </Fact>
        ) : null}
        {details ? (
          <Fact sigil="sendPrompts" label="Prompt">
            <span className="whitespace-pre-wrap" data-print-prompt>
              {details.typed.prompt}
            </span>
          </Fact>
        ) : null}
        {details ? (
          <Fact sigil="generateMedia" label="Model">
            <span data-print-model>
              {recordedModel
                ? modelName(recordedModel)
                : `${details.print.model} (no longer available)`}
            </span>
          </Fact>
        ) : null}
        {details && details.characters.length > 0 ? (
          <Fact sigil="members" label="Characters">
            <span data-print-characters>
              {details.characters.map((name) => `@${name}`).join(", ")}
            </span>
          </Fact>
        ) : null}
        {details && details.references.length > 0 ? (
          <Fact sigil="read" label="References">
            <ul
              className="prints-info-references"
              data-print-references
              aria-label={`${String(details.references.length)} references`}
            >
              {details.references.map((reference, index) => {
                const name = reference.path.split("/").at(-1);
                const thumbnail =
                  image.source.kind === "computer" &&
                  isReferenceOnComputer(reference, image.source.computerId)
                    ? referenceImages.find(
                        (entry) => entry.path === reference.path,
                      )
                    : undefined;
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
          </Fact>
        ) : null}
        {details ? (
          <Fact sigil="schedule" label="Made">
            {madeAt.format(details.print.createdAt)}
          </Fact>
        ) : null}
      </DataList>
      <div
        className="prints-info-actions"
        role="group"
        aria-label="Image actions"
      >
        {lineage && image.source.kind === "computer" ? (
          <>
            <KeycapButton
              label="Reuse"
              icon={<RotateCcw />}
              disabled={style.isPending}
              onClick={() => {
                setRefusal(onIterate("reuse", lineage));
              }}
            />
            <KeycapButton
              label="Remix"
              icon={<Shuffle />}
              disabled={style.isPending}
              onClick={() => {
                setRefusal(onIterate("remix", lineage));
              }}
            />
            {canAnimate && lineage.kind === "image" ? (
              <KeycapButton
                label="Animate"
                icon={<Clapperboard />}
                disabled={style.isPending}
                onClick={() => {
                  setRefusal(onIterate("animate", lineage));
                }}
              />
            ) : null}
          </>
        ) : null}
        {download}
      </div>
      {refusal ? (
        <p role="alert" className="text-sm">
          {refusal}
        </p>
      ) : null}
    </Surface>
  );
}
