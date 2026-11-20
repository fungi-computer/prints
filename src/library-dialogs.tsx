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
import { Input } from "@fungi.computer/caps/components/input";
import { toast } from "@fungi.computer/caps/components/toaster";
import { isRelativeFolder, type RelativeFolder } from "./library-view.js";

const LibraryTree = lazy(async () => {
  const module = await import("./library-rail.js");
  return { default: module.LibraryTree };
});

const TOASTER = "prints-generation-notices";

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
