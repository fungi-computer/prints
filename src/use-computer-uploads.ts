import { normalizeUploadFilename } from "./upload-path.js";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AppRoot } from "@fungi.computer/agar";
import { writeComputerFile } from "@fungi.computer/agar/computer";
import { nanoid } from "@fungi.computer/cairn";
import { decodeLocalMedia } from "./local-images.js";
import { reportCatchFailure } from "./log-event.js";

type Upload = {
  computerId: string;
  id: string;
  file: File;
  previewUrl: string;
  dimensions?: { width: number; height: number };
  path: string;
  app: AppRoot;
  status: "queued" | "sending" | "complete" | "error" | "cancelled";
  message: string;
};

/** Media owns queue facts; a lost completion is never reported as a rolled-back write. */
export function useComputerUploads(
  onComplete: (path: string, app: AppRoot, computerId: string) => Promise<void>,
  onPrepared: (upload: {
    id: string;
    path: string;
    computerId: string;
    width: number;
    height: number;
    app: AppRoot;
  }) => void,
) {
  const [items, setItems] = useState<Upload[]>([]);
  const retained = useRef(new Map<string, Upload>());
  const tail = useRef(Promise.resolve());
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(new Map<string, AbortController>());
  const completion = useRef(onComplete);
  completion.current = onComplete;
  const prepared = useRef(onPrepared);
  prepared.current = onPrepared;
  const update = (id: string, status: Upload["status"], message: string) => {
    const row = retained.current.get(id);
    if (row) retained.current.set(id, { ...row, status, message });
    setItems([...retained.current.values()]);
  };
  const start = useCallback(
    async (item: Upload, controller: AbortController) => {
      const isCancelled = () => controller.signal.aborted;
      if (isCancelled()) {
        update(item.id, "cancelled", "Cancelled before sending");
        pending.current.delete(item.id);
        return;
      }
      let image = item.dimensions;
      if (!image) {
        try {
          const decoded = await decodeLocalMedia(item.file, item.previewUrl);
          image = { width: decoded.width, height: decoded.height };
          item.dimensions = image;
          const row = retained.current.get(item.id);
          if (row) retained.current.set(item.id, { ...row, dimensions: image });
        } catch (cause) {
          reportCatchFailure("decode-upload-image", cause);
          update(
            item.id,
            "error",
            "Could not decode this image. No upload was sent.",
          );
          pending.current.delete(item.id);
          return;
        }
      }
      try {
        if (isCancelled()) {
          update(item.id, "cancelled", "Cancelled before sending");
          return;
        }
        // Reconfiguration replaces capabilities on the same AppRoot. A retained
        // upload must not acquire another Computer's writer after image decoding.
        if (item.app.context.get().computerId !== item.computerId) {
          update(
            item.id,
            "error",
            "Computer changed. Select the original Computer and retry. No upload was sent.",
          );
          return;
        }
        prepared.current({
          id: item.id,
          path: item.path,
          computerId: item.computerId,
          app: item.app,
          width: image.width,
          height: image.height,
        });
        update(item.id, "sending", "Sending; awaiting Computer completion");
        // Agar sends the native file stream; File subclass stays local.
        await writeComputerFile(
          item.app.capabilities,
          { path: item.path, content: item.file.slice() },
          { signal: controller.signal },
        );
        update(item.id, "complete", "Written to Computer");
        try {
          await completion.current(item.path, item.app, item.computerId);
        } catch (cause) {
          reportCatchFailure("refresh-upload-preview", cause);
          update(item.id, "complete", "Written; fresh preview unavailable");
        }
      } catch (cause) {
        if (!isCancelled()) reportCatchFailure("write-computer-upload", cause);
        update(
          item.id,
          isCancelled() ? "cancelled" : "error",
          isCancelled()
            ? "Cancelled request; check Computer before retrying"
            : "Completion not confirmed; check Computer or retry",
        );
      } finally {
        pending.current.delete(item.id);
      }
    },
    [],
  );
  const enqueue = (item: Upload) => {
    const controller = new AbortController();
    pending.current.set(item.id, controller);
    update(item.id, "queued", "Queued");
    tail.current = tail.current.then(() => start(item, controller));
  };
  const cancelAll = useCallback(() => {
    for (const controller of pending.current.values()) controller.abort();
  }, []);
  useEffect(
    () => () => {
      cancelAll();
      for (const item of retained.current.values())
        URL.revokeObjectURL(item.previewUrl);
    },
    [cancelAll],
  );
  return {
    items,
    error,
    cancelAll,
    add(files: readonly File[], directory: string, app: AppRoot) {
      setError(null);
      let retainedBytes = [...retained.current.values()].reduce(
        (sum, row) => sum + row.file.size,
        0,
      );
      for (const file of files) {
        if (!file.type.startsWith("image/")) {
          setError("Only image files can be uploaded here");
          continue;
        }
        if (
          retained.current.size >= 8 ||
          retainedBytes + file.size > 64 * 1024 * 1024
        ) {
          setError(
            "Upload queue limit: eight files and 64 MiB. Remove finished rows before adding more.",
          );
          break;
        }
        const computerId = app.context.get().computerId;
        if (!computerId) {
          setError("Select a Computer before uploading images.");
          continue;
        }
        const path = `${directory.replace(/\/$/, "")}/upload-${nanoid(8)}-${normalizeUploadFilename(file.name)}`;
        if (retained.current.has(path)) {
          setError(
            "This path is already in the queue. Retry or remove its existing row.",
          );
          continue;
        }
        const row: Upload = {
          computerId,
          id: path,
          file,
          previewUrl: URL.createObjectURL(file),
          app,
          path,
          status: "queued",
          message: "Queued",
        };
        retained.current.set(row.id, row);
        retainedBytes += file.size;
        enqueue(row);
      }
    },
    cancel(id: string) {
      pending.current.get(id)?.abort();
    },
    retry(id: string) {
      const item = items.find((row) => row.id === id);
      if (item && !pending.current.has(id)) enqueue(item);
    },
    remove(id: string) {
      if (!pending.current.has(id)) {
        const item = retained.current.get(id);
        if (item) URL.revokeObjectURL(item.previewUrl);
        retained.current.delete(id);
        setItems([...retained.current.values()]);
      }
    },
  };
}
