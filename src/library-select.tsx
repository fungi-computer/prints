import type { AppRoot } from "@fungi.computer/agar";
import { KeycapButton } from "@fungi.computer/caps/components/keycap";
import { toast } from "@fungi.computer/caps/components/toaster";
import { Folder, FolderTree } from "lucide-react";
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
