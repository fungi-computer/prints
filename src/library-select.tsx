import type { AppRoot } from "@fungi.computer/agar";
import { Button } from "@fungi.computer/caps/components/button";
import { KeycapButton } from "@fungi.computer/caps/components/keycap";
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
import { folderOf, type RelativeFolder } from "./library-view.js";
import { reportCatchFailure } from "./log-event.js";

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
