import { lazy, Suspense, useEffect, useState } from "react";
import type { AppRoot } from "@fungi.computer/agar";
import { Button } from "@fungi.computer/caps/components/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@fungi.computer/caps/components/dialog";
import { KeycapButton } from "@fungi.computer/caps/components/keycap";
import { Input } from "@fungi.computer/caps/components/input";
import { toast } from "@fungi.computer/caps/components/toaster";
import { Folder, FolderInput, FolderTree, Heart, X } from "lucide-react";
import { IconButton } from "@fungi.computer/caps/components/icon-button";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@fungi.computer/caps/components/tabs";
import type { LibraryView } from "./media-folder.js";
import { moveFiles, type MoveOutcome } from "./library-methods.js";
import {
  folderOf,
  isRelativeFolder,
  type RelativeFolder,
} from "./library-view.js";
import { reportCatchFailure } from "./log-event.js";

const LibraryTree = lazy(async () => {
  const module = await import("./library-rail.js");
  return { default: module.LibraryTree };
});

const TOASTER = "prints-generation-notices";

/**
 * The bar that takes the library bar's place while tiles are being chosen, at
 * the same height so the wall stays put. Narrow, it is compact and sits above
 * the composer.
 */
export function SelectBar({
  count,
  total,
  canWrite,
  onToggleAll,
  onMove,
  onFavorite,
  onDone,
}: Readonly<{
  count: number;
  total: number;
  canWrite: boolean;
  onToggleAll: () => void;
  onMove: () => void;
  onFavorite: () => void;
  onDone: () => void;
}>): React.JSX.Element {
  const everything = total > 0 && count === total;
  return (
    <div className="prints-select-bar" role="toolbar" aria-label="Selection">
      <span className="prints-select-count" aria-live="polite">
        {count === 0 ? "Choose prints" : `${String(count)} selected`}
      </span>
      <Button
        size="sm"
        variant="ghost"
        className="prints-select-all"
        disabled={total === 0}
        onClick={onToggleAll}
      >
        <span className="prints-select-wide">
          {everything ? "Clear selection" : "Select all in view"}
        </span>
        <span className="prints-select-narrow">
          {everything ? "None" : "All"}
        </span>
      </Button>
      <span className="prints-select-spacer" />
      <Button
        size="sm"
        variant="ghost"
        aria-label="Favorite"
        disabled={count === 0 || !canWrite}
        onClick={onFavorite}
      >
        <Heart aria-hidden size={16} />
        <span className="prints-select-wide">Favorite</span>
      </Button>
      <Button size="sm" disabled={count === 0 || !canWrite} onClick={onMove}>
        <FolderInput aria-hidden size={16} />
        <span className="prints-select-wide">Move to… ({count})</span>
        <span className="prints-select-narrow">Move ({count})</span>
      </Button>
      <IconButton
        className="prints-select-done"
        aria-label="Done selecting"
        title="Done selecting"
        icon={<X />}
        size="sm"
        onClick={onDone}
      />
    </div>
  );
}

/**
 * The narrow-width views and the folders inside the open one. The window
 * header already names where you are and carries Back and Select, so this row
 * holds only what the header cannot: the rail takes over at wide widths.
 */
export function LibraryBar({
  view,
  lastFolder,
  onOpen,
  onFolders,
  subfolders,
  onOpenSubfolder,
}: Readonly<{
  view: LibraryView;
  lastFolder: RelativeFolder | undefined;
  onOpen: (view: LibraryView) => void;
  onFolders: () => void;
  /** Folders inside the open folder, as chips in this row. */
  subfolders: readonly string[];
  onOpenSubfolder: (name: string) => void;
}>): React.JSX.Element {
  return (
    <div className="prints-library-bar">
      <KeycapButton
        className="prints-folders-button"
        density="compact"
        label={null}
        aria-label="Folders"
        title="Folders"
        icon={<FolderTree size={16} />}
        onClick={onFolders}
      />
      <Tabs
        className="prints-view-switch"
        value={view.kind}
        onValueChange={(value) => {
          if (value === "all" || value === "favorites") onOpen({ kind: value });
          else onOpen({ kind: "folder", folder: lastFolder });
        }}
      >
        <TabsList variant="segmented" aria-label="View">
          <TabsTrigger value="folder">Folder</TabsTrigger>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="favorites">Favorites</TabsTrigger>
        </TabsList>
      </Tabs>
      {subfolders.length > 0 ? (
        <div className="prints-folder-chips" role="list" aria-label="Folders">
          {subfolders.map((name) => (
            <KeycapButton
              key={name}
              role="listitem"
              density="compact"
              className="prints-folder-chip"
              icon={<Folder size={16} />}
              label={name}
              onClick={() => {
                onOpenSubfolder(name);
              }}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Choose a folder, or make one, to move files into. */
export function MoveDialog({
  app,
  root,
  from,
  canWrite,
  count,
  open,
  version,
  onClose,
  onMove,
}: Readonly<{
  app: AppRoot;
  root: string;
  /** The folder the items are in; null in All and Favorites, where they differ. */
  from: Readonly<{ folder: RelativeFolder | undefined }> | null;
  canWrite: boolean;
  count: number;
  open: boolean;
  version: number;
  onClose: () => void;
  onMove: (folder: RelativeFolder | undefined, create: boolean) => void;
}>): React.JSX.Element {
  const [folder, setFolder] = useState<RelativeFolder | undefined>(
    from?.folder,
  );
  const [name, setName] = useState("");
  // Each opening starts where the items already are.
  useEffect(() => {
    if (open) setFolder(from?.folder);
  }, [open, from?.folder]);
  const trimmed = name.trim();
  const nameValid =
    trimmed === "" || (isRelativeFolder(trimmed) && !trimmed.includes("/"));
  const target =
    trimmed === ""
      ? folder
      : folder === undefined
        ? trimmed
        : `${folder}/${trimmed}`;
  const inPlace = from !== null && trimmed === "" && target === from.folder;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setName("");
          onClose();
        }
      }}
    >
      <DialogContent className="prints-move-dialog">
        <DialogHeader>
          <DialogTitle>
            Move {String(count)} {count === 1 ? "item" : "items"} to…
          </DialogTitle>
        </DialogHeader>
        <div className="prints-move-tree">
          <Suspense fallback={null}>
            <LibraryTree
              app={app}
              root={root}
              activeFolder={folder}
              mode="pick"
              canWrite={canWrite}
              version={version}
              onSelectFolder={setFolder}
            />
          </Suspense>
        </div>
        <label className="prints-move-new" htmlFor="prints-move-new-folder">
          <span>New folder inside {folder ?? "the library"}</span>
          <Input
            id="prints-move-new-folder"
            value={name}
            placeholder="Folder name"
            aria-invalid={!nameValid}
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
        </label>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" size="sm" />}>
            Cancel
          </DialogClose>
          <Button
            size="sm"
            disabled={!nameValid || !canWrite || inPlace}
            onClick={() => {
              setName("");
              onMove(target, trimmed !== "");
            }}
          >
            {inPlace
              ? "Choose a folder"
              : `Move to ${target === undefined ? "Library" : (target.split("/").at(-1) ?? "")}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const refusalText = {
  conflict: "a file or folder with that name is already there",
  not_found: "it is no longer in the library",
  invalid: "a folder can't move into itself",
  not_granted: "Prints isn't allowed to change this Computer",
  unavailable: "the Computer didn't answer",
} satisfies Record<MoveOutcome["failed"][number]["error"], string>;

/** Say what a move did as one toast: what moved with Undo, and why anything did not. */
export function reportMove(
  app: AppRoot,
  root: string,
  outcome: MoveOutcome,
  changed: () => void,
): void {
  const { moved, failed } = outcome;
  if (failed.length > 0) {
    const first = failed[0];
    toast.error(
      `Couldn't move ${String(failed.length)} ${failed.length === 1 ? "item" : "items"}: ${refusalText[first.error]}.`,
      { toasterId: TOASTER, id: "prints-move-error" },
    );
  }
  if (moved.length === 0) return;
  toast(
    `Moved ${String(moved.length)} ${moved.length === 1 ? "item" : "items"}`,
    {
      toasterId: TOASTER,
      duration: 8_000,
      action: {
        label: "Undo",
        onClick: () => {
          // Back to each item's own folder, one call per folder.
          const byFolder = new Map<string, string[]>();
          for (const { from, to } of moved) {
            const back = folderOf(root, from) ?? "";
            byFolder.set(back, [...(byFolder.get(back) ?? []), to]);
          }
          void Promise.all(
            [...byFolder].map(([folder, paths]) =>
              moveFiles(app, {
                paths,
                folder: folder === "" ? undefined : folder,
              }),
            ),
          ).then(
            () => {
              changed();
            },
            (cause: unknown) => {
              reportCatchFailure("prints-undo-move", cause);
              toast.error("Couldn't undo that move.", { toasterId: TOASTER });
              changed();
            },
          );
        },
      },
    },
  );
}

/** Ask for a folder name; the owner makes it and opens it. */
export function NewFolderDialog({
  parent,
  open,
  onClose,
  onCreate,
}: Readonly<{
  parent: RelativeFolder | undefined;
  open: boolean;
  onClose: () => void;
  onCreate: (name: string) => Promise<string | null>;
}>): React.JSX.Element {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const close = () => {
    setName("");
    setError(null);
    onClose();
  };
  const submit = async () => {
    setBusy(true);
    const failure = await onCreate(name);
    setBusy(false);
    if (failure === null) close();
    else {
      setError(failure);
      toast.error(failure, { toasterId: TOASTER, id: "prints-new-folder" });
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <DialogContent className="prints-new-folder-dialog">
        <DialogHeader>
          <DialogTitle>New folder in {parent ?? "the library"}</DialogTitle>
        </DialogHeader>
        <form
          id="prints-new-folder-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <label htmlFor="prints-new-folder-name">Name</label>
          <Input
            id="prints-new-folder-name"
            autoFocus
            value={name}
            placeholder="Characters"
            aria-invalid={error !== null}
            onChange={(event) => {
              setName(event.target.value);
              setError(null);
            }}
          />
        </form>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" size="sm" />}>
            Cancel
          </DialogClose>
          <Button
            size="sm"
            type="submit"
            form="prints-new-folder-form"
            disabled={busy || name.trim() === ""}
          >
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
