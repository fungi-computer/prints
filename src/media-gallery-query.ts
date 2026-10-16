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

const pageSize = 24;
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
};
type GalleryEntry = {
  path: string;
  name: string;
  modifiedAt: number;
  size: number;
};

/** Read enough directory entries to fill one image page, without dropping a tail. */
export function galleryListingQuery(app: AppRoot | null, path: string | null) {
  const computerId = app?.context.get().computerId;
  return infiniteQueryOptions({
    queryKey: galleryKeys.listing(app, path),
    initialPageParam: 0,
    enabled: Boolean(
      computerId &&
      path &&
      app.capabilities.has(computerList) &&
      app.capabilities.has(computerReadFile),
    ),
    queryFn: async ({ pageParam, signal }) => {
      if (!app || !computerId || !path)
        throw new AppError("No Computer folder selected", {
          code: "SELECTION_CHANGED",
          retryable: false,
        });
      const entries: GalleryEntry[] = [];
      let offset: number | null = pageParam;
      do {
        signal.throwIfAborted();
        if (app.context.get().computerId !== computerId)
          throw new AppError("Computer selection changed", {
            code: "SELECTION_CHANGED",
            retryable: false,
          });
        const page = await listComputerFiles(app.capabilities, {
          path,
          limit: pageSize - entries.length,
          offset,
        });
        signal.throwIfAborted();
        if (page.nextOffset !== null && page.nextOffset <= offset)
          throw new AppError("Directory pagination did not advance", {
            code: "PROTOCOL",
            retryable: false,
          });
        entries.push(
          ...page.entries
            .filter(
              (entry) =>
                entry.type === "file" &&
                /\.(avif|gif|jpe?g|png|svg|webp|mp4)$/i.test(entry.name),
            )
            .map((entry) => ({
              ...entry,
              path: `${page.path.replace(/\/$/, "")}/${entry.name}`,
            })),
        );
        offset = page.nextOffset;
      } while (entries.length < pageSize && offset !== null);
      return { entries, nextOffset: offset };
    },
    getNextPageParam: (page) => page.nextOffset,
  });
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
  path: string | null,
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
  const listingOptions = galleryListingQuery(app, path);
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
  return {
    entries,
    loadFile,
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
