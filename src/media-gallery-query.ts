import type { AppRoot } from "@fungi.computer/agar";
import { AppError } from "@fungi.computer/agar/errors";
import { useComputerId } from "@fungi.computer/agar/react";
import { capabilityQuery, queryKeys } from "@fungi.computer/agar/query";
import {
  computerList,
  computerReadFile,
  listComputerFiles,
  readComputerFile,
} from "@fungi.computer/agar/computer";
import {
  infiniteQueryOptions,
  useInfiniteQuery,
  useQueries,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { folderOf } from "./library-view.js";
import { listFavorites } from "./library-methods.js";

const pageSize = 24;
/** What a gallery lists: one folder, every folder beneath the library, or the Team's favorites. */
export type ListingSource =
  | Readonly<{ kind: "folder"; path: string }>
  | Readonly<{ kind: "all"; path: string }>
  | Readonly<{ kind: "favorites"; path: string }>;
const sourceKey = (source: ListingSource | null): string | null =>
  source === null
    ? null
    : source.kind === "folder"
      ? source.path
      : `${source.kind}:${source.path}`;
export const galleryKeys = {
  all: (app: AppRoot | null) => queryKeys.of(app, "prints", "gallery"),
  listings: (app: AppRoot | null) => [...galleryKeys.all(app), "listing"],
  listing: (app: AppRoot | null, path: string | null) => [
    ...galleryKeys.listings(app),
    path,
  ],
  file: (app: AppRoot | null, path: string) => [
    ...galleryKeys.all(app),
    "file",
    path,
  ],
  describedAll: (app: AppRoot | null) => [...galleryKeys.all(app), "described"],
  described: (app: AppRoot | null, paths: readonly string[]) => [
    ...galleryKeys.describedAll(app),
    ...paths,
  ],
};
export type GalleryEntry = {
  path: string;
  name: string;
  modifiedAt: number;
  size: number;
  /** The library folder the file sits in, for All prints; absent at the root. */
  folder?: string;
};
const mediaName = /\.(avif|gif|jpe?g|png|svg|webp|mp4|mp3)$/i;
/** Where a listing stands: folders still to read, the offset into the first, and a favorites cursor. */
type ListingCursor = Readonly<{
  queue: readonly string[];
  offset: number;
  after: string | null;
}>;

/** Read enough entries to fill one page of prints, without dropping a tail. */
export function galleryListingQuery(
  app: AppRoot | null,
  source: ListingSource | null,
) {
  const computerId = app?.context.get().computerId;
  const root = source?.path ?? null;
  const initial: ListingCursor = {
    queue: root === null ? [] : [root],
    offset: 0,
    after: null,
  };
  return infiniteQueryOptions({
    queryKey: galleryKeys.listing(app, sourceKey(source)),
    initialPageParam: initial,
    enabled: Boolean(
      computerId &&
      root &&
      app.capabilities.has(computerList) &&
      app.capabilities.has(computerReadFile),
    ),
    queryFn: async ({ pageParam, signal }) => {
      if (!app || !computerId || !source)
        throw new AppError("No Computer folder selected", {
          code: "SELECTION_CHANGED",
          retryable: false,
        });
      const stillSelected = () => {
        signal.throwIfAborted();
        if (app.context.get().computerId !== computerId)
          throw new AppError("Computer selection changed", {
            code: "SELECTION_CHANGED",
            retryable: false,
          });
      };
      if (source.kind === "favorites") {
        const noFolders: string[] = [];
        stillSelected();
        const page = await listFavorites(app, pageParam.after, pageSize);
        stillSelected();
        const entries: GalleryEntry[] = page.paths
          .filter((path) => mediaName.test(path))
          .map((path) => ({
            path,
            name: path.slice(path.lastIndexOf("/") + 1),
            modifiedAt: 0,
            size: 0,
            ...folderCaption(source.path, path),
          }));
        return {
          entries,
          folders: noFolders,
          next:
            page.next === null
              ? null
              : { queue: [], offset: 0, after: page.next },
        };
      }
      const entries: GalleryEntry[] = [];
      const folders: string[] = [];
      let queue = [...pageParam.queue];
      let offset = pageParam.offset;
      while (entries.length < pageSize && queue.length > 0) {
        stillSelected();
        const directory = queue[0];
        const page = await listComputerFiles(app.capabilities, {
          path: directory,
          limit: pageSize - entries.length,
          offset,
        });
        stillSelected();
        if (page.nextOffset !== null && page.nextOffset <= offset)
          throw new AppError("Directory pagination did not advance", {
            code: "PROTOCOL",
            retryable: false,
          });
        const base = page.path.replace(/\/$/, "");
        for (const entry of page.entries) {
          if (entry.name.startsWith(".")) continue;
          if (entry.type === "directory") {
            if (source.kind === "all") queue.push(`${base}/${entry.name}`);
            else folders.push(entry.name);
          } else if (entry.type === "file" && mediaName.test(entry.name))
            entries.push({
              ...entry,
              path: `${base}/${entry.name}`,
              ...folderCaption(source.path, `${base}/${entry.name}`),
            });
        }
        if (page.nextOffset === null) {
          queue = queue.slice(1);
          offset = 0;
        } else offset = page.nextOffset;
      }
      return {
        entries,
        folders,
        next: queue.length === 0 ? null : { queue, offset, after: null },
      };
    },
    getNextPageParam: (page) => page.next,
  });
}

/** The library folder of a path, as a caption, when it is not the root. */
function folderCaption(root: string, path: string): { folder?: string } {
  const folder = folderOf(root, path);
  return folder === undefined ? {} : { folder };
}

function galleryFileQuery(
  app: AppRoot | null,
  entry: GalleryEntry,
  requested: boolean,
) {
  return {
    ...capabilityQuery(
      app,
      computerReadFile,
      [...galleryKeys.file(app, entry.path), entry.modifiedAt, entry.size],
      async (_handle, signal) => {
        if (!app)
          throw new AppError("Prints disconnected", {
            code: "DISCONNECTED",
            retryable: true,
          });
        const file = await readComputerFile(
          app.capabilities,
          { path: entry.path },
          { signal },
        );
        return new File([file], file.name, {
          type: file.type,
          lastModified: entry.modifiedAt,
        });
      },
    ),
    enabled: Boolean(
      requested &&
      app?.context.get().computerId &&
      app.capabilities.has(computerReadFile),
    ),
    structuralSharing: false,
  };
}

export function useMediaGallery(
  connection: { app: AppRoot } | null,
  source: ListingSource | null,
) {
  const app = connection?.app ?? null;
  const computerId = useComputerId(app);
  const client = useQueryClient();
  const [requested, setRequested] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const loadFile = useCallback(
    (filePath: string) => {
      if (!computerId) return;
      const key = `${computerId}:${filePath}`;
      setRequested((current) =>
        current.has(key) ? current : new Set([...current, key]),
      );
    },
    [computerId],
  );
  const retryFile = useCallback(
    (filePath: string) => {
      loadFile(filePath);
      void client.resetQueries({ queryKey: galleryKeys.file(app, filePath) });
    },
    [app, client, loadFile],
  );
  const listingOptions = galleryListingQuery(app, source);
  const listing = useInfiniteQuery(listingOptions);
  const entries = useMemo(
    () =>
      listingOptions.enabled
        ? (listing.data?.pages.flatMap((page) => page.entries) ?? [])
        : [],
    [listing.data, listingOptions.enabled],
  );
  const combine = useCallback(
    (results: readonly UseQueryResult<File, AppError>[]) => ({
      files: results.flatMap((query, index) =>
        query.data ? [{ path: entries[index].path, file: query.data }] : [],
      ),
      failures: results.flatMap((query, index) =>
        query.isError ? [entries[index].name] : [],
      ),
      loading: results.some((query) => query.isLoading),
    }),
    [entries],
  );
  const files = useQueries({
    queries: entries.map((entry) =>
      galleryFileQuery(
        app,
        entry,
        Boolean(computerId && requested.has(`${computerId}:${entry.path}`)),
      ),
    ),
    combine,
  });
  // Cancel native reads at the boundary, before React can render the next key.
  useEffect(() => {
    if (!app) return;
    const key = galleryKeys.all(app);
    const listingKey = galleryKeys.listings(app);
    let active = true;
    void client.invalidateQueries({ queryKey: key });
    const cancel = () => {
      void client.cancelQueries({ queryKey: key });
    };
    const context = app.context.subscribe((next) => {
      if (next.computerId !== computerId) cancel();
    });
    const lifecycle = app.lifecycle.subscribe((state) => {
      if (
        state === "disconnected" ||
        state === "disposing" ||
        state === "disposed"
      )
        cancel();
    });
    const grants = app.capabilities.subscribe(() => {
      queueMicrotask(() => {
        if (!active || app.context.get().computerId !== computerId) return;
        void client.resetQueries({ queryKey: listingKey });
      });
    });
    return () => {
      active = false;
      context();
      lifecycle();
      grants();
      cancel();
    };
  }, [app, computerId, connection, client]);
  const folders = useMemo(
    () => [
      ...new Set(listing.data?.pages.flatMap((page) => page.folders) ?? []),
    ],
    [listing.data],
  );
  return {
    entries,
    folders,
    loadFile,
    retryFile,
    files: files.files,
    failures: files.failures,
    error: listing.error,
    loading: listing.isFetching || files.loading,
    hasNextPage: listing.hasNextPage,
    nextPageReady: listing.hasNextPage && !listing.isFetching && !listing.error,
    refresh: () => {
      void listing.refetch({ cancelRefetch: false });
    },
    loadMore: () => {
      if (!listing.isFetching)
        void listing.fetchNextPage({ cancelRefetch: false });
    },
  };
}
