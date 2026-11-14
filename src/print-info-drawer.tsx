import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { AppRoot } from "@fungi.computer/agar";
import { useQuery } from "@tanstack/react-query";
import { capabilityQuery, queryKeys } from "@fungi.computer/agar/query";
import { appMethods } from "@fungi.computer/agar/backend";
import * as z from "zod";
import { printStyleQuery } from "./media-queries.js";
import { reportCatchFailure } from "./log-event.js";
import { KeycapButton } from "@fungi.computer/caps/components/keycap";
import { IconButton } from "@fungi.computer/caps/components/icon-button";
import { Surface } from "@fungi.computer/caps/components/surface";
import { DataList, DataRow } from "@fungi.computer/caps/components/data-list";
import {
  Check,
  ChevronDown,
  ChevronUp,
  CircleDollarSign,
  Clapperboard,
  Clock,
  Copy,
  Cpu,
  FileImage,
  FolderInput,
  Heart,
  Images,
  MessageSquareText,
  Palette,
  RotateCcw,
  Ruler,
  Shuffle,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import type { Iteration, PrintLineage } from "./print-iteration.js";
import {
  isReferenceOnComputer,
  modelFor,
  modelName,
  type MediaModel,
} from "./generation-model.js";
import type { GalleryImage } from "./media-gallery.js";
import { isAudioPath } from "./audio-media.js";
import { formatDuration } from "./audio-waveform.js";
import { formatPrintCost } from "./print-cost.js";
import { PrintShareRows } from "./print-share.js";
import { mediaShare } from "@fungi.computer/agar/media";

const PrintDownloadButton = lazy(async () => {
  const module = await import("./print-download-button.js");
  return { default: module.PrintDownloadButton };
});

// Only the generation facts the drawer shows; getOutput's owner validates the rest.
const outputDetailsSchema = z.object({
  print: z.object({
    printId: z.string(),
    source: z.enum(["recorded", "file"]),
    kind: z.enum(["image", "video", "audio"]),
    model: z.string(),
    width: z.number().nullable(),
    height: z.number().nullable(),
    steps: z.number().nullable(),
    durationSeconds: z.number().nullable().optional(),
    /** What the generation was charged, as metered when it completed. */
    costMilliunits: z.number(),
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

const kindNames = { image: "Image", video: "Video", audio: "Audio" } as const;

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

/** One fact row: a fixed label column (icon and name) and a wrapping value. */
function Fact({
  icon: Icon,
  label,
  children,
}: {
  icon: LucideIcon;
  label: string;
  children: ReactNode;
}) {
  return (
    <DataRow>
      <span className="prints-info-label">
        <Icon size={16} aria-hidden />
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
/** A prompt longer than this starts folded to a few lines. */
const promptFoldCharacters = 240;

/** The prompt as typed, with Copy, and Show more for a long one. */
function PromptText({ prompt }: { prompt: string }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const long = prompt.length > promptFoldCharacters;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
      }, 1_500);
    } catch (cause) {
      reportCatchFailure("copy-print-prompt", cause);
    }
  };
  return (
    <span className="prints-info-prompt">
      <span
        className="whitespace-pre-wrap"
        data-print-prompt
        data-folded={long && !expanded ? true : undefined}
      >
        {prompt}
      </span>
      <span className="prints-info-prompt-tools">
        <button
          type="button"
          className="prints-info-link"
          onClick={() => {
            void copy();
          }}
        >
          {copied ? (
            <Check aria-hidden size={14} />
          ) : (
            <Copy aria-hidden size={14} />
          )}{" "}
          {copied ? "Copied" : "Copy"}
        </button>
        {long ? (
          <button
            type="button"
            className="prints-info-link"
            aria-expanded={expanded}
            onClick={() => {
              setExpanded(!expanded);
            }}
          >
            {expanded ? (
              <ChevronUp aria-hidden size={14} />
            ) : (
              <ChevronDown aria-hidden size={14} />
            )}{" "}
            {expanded ? "Show less" : "Show more"}
          </button>
        ) : null}
      </span>
    </span>
  );
}

/** One non-modal information panel owns file actions; tiles stay uncluttered. */
export function PrintInfoDrawer({
  image,
  app,
  download = (
    <Suspense fallback={null}>
      <PrintDownloadButton source={image.source} app={app} />
    </Suspense>
  ),
  referenceImages,
  models,
  canAnimate,
  onIterate,
  library,
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
  /** Library actions for this file, when the Library is open. */
  library?: Readonly<{
    favorite: boolean;
    onToggleFavorite: () => void;
    onMove: (() => void) | undefined;
  }>;
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
    ? lineageOf(
        details,
        isAudioPath(image.file.name) ? null : (style.data?.style ?? null),
      )
    : null;
  const cost = details ? formatPrintCost(details.print.costMilliunits) : null;
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
        <div className="prints-info-title">
          <h2 className="text-base font-semibold" title={image.file.name}>
            {image.file.name.replace(/\.[^.]+$/, "")}
          </h2>
          <span className="prints-info-subtitle">
            {details
              ? `${kindNames[details.print.kind]} · ${madeAt.format(details.print.createdAt)}`
              : "Image info"}
          </span>
        </div>
        <IconButton
          aria-label="Close image information"
          icon={<X />}
          onClick={onClose}
        />
      </div>
      <DataList density="compact" className="prints-info-facts">
        <Fact icon={FileImage} label="File">
          <FileName name={image.file.name} />
        </Fact>
        {isAudioPath(image.file.name) ? null : (
          <Fact icon={Ruler} label="Size">
            {image.width} × {image.height} ·{" "}
            {aspectOf(image.width, image.height)}
          </Fact>
        )}
        {style.data?.style && !isAudioPath(image.file.name) ? (
          <Fact icon={Palette} label="Style">
            {style.data.style}
          </Fact>
        ) : null}
        {details ? (
          <Fact icon={MessageSquareText} label="Prompt">
            <PromptText prompt={details.typed.prompt} />
          </Fact>
        ) : null}
        {details ? (
          <Fact icon={Cpu} label="Model">
            <span data-print-model>
              {recordedModel
                ? modelName(recordedModel)
                : `${details.print.model} (no longer available)`}
            </span>
          </Fact>
        ) : null}
        {details && details.characters.length > 0 ? (
          <Fact icon={Users} label="Characters">
            <span data-print-characters>
              {details.characters.map((name) => `@${name}`).join(", ")}
            </span>
          </Fact>
        ) : null}
        {details && details.references.length > 0 ? (
          <Fact icon={Images} label="References">
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
        {details != null &&
        details.print.kind !== "image" &&
        details.print.durationSeconds != null ? (
          <Fact icon={Clock} label="Duration">
            <span data-print-duration>
              {formatDuration(details.print.durationSeconds)}
            </span>
          </Fact>
        ) : null}
        {details?.print.source === "recorded" && cost !== null ? (
          <Fact icon={CircleDollarSign} label="Cost">
            <span data-print-cost>{cost}</span>
          </Fact>
        ) : null}
        {details ? (
          <Fact icon={Clock} label="Made">
            {madeAt.format(details.print.createdAt)}
          </Fact>
        ) : null}
        {app &&
        details?.print.source === "recorded" &&
        app.capabilities.has(mediaShare) ? (
          <PrintShareRows app={app} printId={details.print.printId} />
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
            {lineage.kind === "audio" ? null : (
              <KeycapButton
                label="Remix"
                icon={<Shuffle />}
                disabled={style.isPending}
                onClick={() => {
                  setRefusal(onIterate("remix", lineage));
                }}
              />
            )}
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
        {library ? (
          <>
            <KeycapButton
              label={library.favorite ? "Unfavorite" : "Favorite"}
              icon={<Heart />}
              onClick={library.onToggleFavorite}
            />
            {library.onMove ? (
              <KeycapButton
                label="Move to…"
                icon={<FolderInput />}
                onClick={library.onMove}
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
