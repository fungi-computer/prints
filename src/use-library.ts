import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import type { AppRoot } from "@fungi.computer/agar";
import { appMethods } from "@fungi.computer/agar/backend";
import { capabilityQuery } from "@fungi.computer/agar/query";
import { computerWriteFile } from "@fungi.computer/agar/computer";
import { toast } from "@fungi.computer/caps/components/toaster";
import type { MediaMasonryItem } from "./media-masonry.js";
import type { LibraryView } from "./media-folder.js";
import { galleryKeys, type GalleryEntry } from "./media-gallery-query.js";
import {
  describeFiles,
  moveFiles,
  setFavorite,
  type FileDescription,
} from "./library-methods.js";
import { reportMove } from "./library-select.js";
import {
  folderCrumbs,
  folderOf,
  isRelativeFolder,
  joinFolder,
  type RelativeFolder,
} from "./library-view.js";
import { reportCatchFailure } from "./log-event.js";

const DESCRIBE_PAGE = 24;
const TOASTER = "prints-generation-notices";

/** Back and forward through the folders and views a person has opened. */
function useViewHistory(
  view: LibraryView,
  setView: (view: LibraryView) => void,
) {
  const [stack, setStack] = useState<{
    entries: readonly LibraryView[];
    index: number;
  }>({ entries: [], index: -1 });
  const same = (left: LibraryView, right: LibraryView) =>
    left.kind === right.kind &&
    (left.kind !== "folder" ||
      (right.kind === "folder" && left.folder === right.folder));
  const open = (next: LibraryView) => {
    setStack((previous) => {
      const here = previous.entries[previous.index] ?? view;
      if (same(here, next)) return previous;
      const kept = previous.entries.slice(0, previous.index + 1);
      const base = kept.length === 0 ? [view] : kept;
      return { entries: [...base, next], index: base.length };
    });
    setView(next);
  };
  const go = (delta: -1 | 1): boolean => {
    const index = stack.index + delta;
    if (index < 0 || index >= stack.entries.length) return false;
    const target = stack.entries[index];
    setStack({ ...stack, index });
    setView(target);
    return true;
  };
  return {
    open,
    canGoBack: stack.index > 0,
    canGoForward: stack.index >= 0 && stack.index < stack.entries.length - 1,
    back: () => go(-1),
    forward: () => go(1),
  };
}

/**
 * Everything the Library adds to the wall: the open view with its history and
 * crumbs, each tile's badge and favorite, selecting tiles, and moving files.
 */
export function useLibrary({
  app,
  destination,
  view,
  setView,
  entries,
  canWrite,
}: Readonly<{
  app: AppRoot | null;
  destination: string | null;
  view: LibraryView;
  setView: (view: LibraryView) => void;
  entries: readonly GalleryEntry[];
  canWrite: boolean;
}>) {
  const client = useQueryClient();
  const history = useViewHistory(view, setView);
  const [version, setVersion] = useState(0);
  // "Folder" returns to the folder you last had open, not the library root.
  const [lastFolder, setLastFolder] = useState<RelativeFolder | undefined>();
  const openFolder = view.kind === "folder" ? view.folder : undefined;
  const folderOpen = view.kind === "folder";
  useEffect(() => {
    if (folderOpen) setLastFolder(openFolder);
  }, [folderOpen, openFolder]);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [moving, setMoving] = useState<readonly string[] | null>(null);
  const [newFolder, setNewFolder] = useState<{
    parent: RelativeFolder | undefined;
  } | null>(null);
  const [favorites, setFavorites] = useState<ReadonlyMap<string, boolean>>(
    new Map(),
  );
  const canMethods = app?.capabilities.has(appMethods) === true;
  // One describeFiles call per page of tiles.
  const pages = useMemo(() => {
    const paths = entries.map((entry) => entry.path);
    const chunks: string[][] = [];
    for (let at = 0; at < paths.length; at += DESCRIBE_PAGE)
      chunks.push(paths.slice(at, at + DESCRIBE_PAGE));
    return chunks;
  }, [entries]);
  const described = useQueries({
    queries: pages.map((chunk) => ({
      ...capabilityQuery(
        app,
        appMethods,
        galleryKeys.described(app, chunk),
        async (_methods, signal) => {
          if (!app) return [];
          const files = await describeFiles(app, chunk);
          signal.throwIfAborted();
          return files;
        },
      ),
      enabled: canMethods && destination !== null,
      retry: false,
    })),
    combine: (results) => {
      const byPath = new Map<string, FileDescription>();
      for (const result of results)
        for (const file of result.data ?? []) byPath.set(file.path, file);
      return byPath;
    },
  });
  const refresh = useCallback(() => {
    setVersion((current) => current + 1);
    setSelected(new Set());
    void client.invalidateQueries({ queryKey: galleryKeys.listings(app) });
    void client.invalidateQueries({ queryKey: galleryKeys.describedAll(app) });
  }, [app, client]);
  const move = useCallback(
    async (
      paths: readonly string[],
      folder: RelativeFolder | undefined,
      options: Readonly<{ create?: boolean; name?: string }> = {},
    ) => {
      if (!app || destination === null) return;
      try {
        const outcome = await moveFiles(app, {
          paths,
          folder,
          createFolder: options.create ?? false,
          name: options.name,
        });
        reportMove(app, destination, outcome, refresh);
      } catch (cause) {
        reportCatchFailure("prints-move-files", cause);
        toast.error("Couldn't move those. Check the Computer and try again.", {
          toasterId: TOASTER,
          id: "prints-move-error",
        });
      }
      refresh();
    },
    [app, destination, refresh],
  );
  const toggleFavorite = useCallback(
    (paths: readonly string[], favorite: boolean) => {
      if (!app) return;
      setFavorites((current) => {
        const next = new Map(current);
        for (const path of paths) next.set(path, favorite);
        return next;
      });
      setFavorite(app, paths, favorite).then(
        () => {
          void client.invalidateQueries({
            queryKey: galleryKeys.describedAll(app),
          });
          if (view.kind === "favorites")
            void client.invalidateQueries({
              queryKey: galleryKeys.listings(app),
            });
        },
        (cause: unknown) => {
          reportCatchFailure("prints-set-favorite", cause);
          toast.error("Couldn't change that favorite.", {
            toasterId: TOASTER,
            id: "prints-favorite-error",
          });
          setFavorites((current) => {
            const next = new Map(current);
            for (const path of paths) next.delete(path);
            return next;
          });
        },
      );
    },
    [app, client, view.kind],
  );
  const createFolder = useCallback(
    async (parent: RelativeFolder | undefined, name: string) => {
      if (!app || destination === null) return "Choose a library folder first.";
      const trimmed = name.trim();
      if (!isRelativeFolder(trimmed) || trimmed.includes("/"))
        return "Use a single name, without slashes.";
      const folder = parent === undefined ? trimmed : `${parent}/${trimmed}`;
      if (!isRelativeFolder(folder)) return "That folder name is too long.";
      try {
        await app.capabilities
          .require(computerWriteFile)
          .mkdir({ path: joinFolder(destination, folder) });
      } catch (cause) {
        reportCatchFailure("prints-new-folder", cause);
        return "Couldn't create the folder. Check Computer write access.";
      }
      refresh();
      history.open({ kind: "folder", folder });
      return null;
    },
    [app, destination, history, refresh],
  );
  const crumbs = useMemo(
    () =>
      view.kind === "folder"
        ? [
            { id: "", label: destination?.split("/").at(-1) ?? "Library" },
            ...folderCrumbs(view.folder).map(({ name, folder }) => ({
              id: folder,
              label: name,
            })),
          ].slice(-8)
        : [
            {
              id: view.kind,
              label: view.kind === "all" ? "All prints" : "Favorites",
            },
          ],
    [destination, view],
  );
  const isFavorite = (path: string): boolean =>
    favorites.get(path) ?? described.get(path)?.favorite ?? false;
  /** A wall tile with its Library marks: badge, favorite, select and move. */
  const enrich = (item: MediaMasonryItem): MediaMasonryItem => {
    if (destination === null || !item.path.startsWith(`${destination}/`))
      return item;
    const info = described.get(item.path);
    const favorite = favorites.get(item.path) ?? info?.favorite ?? false;
    const entry = entries.find((candidate) => candidate.path === item.path);
    const marked: MediaMasonryItem = {
      ...item,
      badge: undefined,
      folderCaption: view.kind === "folder" ? undefined : entry?.folder,
      favorite,
      select: {
        active: selecting,
        checked: selected.has(item.path),
        onToggle: () => {
          setSelected((current) => {
            const next = new Set(current);
            if (next.has(item.path)) next.delete(item.path);
            else next.add(item.path);
            return next;
          });
        },
      },
    };
    if (!item.pending && info !== undefined)
      marked.badge =
        info.kind === null
          ? { label: null, seconds: null }
          : {
              label: info.modelLabel ?? info.model,
              seconds: info.durationSeconds,
            };
    if (canMethods)
      marked.onToggleFavorite = () => {
        toggleFavorite([item.path], !favorite);
      };
    if (canMethods && canWrite)
      marked.onMove = () => {
        setMoving([item.path]);
      };
    return marked;
  };
  const title =
    view.kind === "all"
      ? "All prints"
      : view.kind === "favorites"
        ? "Favorites"
        : (view.folder?.split("/").at(-1) ?? "Library");
  const parent =
    view.kind === "folder" && view.folder !== undefined
      ? view.folder.split("/").slice(0, -1).join("/")
      : null;
  const up =
    parent === null
      ? undefined
      : () => {
          history.open({
            kind: "folder",
            folder: parent === "" ? undefined : parent,
          });
        };
  return {
    title,
    up,
    lastFolder,
    history,
    version,
    refresh,
    crumbs,
    selecting,
    setSelecting: (next: boolean) => {
      setSelecting(next);
      if (!next) setSelected(new Set());
    },
    selected,
    selectAll: (paths: readonly string[]) => {
      setSelected(new Set(paths));
    },
    moving,
    setMoving,
    newFolder,
    setNewFolder,
    move,
    toggleFavorite,
    createFolder,
    enrich,
    isFavorite,
    folderOf,
  };
}
