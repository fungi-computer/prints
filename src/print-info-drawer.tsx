import { useEffect, useRef } from "react";
import type {
  AppRoot,
  AppBrowserAction,
  AppBrowserActionOutcome,
} from "@fungi.computer/agar";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@fungi.computer/caps/components/button";
import { IconButton } from "@fungi.computer/caps/components/icon-button";
import { Surface } from "@fungi.computer/caps/components/surface";
import { DataList, DataRow } from "@fungi.computer/caps/components/data-list";
import { Download, X } from "lucide-react";
import type { GalleryImage, GallerySource } from "./media-gallery.js";
import {
  preparePrintDownload,
  describePrintDownloadError,
  describePrintDownloadRefusal,
} from "./prints-download.js";
import { reportCatchFailure } from "./log-event.js";

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
  onClose,
}: {
  image: GalleryImage;
  app: AppRoot | null;
  onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const download = usePrintDownload(image.source, app);
  const failure = download.failure;
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
            {image.width} × {image.height}
          </span>
        </DataRow>
      </DataList>
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
