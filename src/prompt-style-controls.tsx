import { useState } from "react";
import { Button } from "@fungi.computer/caps/components/button";
import { Input } from "@fungi.computer/caps/components/input";
import { Select } from "@fungi.computer/caps/components/select";
import { Textarea } from "@fungi.computer/caps/components/textarea";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@fungi.computer/caps/components/dialog";
import type { PromptStyle } from "./prompt-styles.js";

export type Editing = Readonly<{
  id?: number | undefined;
  name: string;
  text: string;
}>;

/** The style that leads the prompt: a plain choice among the saved styles. */
export function PromptStyleSelect({
  id,
  styles,
  selected,
  disabled,
  onSelect,
}: {
  /** Set by a surrounding Caps Field so its label names this control. */
  id?: string | undefined;
  styles: readonly PromptStyle[];
  selected: string | undefined;
  disabled: boolean;
  onSelect: (name: string | undefined) => void;
}): React.JSX.Element {
  const known =
    selected === undefined || styles.some((s) => s.name === selected);
  return (
    <Select
      id={id}
      aria-label="Prompt style"
      data-generation-style
      className="select-sm"
      disabled={disabled}
      onChange={(event) => {
        onSelect(event.currentTarget.value || undefined);
      }}
      value={selected ?? ""}
    >
      <option value="">No style</option>
      {known ? null : <option value={selected}>{selected}</option>}
      {styles.map((style) => (
        <option key={style.id} value={style.name}>
          {style.name}
        </option>
      ))}
    </Select>
  );
}

/** The style library: use, create, rename, duplicate or delete saved styles. */
export function PromptStylesDialog({
  styles,
  selected,
  open,
  onOpenChange,
  busy,
  error,
  onSelect,
  onSave,
  onDelete,
}: {
  styles: readonly PromptStyle[];
  selected: string | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy: boolean;
  error: string | null;
  onSelect: (name: string | undefined) => void;
  onSave: (
    style: Editing,
    done: (saved: PromptStyle | undefined) => void,
  ) => void;
  onDelete: (style: PromptStyle, done: () => void) => void;
}): React.JSX.Element {
  const [editing, setEditing] = useState<Editing | null>(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Styles</DialogTitle>
        </DialogHeader>
        <ul className="space-y-1" aria-label="Saved styles">
          {styles.map((style) => (
            <li
              key={style.id}
              className="flex items-center justify-between gap-sm"
            >
              <span className="min-w-0 truncate">{style.name}</span>
              <span className="flex gap-xs">
                <Button
                  size="xs"
                  variant={selected === style.name ? "primary" : "ghost"}
                  type="button"
                  aria-pressed={selected === style.name}
                  onClick={() => {
                    onSelect(style.name);
                    onOpenChange(false);
                  }}
                >
                  Use
                </Button>
                {style.builtIn ? null : (
                  <Button
                    size="xs"
                    variant="ghost"
                    type="button"
                    onClick={() => {
                      setEditing(style);
                    }}
                  >
                    Edit
                  </Button>
                )}
                <Button
                  size="xs"
                  variant="ghost"
                  type="button"
                  onClick={() => {
                    setEditing({
                      name: `${style.name} copy`.slice(0, 64),
                      text: style.text,
                    });
                  }}
                >
                  Duplicate
                </Button>
                {style.builtIn ? null : (
                  <Button
                    size="xs"
                    variant="ghost"
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      onDelete(style, () => {
                        if (selected === style.name) onSelect(undefined);
                        if (editing?.id === style.id) setEditing(null);
                      });
                    }}
                  >
                    Delete
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
        {editing === null ? (
          <Button
            size="xs"
            type="button"
            onClick={() => {
              setEditing({ name: "", text: "" });
            }}
          >
            New style
          </Button>
        ) : (
          <div className="space-y-1">
            <Input
              aria-label="Style name"
              maxLength={64}
              value={editing.name}
              onChange={(event) => {
                setEditing({ ...editing, name: event.currentTarget.value });
              }}
            />
            <Textarea
              aria-label="Style text"
              maxLength={8000}
              rows={6}
              value={editing.text}
              onChange={(event) => {
                setEditing({ ...editing, text: event.currentTarget.value });
              }}
            />
            <div className="flex gap-xs">
              <Button
                size="xs"
                variant="primary"
                type="button"
                disabled={
                  busy ||
                  editing.name.trim() === "" ||
                  editing.text.trim() === ""
                }
                onClick={() => {
                  const previous = styles.find((s) => s.id === editing.id);
                  onSave(
                    {
                      id: editing.id,
                      name: editing.name.trim(),
                      text: editing.text,
                    },
                    (saved) => {
                      if (previous && selected === previous.name && saved)
                        onSelect(saved.name);
                      setEditing(null);
                    },
                  );
                }}
              >
                Save style
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
        <DialogFooter>
          <DialogClose render={<Button variant="outline" size="sm" />}>
            Close
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
