import { useRef } from "react";
import { Folder } from "lucide-react";
import * as Schema from "effect/Schema";
import { mediaLibraryPathSchema } from "@fungi.computer/agar/media";
import { SchemaForm, field, useSchemaForm } from "@fungi.computer/caps/form";
import { FormFooter } from "@fungi.computer/caps/components/field";
import { Button } from "@fungi.computer/caps/components/button";
import { KeycapButton } from "@fungi.computer/caps/components/keycap";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@fungi.computer/caps/components/dialog";
import {
  StatusTrayNote,
  StatusTrayRow,
} from "@fungi.computer/caps/blocks/status-tray";
import type { useMediaFolder } from "./media-folder.js";

/**
 * Where generated images are saved. The window's status bar opens it: the
 * shell draws the folder item, and Prints answers its click here.
 */
export function PrintsFolderDialog({
  folder,
}: {
  folder: ReturnType<typeof useMediaFolder>;
}) {
  return (
    <Dialog open={folder.editing} onOpenChange={folder.setEditing}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save prints to</DialogTitle>
        </DialogHeader>
        <FolderForm key={folder.computerId} folder={folder} />
        <DialogFooter>
          <DialogClose render={<Button variant="outline" size="sm" />}>
            Close
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const folderFields = Schema.Struct({
  path: Schema.Trim.check(
    Schema.makeFilter(Schema.is(mediaLibraryPathSchema), {
      message: "Enter an absolute Computer folder, such as /media.",
    }),
  ).annotate(field({ label: "Folder", placeholder: "/media" })),
});

function FolderForm({ folder }: { folder: ReturnType<typeof useMediaFolder> }) {
  const create = useRef(false);
  const model = useSchemaForm({
    schema: folderFields,
    defaultValues: { path: folder.path ?? "/media" },
    onSubmit: async ({ path }) => {
      const error = await folder.choose(path, create.current);
      return error
        ? { kind: "refused", fields: { path: error } }
        : { kind: "saved" };
    },
  });
  const selectAction = (createFolder: boolean) => {
    create.current = createFolder;
    // A refused Use does not prevent Create or retrying the same folder.
    model.form.setFieldMeta("path", (meta) => ({
      ...meta,
      errorMap: { ...meta.errorMap, onServer: undefined },
    }));
  };
  const disabled = folder.busy || !folder.writable;
  return (
    <>
      <SchemaForm
        model={model}
        disabled={disabled}
        footer={
          <FormFooter divider={false}>
            <KeycapButton
              className="[--caps-keycap-width:auto]"
              label="Use"
              type="submit"
              disabled={disabled}
              onClick={() => {
                selectAction(false);
              }}
            />
            <KeycapButton
              className="[--caps-keycap-width:auto]"
              label="Create"
              type="submit"
              disabled={disabled}
              onClick={() => {
                selectAction(true);
              }}
            />
          </FormFooter>
        }
      />
      {folder.error ? (
        <StatusTrayRow
          role="alert"
          icon={
            <Folder
              aria-hidden="true"
              className="size-[var(--stipe-icon-size-sm)]"
            />
          }
          primary={folder.error}
        />
      ) : (
        <StatusTrayNote>
          {folder.writable
            ? "Prints saves new images and uploads here and shows this folder as your gallery."
            : "This Computer is read-only for Prints, so the folder can’t change."}
        </StatusTrayNote>
      )}
    </>
  );
}
