import type { ComponentProps } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@fungi.computer/caps/components/dialog";
import { LibraryRail } from "./library-rail.js";

/** The narrow library's folder rail, opened from its Folders key. */
export function LibraryFoldersDialog({
  open,
  onOpenChange,
  ...rail
}: ComponentProps<typeof LibraryRail> & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="prints-folders-dialog">
        <DialogHeader>
          <DialogTitle>Folders</DialogTitle>
        </DialogHeader>
        <LibraryRail {...rail} />
      </DialogContent>
    </Dialog>
  );
}
