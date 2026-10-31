import { useEffect, useRef } from "react";
import type {
  AppRoot,
  AppBrowserAction,
  AppBrowserActionOutcome,
} from "@fungi.computer/agar";
import { useMutation } from "@tanstack/react-query";
import { KeycapButton } from "@fungi.computer/caps/components/keycap";
import { Download } from "lucide-react";
import type { GallerySource } from "./media-gallery.js";
import {
  preparePrintDownload,
  describePrintDownloadError,
  describePrintDownloadRefusal,
} from "./prints-download.js";
import { reportCatchFailure } from "./log-event.js";

/** Prepare stripped bytes ahead of the click; retain host-save activation. */
export function PrintDownloadButton({
  source,
  app,
}: {
  source: GallerySource;
  app: AppRoot | null;
}) {
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
  return (
    <>
      <KeycapButton
        type="button"
        label="Download"
        title={
          preparing
            ? "Preparing download…"
            : download.isPending
              ? "Downloading…"
              : "Download"
        }
        disabled={!preparation.data || download.isPending}
        aria-busy={preparing || download.isPending}
        icon={<Download size={16} aria-hidden="true" />}
        onClick={() => {
          if (
            preparation.data &&
            !download.isPending &&
            !active.current?.signal.aborted
          ) {
            // Start the host request in the click, before mutation bookkeeping
            // can yield or disable the focused button.
            const outcome = app
              ? app.ui.requestBrowserAction(preparation.data)
              : Promise.resolve<AppBrowserActionOutcome>({
                  kind: "refused",
                  reason: "unavailable",
                });
            download.mutate(outcome);
          }
        }}
      />
      {failure ? (
        <p role="alert" className="text-sm">
          {failure.title}. {failure.message}
        </p>
      ) : null}
    </>
  );
}
