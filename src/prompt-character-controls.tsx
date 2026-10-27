import { useState } from "react";
import { Upload } from "lucide-react";
import * as Schema from "effect/Schema";
import { Button } from "@fungi.computer/caps/components/button";
import { Checkbox } from "@fungi.computer/caps/components/checkbox";
import { Input } from "@fungi.computer/caps/components/input";
import { Textarea } from "@fungi.computer/caps/components/textarea";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@fungi.computer/caps/components/dialog";
import {
  CHARACTER_DESCRIPTION_LIMIT,
  CHARACTER_NAME_LIMIT,
  MAX_CHARACTER_REFERENCES,
  characterName,
  type PromptCharacter,
} from "./prompt-characters.js";

export type EditingCharacter = Readonly<{
  id?: number | undefined;
  name: string;
  description: string;
  references: readonly { path: string }[];
}>;
type Image = Readonly<{ path: string; url: string }>;

const validName = Schema.is(characterName);
const fileName = (path: string) => path.split("/").at(-1) ?? path;

function Thumbnails({
  paths,
  images,
}: {
  paths: readonly string[];
  images: readonly Image[];
}): React.JSX.Element {
  return (
    <span className="flex gap-xs">
      {paths.map((path) => {
        const image = images.find((entry) => entry.path === path);
        return (
          <span
            key={path}
            className="prints-character-thumb mask mask-squircle"
            title={path}
          >
            {image ? <img src={image.url} alt={fileName(path)} /> : null}
          </span>
        );
      })}
    </span>
  );
}

/** The character library: create, edit and delete saved characters. */
export function PromptCharactersDialog({
  characters,
  images,
  open,
  onOpenChange,
  busy,
  error,
  canUpload,
  onUpload,
  onSave,
  onDelete,
}: {
  characters: readonly PromptCharacter[];
  /** The Prints-folder images a character's references can be picked from. */
  images: readonly Readonly<{ path: string; url: string }>[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy: boolean;
  error: string | null;
  canUpload: boolean;
  onUpload: () => void;
  onSave: (character: EditingCharacter, done: () => void) => void;
  onDelete: (character: PromptCharacter, done: () => void) => void;
}): React.JSX.Element {
  const [editing, setEditing] = useState<EditingCharacter | null>(null);
  const trimmed = editing?.name.trim() ?? "";
  const nameProblem =
    trimmed !== "" && !validName(trimmed)
      ? "Use letters, numbers, - and _ only, so you can type @name."
      : null;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setEditing(null);
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Characters</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-sm">
          {characters.length === 0 && editing === null ? (
            <p className="text-sm">
              No characters yet. Save one, then type @name in a prompt to keep
              it the same in every image.
            </p>
          ) : (
            <ul className="flex flex-col gap-sm" aria-label="Saved characters">
              {characters.map((character) => (
                <li
                  key={character.id}
                  className="flex items-center justify-between gap-sm"
                >
                  <span className="flex min-w-0 items-center gap-sm">
                    <Thumbnails
                      paths={character.references.map((entry) => entry.path)}
                      images={images}
                    />
                    <span className="min-w-0 truncate">@{character.name}</span>
                  </span>
                  <span className="flex gap-xs">
                    <Button
                      size="xs"
                      variant="ghost"
                      type="button"
                      onClick={() => {
                        setEditing(character);
                      }}
                    >
                      Edit
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        onDelete(character, () => {
                          if (editing?.id === character.id) setEditing(null);
                        });
                      }}
                    >
                      Delete
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {editing === null ? (
            <Button
              size="xs"
              type="button"
              onClick={() => {
                setEditing({ name: "", description: "", references: [] });
              }}
            >
              New character
            </Button>
          ) : (
            <div className="flex flex-col gap-sm">
              <Input
                aria-label="Character name"
                maxLength={CHARACTER_NAME_LIMIT}
                placeholder="Name, typed as @name"
                value={editing.name}
                onChange={(event) => {
                  setEditing({ ...editing, name: event.currentTarget.value });
                }}
              />
              {nameProblem ? (
                <p role="alert" className="text-xs">
                  {nameProblem}
                </p>
              ) : null}
              <Textarea
                aria-label="Character description"
                maxLength={CHARACTER_DESCRIPTION_LIMIT}
                rows={4}
                placeholder="Short description added to the prompt, e.g. a tall girl with silver hair and a red scarf"
                value={editing.description}
                onChange={(event) => {
                  setEditing({
                    ...editing,
                    description: event.currentTarget.value,
                  });
                }}
              />
              <div className="flex items-center justify-between gap-sm">
                <span className="text-xs">
                  Reference images ({editing.references.length} /{" "}
                  {MAX_CHARACTER_REFERENCES})
                </span>
                <Button
                  size="xs"
                  variant="ghost"
                  type="button"
                  disabled={!canUpload}
                  onClick={onUpload}
                >
                  <Upload aria-hidden="true" size={14} />
                  Upload
                </Button>
              </div>
              {images.length === 0 ? (
                <p className="text-xs">
                  No images in the Prints folder yet. Upload one to use it as a
                  reference.
                </p>
              ) : (
                <ul
                  className="prints-character-picker"
                  aria-label="Reference images"
                >
                  {images.map((image) => {
                    const picked = editing.references.some(
                      (entry) => entry.path === image.path,
                    );
                    return (
                      <li key={image.path} title={image.path}>
                        <label className="prints-character-pick">
                          <img src={image.url} alt="" />
                          <span className="prints-character-check">
                            <Checkbox
                              aria-label={`Use ${fileName(image.path)}`}
                              checked={picked}
                              disabled={
                                !picked &&
                                editing.references.length >=
                                  MAX_CHARACTER_REFERENCES
                              }
                              onChange={() => {
                                setEditing({
                                  ...editing,
                                  references: picked
                                    ? editing.references.filter(
                                        (entry) => entry.path !== image.path,
                                      )
                                    : [
                                        ...editing.references,
                                        { path: image.path },
                                      ],
                                });
                              }}
                            />
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
              <div className="flex gap-xs">
                <Button
                  size="xs"
                  variant="primary"
                  type="button"
                  disabled={busy || !validName(trimmed)}
                  onClick={() => {
                    onSave(
                      {
                        id: editing.id,
                        name: trimmed,
                        description: editing.description.trim(),
                        references: editing.references,
                      },
                      () => {
                        setEditing(null);
                      },
                    );
                  }}
                >
                  Save character
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  type="button"
                  onClick={() => {
                    setEditing(null);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
          {error ? (
            <p role="alert" className="text-xs">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" size="sm" />}>
            Close
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
