import type { AppRoot } from "@fungi.computer/agar";
import { useComputerId } from "@fungi.computer/agar/react";
import {
  computerList,
  computerReadFile,
  computerWriteFile,
  readComputerFile,
} from "@fungi.computer/agar/computer";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { decodeLocalMedia, type LocalImage } from "./local-images.js";
import type { GallerySlot } from "./gallery-slots.js";
import type { useMediaFolder } from "./media-folder.js";
import { useMediaGallery } from "./media-gallery-query.js";
import { useComputerUploads } from "./use-computer-uploads.js";
import { reportCatchFailure } from "./log-event.js";

export type MediaConnection = { app: AppRoot };
export type GallerySource =
  | { kind: "local"; file: File }
  | {
      kind: "computer";
      computerId: string;
      file: File;
      path: string;
      connection: MediaConnection;
    };

export type GalleryImage = LocalImage & { source: GallerySource };

/** Gallery identity survives replacement of the file bytes and blob URL. */
export function galleryImageKey(image: GalleryImage): string {
  return image.source.kind === "computer"
    ? `${image.source.computerId}:${image.source.path}`
    : image.file.name;
}

/** Editing is an explicit viewer action, not a side effect of selecting a tile. */
export function openInInkcap(
  source: Extract<GallerySource, { kind: "computer" }>,
): Promise<void> {
  return source.connection.app.ui.openNavigation({
    computerId: source.computerId,
    path: source.path,
  });
}

export function useGalleryMedia(
  connection: MediaConnection | null,
  folder: ReturnType<typeof useMediaFolder>,
) {
  const mediaDirectory = folder.path;
  const computerId = useComputerId(connection?.app);
  const reads = useRef(new Set<AbortController>());
  const readGeneration = useRef(0);
  const connectionRef = useRef(connection);
  connectionRef.current = connection;
  const canBrowse = connection?.app.capabilities.has(computerList) === true;
  const canRead = connection?.app.capabilities.has(computerReadFile) === true;
  const canWrite = connection?.app.capabilities.has(computerWriteFile) === true;
  const gallery = useMediaGallery(connection, folder.galleryPath);
  const [files, setFiles] = useState<GallerySource[]>([]);
  const [images, setImages] = useState<GalleryImage[]>([]);
  const [failed, setFailed] = useState<string[]>([]);
  const [gallerySlots, setGallerySlots] = useState<GallerySlot[]>([]);
  useEffect(() => {
    setGallerySlots([]);
  }, [connection]);
  const reserveSlot = (slot: GallerySlot) => {
    setGallerySlots((current) =>
      current.some((entry) => entry.key === slot.key)
        ? current.map((entry) => (entry.key === slot.key ? slot : entry))
        : [...current, slot],
    );
  };
  const [loading, setLoading] = useState(false);
  const galleryReadFailures = useMemo(
    () => [
      ...(gallery.error ? ["Could not refresh the Media gallery"] : []),
      ...gallery.failures,
    ],
    [gallery.error, gallery.failures],
  );
  const decodedSizes = useRef(
    new WeakMap<File, Promise<{ width: number; height: number }>>(),
  );
  const galleryFiles = useMemo(() => {
    if (!canRead || !canBrowse)
      return files.filter((source) => source.kind === "local");
    const listed: GallerySource[] = computerId
      ? gallery.files.map(({ file, path }) => ({
          kind: "computer",
          computerId,
          connection,
          file,
          path,
        }))
      : [];
    const added = files.filter(
      (source) =>
        source.kind === "local" ||
        (source.computerId === computerId &&
          source.connection === connection &&
          source.path.slice(0, source.path.lastIndexOf("/")) ===
            mediaDirectory?.replace(/\/$/, "")),
    );
    return [
      ...listed.filter(
        (entry) =>
          !added.some(
            (source) =>
              source.kind === "computer" &&
              entry.kind === "computer" &&
              source.path === entry.path,
          ),
      ),
      ...added,
    ];
  }, [
    connection,
    computerId,
    mediaDirectory,
    gallery.files,
    files,
    canRead,
    canBrowse,
  ]);
  const invalidateReads = useCallback(() => {
    readGeneration.current += 1;
    for (const reader of reads.current) reader.abort();
    reads.current.clear();
  }, []);
  useEffect(() => {
    if (!connection)
      return () => {
        invalidateReads();
      };
    const unsubscribe = connection.app.lifecycle.subscribe((state) => {
      if (
        state === "disconnected" ||
        state === "disposing" ||
        state === "disposed"
      )
        invalidateReads();
    });
    return () => {
      unsubscribe();
      invalidateReads();
    };
  }, [connection, invalidateReads]);
  // Cancel at the context boundary, before React commits the new selection.
  // UI snapshots belong to useComputerId; in-flight reads must stop immediately.
  useEffect(() => {
    if (!connection) return;
    return connection.app.context.subscribe((context) => {
      if (context.computerId !== computerId) invalidateReads();
    });
  }, [connection, computerId, invalidateReads]);
  useEffect(() => {
    setGallerySlots([]);
    setFiles((current) => current.filter((source) => source.kind === "local"));
  }, [computerId]);
  const addComputerFile = useCallback(
    async (
      path: string,
      selectedConnection: MediaConnection,
      selectedComputerId?: string,
    ) => {
      const capturedComputerId =
        selectedComputerId ?? selectedConnection.app.context.get().computerId;
      if (!capturedComputerId) {
        setFailed(["The selected Computer is unavailable"]);
        return;
      }
      if (connectionRef.current !== selectedConnection) {
        setFailed(["Computer selection changed"]);
        return;
      }
      if (
        selectedConnection.app.context.get().computerId !== capturedComputerId
      ) {
        setFailed(["Computer selection changed before the preview was loaded"]);
        return;
      }
      const captured = readGeneration.current;
      const controller = new AbortController();
      reads.current.add(controller);
      try {
        const file = await readComputerFile(
          selectedConnection.app.capabilities,
          { path },
          { signal: controller.signal },
        );
        if (controller.signal.aborted || captured !== readGeneration.current)
          return;
        setGallerySlots((slots) =>
          slots.map((slot) =>
            slot.key === `${capturedComputerId}:${path}`
              ? { ...slot, previewFile: file }
              : slot,
          ),
        );
        setFiles((current) => [
          ...current.filter(
            (entry) =>
              entry.kind !== "computer" ||
              entry.path !== path ||
              entry.computerId !== capturedComputerId,
          ),
          {
            kind: "computer",
            computerId: capturedComputerId,
            file,
            path,
            connection: selectedConnection,
          },
        ]);
      } catch (cause) {
        if (!controller.signal.aborted) {
          reportCatchFailure("read-computer-file", cause);
          setFailed([`Could not read ${path}`]);
          setGallerySlots((slots) =>
            slots.map((slot) =>
              slot.key === `${capturedComputerId}:${path}`
                ? {
                    ...slot,
                    error: "Saved; preview unavailable. Retry loading it.",
                  }
                : slot,
            ),
          );
        }
      } finally {
        reads.current.delete(controller);
      }
    },
    [],
  );
  const retryFile = useCallback(
    (path: string) => {
      const added = files.find(
        (source) =>
          source.kind === "computer" &&
          source.connection === connection &&
          source.computerId === computerId &&
          source.path === path,
      );
      if (added?.kind === "computer")
        void addComputerFile(path, added.connection, added.computerId);
      else gallery.retryFile(path);
    },
    [files, connection, computerId, addComputerFile, gallery.retryFile],
  );

  const ownedUrls = useRef(new Set<string>());
  const displayedUrls = useRef(new Set<string>());
  const revokeUrl = useCallback((url: string) => {
    URL.revokeObjectURL(url);
    ownedUrls.current.delete(url);
  }, []);
  useEffect(() => {
    let active = true;
    const published = new Set<string>();
    const decoded = new Map<number, GalleryImage>();
    const failures = new Set<string>();
    const selected = [...galleryFiles]
      .sort(
        (a, b) =>
          b.file.lastModified - a.file.lastModified ||
          a.file.name.localeCompare(b.file.name),
      )
      .map((source) => {
        const url = URL.createObjectURL(source.file);
        ownedUrls.current.add(url);
        return { source, file: source.file, url };
      });
    let pending = selected.length;
    setFailed(galleryReadFailures);
    setLoading(pending > 0);
    if (pending === 0) setImages([]);
    selected.forEach(({ file, url, source }, index) => {
      let dimensions = decodedSizes.current.get(file);
      if (!dimensions) {
        dimensions = (async () => {
          const decodingUrl = URL.createObjectURL(file);
          try {
            const { width, height } = await decodeLocalMedia(file, decodingUrl);
            return { width, height };
          } finally {
            URL.revokeObjectURL(decodingUrl);
          }
        })();
        decodedSizes.current.set(file, dimensions);
      }
      void dimensions
        .then((size) => {
          if (!active) return;
          decoded.set(index, { ...size, file, url, source });
          published.add(url);
          setImages(
            selected.flatMap((_, position) => {
              const image = decoded.get(position);
              return image ? [image] : [];
            }),
          );
          setGallerySlots((slots) =>
            slots.map((slot) =>
              slot.previewFile === file
                ? {
                    ...slot,
                    resolved: true,
                    previewFile: undefined,
                    error: undefined,
                  }
                : slot,
            ),
          );
        })
        .catch((cause: unknown) => {
          if (!active) return;
          reportCatchFailure("decode-gallery-image", cause);
          revokeUrl(url);
          failures.add(file.name);
          setFailed([...galleryReadFailures, ...failures]);
          if (source.kind === "computer")
            setGallerySlots((slots) =>
              slots.map((slot) =>
                slot.key === `${source.computerId}:${source.path}`
                  ? { ...slot, error: "Could not decode the saved image." }
                  : slot,
              ),
            );
        })
        .finally(() => {
          pending -= 1;
          if (active && pending === 0) {
            setLoading(false);
            setImages(
              selected.flatMap((_, position) => {
                const image = decoded.get(position);
                return image ? [image] : [];
              }),
            );
          }
        });
    });
    return () => {
      active = false;
      for (const { url } of selected) if (!published.has(url)) revokeUrl(url);
    };
  }, [galleryFiles, galleryReadFailures, revokeUrl]);
  // Partial updates retain their displayed URLs; only displaced images retire.
  useEffect(() => {
    const next = new Set(images.map((image) => image.url));
    for (const url of displayedUrls.current) if (!next.has(url)) revokeUrl(url);
    displayedUrls.current = next;
  }, [images, revokeUrl]);
  useEffect(() => {
    const urls = ownedUrls.current;
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);
  const uploads = useComputerUploads(
    async (path, app, computerId) => {
      const current = connectionRef.current;
      const selected =
        current?.app === app && app.context.get().computerId === computerId
          ? current
          : null;
      if (selected) {
        await addComputerFile(path, selected, computerId);
      }
    },
    (upload) => {
      if (
        connectionRef.current?.app !== upload.app ||
        upload.app.context.get().computerId !== upload.computerId
      )
        return;
      reserveSlot({
        key: `${upload.computerId}:${upload.path}`,
        path: upload.path,
        computerId: upload.computerId,
        width: upload.width,
        height: upload.height,
        uploadId: upload.id,
      });
    },
  );
  useEffect(() => {
    const cancel = uploads.cancelAll;
    const unsubscribe = connection?.app.lifecycle.subscribe((state) => {
      if (
        state === "disposing" ||
        state === "disconnected" ||
        state === "disposed"
      )
        cancel();
    });
    return () => {
      unsubscribe?.();
      cancel();
    };
  }, [connection, uploads.cancelAll]);
  const uploadFiles = async (selected: readonly File[]) => {
    if (!connection || !canWrite || mediaDirectory === null) return;
    const captured = connection;
    const id = computerId;
    const error = await folder.ensureCreated();
    if (error) {
      setFailed([error]);
      return;
    }
    if (
      connectionRef.current !== captured ||
      captured.app.context.get().computerId !== id
    )
      return;
    uploads.add(selected, mediaDirectory, captured.app);
  };
  return {
    images,
    failed,
    loading,
    gallery,
    gallerySlots,
    canBrowse,
    canRead,
    canWrite,
    reserveSlot,
    addComputerFile,
    retryFile,
    uploads,
    uploadFiles,
    failSlot: (key: string, error: string) => {
      setGallerySlots((slots) =>
        slots.map((slot) => (slot.key === key ? { ...slot, error } : slot)),
      );
    },
    clearSlotError: (key: string) => {
      setGallerySlots((slots) =>
        slots.map((slot) =>
          slot.key === key ? { ...slot, error: undefined } : slot,
        ),
      );
    },
    removeSlot: (key: string) => {
      setGallerySlots((slots) => slots.filter((slot) => slot.key !== key));
    },
  };
}
