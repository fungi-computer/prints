import { useEffect, useRef, useState, type ReactNode } from "react";
import type { AppRoot } from "@fungi.computer/agar";
import {
  Dialog,
  DialogBackdrop,
  DialogPopup,
  DialogPortal,
  DialogTitle,
} from "@fungi.computer/caps/components/dialog";
import { Display, ScreenHeader } from "@fungi.computer/caps/components/surface";
import { IconButton } from "@fungi.computer/caps/components/icon-button";
import { KeycapButton } from "@fungi.computer/caps/components/keycap";
import { Loader } from "@fungi.computer/caps/components/loader";
import { GenerationFrame } from "@fungi.computer/caps/components/generation-frame";
import { ScrollArea } from "@fungi.computer/caps/components/scroll-area";
import { Status } from "@fungi.computer/caps/components/status";
import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  Info,
  Maximize,
  RotateCcw,
  X,
} from "lucide-react";
import type { MediaMasonryItem } from "./media-masonry.js";
import {
  galleryImageKey,
  openInInkcap,
  type GalleryImage,
  type GallerySource,
} from "./media-gallery.js";
import { PrintDownloadButton } from "./print-download-button.js";
import {
  resolveViewerKey,
  step,
  viewerSequence,
} from "./print-viewer-model.js";
import { isVideoPath } from "./local-images.js";
import { reportCatchFailure } from "./log-event.js";

function ViewerVideo({
  url,
  path,
  onError,
  autoPlay,
}: {
  url: string;
  path: string;
  onError: (url: string) => void;
  autoPlay: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    let disposed = false;
    if (autoPlay)
      void video.play().catch((cause: unknown) => {
        if (
          disposed ||
          (cause instanceof DOMException &&
            (cause.name === "NotAllowedError" || cause.name === "AbortError"))
        )
          return;
        reportCatchFailure("play-print-video", cause);
        onError(url);
      });
    return () => {
      disposed = true;
      video.pause();
    };
  }, [url, onError, autoPlay]);
  return (
    <video
      ref={ref}
      src={url}
      aria-label={path}
      controls
      playsInline
      preload="auto"
      className="block max-h-full max-w-full object-contain"
      onError={() => {
        onError(url);
      }}
    />
  );
}

/** Render state belongs to one visit, not the mounted gallery's URL lifetime. */
function PrintStage({
  item,
  actualSize,
}: {
  item: MediaMasonryItem;
  actualSize: boolean;
}) {
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  // Like the wall, a reservation has no read-admission callback. Waiting for
  // its result is not a new gesture, even when the shared key receives a URL.
  const generating = item.pending === true && !item.onVisible;
  const [awaitedGeneration, setAwaitedGeneration] = useState(generating);
  if (generating && !awaitedGeneration) setAwaitedGeneration(true);
  const pendingLabel = item.pendingLabel ?? "Loading print…";
  const picture = (
    <img
      key={item.url}
      src={item.url}
      alt={item.path}
      decoding="async"
      width={actualSize ? item.width : undefined}
      height={actualSize ? item.height : undefined}
      className={
        actualSize
          ? "block max-w-none"
          : "block max-h-full max-w-full object-contain"
      }
      onLoad={() => {
        setLoadedUrl(item.url);
      }}
      onError={() => {
        setFailedUrl(item.url);
      }}
    />
  );
  return (
    <div
      className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden"
      data-print-viewer-stage
    >
      {item.error || failedUrl === item.url ? (
        <GenerationFrame
          status="failed"
          className="h-full w-full"
          failure={
            <div className="flex max-w-full flex-col items-center gap-sm px-md text-center">
              <Status
                tone="error"
                appearance="chip"
                glyph="bang"
                label={generating ? "Not saved" : "Prints can't show this file"}
              />
              <p className="max-w-full break-words text-sm">{item.path}</p>
              {item.error ? <p className="text-sm">{item.error}</p> : null}
              {item.onRetry ? (
                <IconButton
                  aria-label="Retry print"
                  title="Retry print"
                  icon={<RotateCcw />}
                  onClick={item.onRetry}
                />
              ) : null}
              {item.onDismiss ? (
                <IconButton
                  aria-label="Dismiss print"
                  title="Dismiss print"
                  icon={<X />}
                  onClick={item.onDismiss}
                />
              ) : null}
            </div>
          }
        />
      ) : isVideoPath(item.path) && item.url ? (
        <ViewerVideo
          url={item.url}
          path={item.path}
          onError={setFailedUrl}
          autoPlay={!awaitedGeneration}
        />
      ) : item.url ? (
        <>
          {actualSize ? (
            <ScrollArea
              className="h-full w-full"
              role="region"
              aria-label="Actual-size print"
              tabIndex={0}
              data-print-viewer-scroll
            >
              {picture}
            </ScrollArea>
          ) : (
            picture
          )}
          {loadedUrl !== item.url ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <Loader label="Loading print" variant="bloom" />
            </div>
          ) : null}
        </>
      ) : (
        <GenerationFrame
          status="generating"
          label={pendingLabel}
          className="h-full w-full"
          indicator={
            <div
              aria-hidden="true"
              className="flex max-w-full flex-col items-center gap-sm px-md text-center"
            >
              <Loader decorative variant="bloom" />
              <p className="text-sm">{pendingLabel}</p>
            </div>
          }
        />
      )}
    </div>
  );
}

function InkcapAction({
  source,
}: {
  source: Extract<GallerySource, { kind: "computer" }>;
}) {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <>
      <KeycapButton
        label="Open in Inkcap"
        icon={<ExternalLink />}
        disabled={pending}
        onClick={() => {
          setPending(true);
          setFailed(false);
          void openInInkcap(source)
            .catch((cause: unknown) => {
              reportCatchFailure("open-print-in-inkcap", cause);
              setFailed(true);
            })
            .finally(() => {
              setPending(false);
            });
        }}
      />
      {failed ? (
        <p role="alert" className="text-sm">
          Could not open {source.path} in Inkcap.
        </p>
      ) : null}
    </>
  );
}

/** One full-window dialog over the current wall, never a snapshot of its URLs. */
export function PrintViewer({
  items,
  images,
  viewerKey,
  app,
  onNavigate,
  onClose,
  renderInfo,
}: {
  items: readonly MediaMasonryItem[];
  images: readonly GalleryImage[];
  viewerKey: string | null;
  app: AppRoot | null;
  onNavigate: (key: string) => void;
  onClose: (lastKey: string) => void;
  renderInfo: (image: GalleryImage, onClose: () => void) => ReactNode;
}) {
  const popup = useRef<HTMLDivElement>(null);
  const sequence = viewerSequence(items);
  const previous = useRef(sequence);
  const key =
    viewerKey === null
      ? null
      : resolveViewerKey(sequence, viewerKey, previous.current);
  useEffect(() => {
    previous.current = sequence;
    if (viewerKey === null || key === viewerKey) return;
    if (key === null) onClose(viewerKey);
    else onNavigate(key);
  }, [sequence, key, viewerKey, onClose, onNavigate]);
  useEffect(() => {
    if (key === null) return;
    const index = items.findIndex((candidate) => candidate.key === key);
    for (const candidate of items.slice(Math.max(0, index - 1), index + 2))
      candidate.onVisible?.();
  }, [items, key]);
  const [infoKey, setInfoKey] = useState<string | null>(null);
  const [actualSizeKey, setActualSizeKey] = useState<string | null>(null);
  useEffect(() => {
    setActualSizeKey(null);
  }, [key]);
  useEffect(() => {
    setInfoKey(null);
  }, [viewerKey]);
  const item = items.find((candidate) => candidate.key === key);
  const image = images.find((candidate) => galleryImageKey(candidate) === key);
  if (!item || key === null) return null;
  const previousKey = step(sequence, key, -1);
  const nextKey = step(sequence, key, 1);
  const name = item.path.split("/").at(-1) ?? item.path;
  const close = () => {
    onClose(key);
  };
  const navigate = (target: string | null) => {
    if (target !== null) onNavigate(target);
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogPortal>
        <DialogBackdrop />
        <DialogPopup
          ref={popup}
          size="fill"
          initialFocus={popup}
          finalFocus={false}
          className="flex min-h-0 flex-col gap-sm"
          onKeyDown={(event) => {
            if (
              event.altKey ||
              event.ctrlKey ||
              event.metaKey ||
              (event.target instanceof HTMLElement &&
                event.target.closest(
                  "input, textarea, select, video, [data-print-viewer-scroll], [contenteditable=true]",
                ))
            )
              return;
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
              event.preventDefault();
              navigate(event.key === "ArrowLeft" ? previousKey : nextKey);
            } else if (event.key.toLowerCase() === "i" && image) {
              event.preventDefault();
              setInfoKey(infoKey === key ? null : key);
            }
          }}
        >
          <Display fit="fill">
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <ScreenHeader
                title={<DialogTitle className="truncate">{name}</DialogTitle>}
                status={
                  <span aria-live="polite" aria-atomic="true">
                    <span className="sr-only">{name}, </span>
                    {sequence.indexOf(key) + 1} of {sequence.length}
                  </span>
                }
              />
              <div className="@container relative flex min-h-0 min-w-0 flex-1">
                <PrintStage
                  key={key}
                  item={item}
                  actualSize={actualSizeKey === key}
                />
                {infoKey === key && image
                  ? renderInfo(image, () => {
                      setInfoKey(null);
                    })
                  : null}
              </div>
            </div>
          </Display>
          <div className="prints-viewer-actions">
            <IconButton
              size="default"
              iconSize="md"
              aria-label="Previous print"
              title="Previous print (Left arrow)"
              aria-keyshortcuts="ArrowLeft"
              icon={<ArrowLeft />}
              disabled={previousKey === null}
              onClick={() => {
                navigate(previousKey);
              }}
            />
            <IconButton
              size="default"
              iconSize="md"
              aria-label="Next print"
              title="Next print (Right arrow)"
              aria-keyshortcuts="ArrowRight"
              icon={<ArrowRight />}
              disabled={nextKey === null}
              onClick={() => {
                navigate(nextKey);
              }}
            />
            <IconButton
              size="default"
              iconSize="md"
              aria-label="Image info"
              title="Image info (I)"
              aria-keyshortcuts="i"
              aria-expanded={infoKey === key}
              icon={<Info />}
              disabled={!image}
              onClick={() => {
                setInfoKey(infoKey === key ? null : key);
              }}
            />
            {!isVideoPath(item.path) ? (
              <IconButton
                size="default"
                iconSize="md"
                aria-label="Actual size"
                title="Actual size"
                aria-pressed={actualSizeKey === key}
                active={actualSizeKey === key}
                icon={<Maximize />}
                disabled={!item.url || Boolean(item.error)}
                onClick={() => {
                  setActualSizeKey(actualSizeKey === key ? null : key);
                }}
              />
            ) : null}
            {image ? (
              <PrintDownloadButton
                key={image.url}
                source={image.source}
                app={app}
              />
            ) : null}
            {image?.source.kind === "computer" ? (
              <InkcapAction key={key} source={image.source} />
            ) : null}
            <IconButton
              size="default"
              iconSize="md"
              aria-label="Close viewer"
              title="Close viewer (Escape)"
              icon={<X />}
              onClick={close}
            />
          </div>
        </DialogPopup>
      </DialogPortal>
    </Dialog>
  );
}
