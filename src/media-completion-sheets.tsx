import { CompletionMenu } from "@fungi.computer/parakeet/completion-menu";
import type { MediaSlashItem } from "./media-composer-pieces.js";
import { referenceLabel } from "./reference-mentions.js";
import type { MentionOption } from "./prompt-characters.js";

// The completion menus open when a person types "/" or "@"; they load then,
// not with the first screen.

export function MediaSlashSheet({
  index,
  listId,
  matches,
  onHighlight,
  onPick,
}: {
  index: number;
  listId: string;
  matches: readonly MediaSlashItem[];
  onHighlight: (index: number) => void;
  onPick: (index: number) => void;
}): React.JSX.Element {
  return (
    <CompletionMenu
      open
      rows={matches.map((item) => ({
        key: item.id,
        label: `/${item.slash}`,
        detail: item.description ?? item.title,
      }))}
      selected={index}
      listId={listId}
      label="Commands"
      kind="commands"
      empty="No matching commands"
      onHighlight={onHighlight}
      onChoose={onPick}
    />
  );
}

/** The attached references and saved characters offered while an `@name` is being typed. */
export function MediaMentionSheet({
  images,
  index,
  listId,
  matches,
  onHighlight,
  onPick,
}: {
  /** Prints-folder images by path, for each character's first reference. */
  images: readonly Readonly<{ path: string; url: string }>[];
  index: number;
  listId: string;
  matches: readonly MentionOption[];
  onHighlight: (index: number) => void;
  onPick: (index: number) => void;
}): React.JSX.Element {
  return (
    <CompletionMenu
      open
      rows={matches.map((option) => {
        if (option.kind === "reference")
          return {
            key: referenceLabel(option.reference.number),
            label: `@${referenceLabel(option.reference.number)}`,
            detail: option.reference.name,
            media: (
              <span className="prints-character-thumb mask mask-squircle">
                {option.reference.url ? (
                  <img src={option.reference.url} alt="" />
                ) : null}
              </span>
            ),
          };
        const { character } = option;
        const first = character.references.at(0)?.path;
        const thumbnail = images.find((image) => image.path === first);
        return {
          key: String(character.id),
          label: `@${character.name}`,
          detail: character.description || undefined,
          media: (
            <span className="prints-character-thumb mask mask-squircle">
              {thumbnail ? <img src={thumbnail.url} alt="" /> : null}
            </span>
          ),
        };
      })}
      selected={index}
      listId={listId}
      label="References and characters"
      kind="characters"
      onHighlight={onHighlight}
      onChoose={onPick}
    />
  );
}
