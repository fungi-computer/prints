import { useEffect, useLayoutEffect, useRef, type CSSProperties } from "react";
import { FileTree, useFileTree } from "@pierre/trees/react";
import type { AppRoot } from "@fungi.computer/agar";
import {
  createComputerTreeSyncState,
  resetComputerTree,
  syncComputerTree,
  useComputerTreePages,
} from "@fungi.computer/agar/computer-tree";
import { describeAppError } from "@fungi.computer/agar/errors";
import { Button } from "@fungi.computer/caps/components/button";
import { toast } from "@fungi.computer/caps/components/toaster";
import { FolderInput, FolderPlus, Heart, Images, Pencil } from "lucide-react";
import type { LibraryView } from "./media-folder.js";
import { joinFolder, type RelativeFolder } from "./library-view.js";

const ROW_HEIGHT_PX = 32;

/**
 * Tree rows are named from the destination down, with its own name as the one
 * root row (`media/Characters/Mira/`), so the tree shows no Computer root above it.
 */
const rootName = (): string => "Library";
/** The tree row for an absolute path inside the destination. */
const treePathOf = (root: string, path: string): string =>
  `${rootName()}${path.slice(root.length)}`;
/** The absolute Computer path of a tree row, trailing slash dropped. */
const absolutePathOf = (root: string, row: string): string =>
  `${root}${row.replace(/\/$/, "").slice(rootName().length)}`;
/** The tree row for a folder inside the destination. */
const folderTreePath = (folder: RelativeFolder | undefined): string =>
  folder === undefined ? `${rootName()}/` : `${rootName()}/${folder}/`;

/** The destination-relative folder of a tree row, or null for a file. */
function folderOfRow(row: string) {
  if (!row.endsWith("/")) return null;
  const bare = row.slice(0, -1);
  if (bare === rootName()) return { folder: undefined };
  return bare.startsWith(`${rootName()}/`)
    ? { folder: bare.slice(rootName().length + 1) }
    : null;
}
const isRootRow = (row: string): boolean =>
  row.replace(/\/$/, "") === rootName();

const treeStyle: CSSProperties & Record<`--${string}`, string> = {
  flex: 1,
  minHeight: 0,
  "--trees-item-height": `${String(ROW_HEIGHT_PX)}px`,
  "--trees-padding-inline-override": "var(--spacing-xs)",
  "--trees-item-margin-x-override": "0px",
  "--trees-item-padding-x-override": "var(--spacing-xs)",
  "--trees-item-row-gap-override": "var(--spacing-xs)",
  "--trees-bg-override": "transparent",
  "--trees-fg-override": "var(--color-base-content)",
  "--trees-bg-muted-override": "var(--color-base-200)",
  "--trees-selected-bg-override": "var(--color-base-300)",
  "--trees-border-radius-override": "var(--radius-field)",
  "--trees-font-family-override": "var(--font-sans)",
  "--trees-font-size-override": "13px",
  "--trees-search-bg-override": "var(--color-base-200)",
  "--trees-search-fg-override": "var(--color-base-content)",
};

export type LibraryTreeProps = Readonly<{
  app: AppRoot;
  /** The chosen destination, an absolute Computer folder. */
  root: string;
  /** Folder to show selected; undefined is the destination itself. */
  activeFolder: RelativeFolder | undefined;
  /** False while All prints or Favorites is open: no folder row is selected. */
  active?: boolean;
  /** Browse moves files and renames; pick only chooses a folder. */
  mode: "browse" | "pick";
  onSelectFolder: (folder: RelativeFolder | undefined) => void;
  /** Drag completed in the tree: these paths were dropped on this folder. */
  onDrop?: (
    paths: readonly string[],
    folder: RelativeFolder | undefined,
  ) => void;
  onRename?: (path: string, name: string) => void;
  onNewFolder?: (parent: RelativeFolder | undefined) => void;
  onMoveRows?: (paths: readonly string[]) => void;
  canWrite: boolean;
  /** Bumped by the owner to re-read the Computer after a move or rename. */
  version: number;
}>;

/**
 * The destination as a real folder tree: Pierre owns rows, selection, drag and
 * rename; the Computer's listing comes through the shared agar tree model.
 */
export function LibraryTree({
  app,
  root,
  activeFolder,
  active = true,
  mode,
  onSelectFolder,
  onDrop,
  onRename,
  onNewFolder,
  onMoveRows,
  canWrite,
  version,
}: LibraryTreeProps): React.JSX.Element {
  const activePath = folderTreePath(activeFolder);
  const { scope, snapshot, requestPage, reload } = useComputerTreePages({
    app,
    rootPath: root,
    activePath: `${joinFolder(root, activeFolder)}/.`,
  });
  // Pierre selects the row it starts dragging. That is not the person opening
  // the folder, and opening it mid-drag loads its children into the model, which
  // ends the drag before it can drop.
  const dragging = useRef(false);
  const callbacks = useRef({
    quiet: false,
    root,
    mode,
    onSelectFolder,
    onDrop,
    onRename,
    onNewFolder,
    onMoveRows,
    requestPage,
  });
  callbacks.current = {
    quiet: callbacks.current.quiet,
    root,
    mode,
    onSelectFolder,
    onDrop,
    onRename,
    onNewFolder,
    onMoveRows,
    requestPage,
  };
  const editable = mode === "browse" && canWrite;
  const { model } = useFileTree({
    paths: [],
    itemHeight: ROW_HEIGHT_PX,
    initialExpansion: 1,
    flattenEmptyDirectories: false,
    search: mode === "browse",
    composition: { contextMenu: { enabled: mode === "browse" } },
    onSelectionChange(selected) {
      // The tree following the open folder is not the person choosing one.
      if (callbacks.current.quiet || dragging.current) return;
      const path = selected.at(-1);
      if (path === undefined || selected.length !== 1) return;
      const row = folderOfRow(path);
      if (row === null) return;
      callbacks.current.requestPage(
        absolutePathOf(callbacks.current.root, path),
        0,
      );
      callbacks.current.onSelectFolder(row.folder);
    },
    dragAndDrop: editable
      ? {
          canDrag: (paths) => paths.every((path) => !isRootRow(path)),
          canDrop: ({ target }) =>
            target.kind === "directory" &&
            target.directoryPath !== null &&
            folderOfRow(target.directoryPath) !== null,
          onDropComplete: ({ draggedPaths, target }) => {
            const row =
              target.directoryPath === null
                ? null
                : folderOfRow(target.directoryPath);
            if (row === null) return;
            callbacks.current.onDrop?.(
              draggedPaths.map((path) =>
                absolutePathOf(callbacks.current.root, path),
              ),
              row.folder,
            );
          },
        }
      : undefined,
    renaming: editable
      ? {
          canRename: (item) => !isRootRow(item.path),
          onRename: ({ sourcePath, destinationPath }) => {
            const name = destinationPath.replace(/\/$/, "").split("/").at(-1);
            if (name !== undefined)
              callbacks.current.onRename?.(
                absolutePathOf(callbacks.current.root, sourcePath),
                name,
              );
          },
        }
      : undefined,
  });
  const state = useRef(createComputerTreeSyncState());
  useLayoutEffect(() => {
    resetComputerTree(model, state.current);
  }, [model, scope, version]);
  // A move or rename changed the Computer: re-read what the tree holds.
  const reloaded = useRef(version);
  useEffect(() => {
    if (reloaded.current === version) return;
    reloaded.current = version;
    reload();
  }, [reload, version]);
  useLayoutEffect(() => {
    // A tree of folders: the wall already shows the files.
    const listings = snapshot.listings.map(({ request, listing }) => ({
      request,
      listing: {
        ...listing,
        path: treePathOf(root, listing.path),
        entries: listing.entries.filter((entry) => entry.type === "directory"),
      },
    }));
    syncComputerTree(model, listings, state.current);
  }, [model, root, snapshot.listings]);
  const lastActive = useRef<string | null>(null);
  useLayoutEffect(() => {
    callbacks.current.quiet = true;
    try {
      if (!active) {
        lastActive.current = null;
        for (const path of model.getSelectedPaths())
          model.getItem(path)?.deselect();
        return;
      }
      followActive();
    } finally {
      callbacks.current.quiet = false;
    }
    function followActive() {
      if (lastActive.current === activePath) return;
      const item = model.getItem(activePath);
      if (!item) return;
      lastActive.current = activePath;
      // select() adds to the selection, so the old folder goes first.
      for (const path of model.getSelectedPaths())
        if (path !== activePath) model.getItem(path)?.deselect();
      if (!item.isSelected()) item.select();
      // Open every folder above it, so the open folder is in view.
      const names = activePath.slice(0, -1).split("/");
      for (let depth = 1; depth < names.length; depth += 1) {
        const ancestor = model.getItem(`${names.slice(0, depth).join("/")}/`);
        if (ancestor && "expand" in ancestor && !ancestor.isExpanded())
          ancestor.expand();
      }
    }
  }, [active, activePath, model, snapshot.listings]);
  useEffect(() => {
    if (!snapshot.failure) return;
    toast.error(describeAppError(snapshot.failure).message, {
      id: "prints-tree-error",
      toasterId: "prints-generation-notices",
      action: { label: "Retry", onClick: reload },
    });
  }, [reload, snapshot.failure]);
  return (
    <div
      className="prints-tree"
      data-library-tree={mode}
      onDragStartCapture={() => {
        dragging.current = true;
      }}
      onDragEnd={() => {
        dragging.current = false;
      }}
      onDrop={() => {
        dragging.current = false;
      }}
    >
      <FileTree
        model={model}
        className="prints-tree-view"
        style={treeStyle}
        renderContextMenu={
          mode === "browse"
            ? (item, context) => {
                const row = folderOfRow(item.path);
                return (
                  <div
                    className="flex min-w-40 flex-col gap-xs p-xs"
                    role="menu"
                  >
                    {row !== null ? (
                      <Button
                        className="w-full justify-start"
                        disabled={!canWrite}
                        role="menuitem"
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          context.close({ restoreFocus: false });
                          callbacks.current.onNewFolder?.(row.folder);
                        }}
                      >
                        <FolderPlus aria-hidden="true" /> New folder
                      </Button>
                    ) : null}
                    <Button
                      className="w-full justify-start"
                      disabled={!canWrite || isRootRow(item.path)}
                      role="menuitem"
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        context.close({ restoreFocus: false });
                        model.startRenaming(item.path);
                      }}
                    >
                      <Pencil aria-hidden="true" /> Rename
                    </Button>
                    <Button
                      className="w-full justify-start"
                      disabled={!canWrite || isRootRow(item.path)}
                      role="menuitem"
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        context.close({ restoreFocus: false });
                        const selected = model.getSelectedPaths();
                        const rows = selected.includes(item.path)
                          ? selected
                          : [item.path];
                        callbacks.current.onMoveRows?.(
                          rows.map((path) => absolutePathOf(root, path)),
                        );
                      }}
                    >
                      <FolderInput aria-hidden="true" /> Move to…
                    </Button>
                  </div>
                );
              }
            : undefined
        }
      />
    </div>
  );
}

/** The Library rail: the whole destination, the Team's favorites, and the folder tree. */
export function LibraryRail({
  view,
  onView,
  onNewFolder,
  canWrite,
  ...tree
}: Readonly<{
  view: LibraryView;
  onView: (view: LibraryView) => void;
  onNewFolder: (parent: RelativeFolder | undefined) => void;
}> &
  Omit<
    LibraryTreeProps,
    "mode" | "activeFolder" | "onSelectFolder" | "onNewFolder" | "canWrite"
  > & { canWrite: boolean }): React.JSX.Element {
  return (
    <nav className="prints-rail" aria-label="Library">
      <div className="prints-rail-views">
        <button
          type="button"
          className="prints-rail-view"
          aria-current={view.kind === "all" ? "page" : undefined}
          onClick={() => {
            onView({ kind: "all" });
          }}
        >
          <Images aria-hidden size={16} /> All prints
        </button>
        <button
          type="button"
          className="prints-rail-view"
          aria-current={view.kind === "favorites" ? "page" : undefined}
          onClick={() => {
            onView({ kind: "favorites" });
          }}
        >
          <Heart aria-hidden size={16} /> Favorites
        </button>
      </div>
      <div className="prints-rail-head">
        <span>Folders</span>
        <Button
          size="sm"
          variant="ghost"
          aria-label="New folder"
          title="New folder"
          disabled={!canWrite}
          onClick={() => {
            onNewFolder(view.kind === "folder" ? view.folder : undefined);
          }}
        >
          <FolderPlus aria-hidden size={16} />
        </Button>
      </div>
      <LibraryTree
        {...tree}
        mode="browse"
        canWrite={canWrite}
        activeFolder={view.kind === "folder" ? view.folder : undefined}
        active={view.kind === "folder"}
        onNewFolder={onNewFolder}
        onSelectFolder={(folder) => {
          onView({ kind: "folder", folder });
        }}
      />
    </nav>
  );
}
