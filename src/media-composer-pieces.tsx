import { ArrowUp } from "lucide-react";
import { Button } from "@fungi.computer/caps/components/button";
import { Loader } from "@fungi.computer/caps/components/loader";
import { Popover } from "@fungi.computer/caps/components/popover";
import { isImeComposing } from "@fungi.computer/caps/lib/ime";
import { CommandMenu } from "@fungi.computer/caps/blocks/command-menu";
import { completeSlash } from "@fungi.computer/parakeet/slash";
import { Textarea } from "@fungi.computer/caps/components/textarea";
import {
  mentionAt,
  suggestCharacters,
  type PromptCharacter,
} from "./prompt-characters.js";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export type MediaSlashItem = Readonly<{
  description?: string | undefined;
  id: string;
  slash: string;
  title: string;
}>;

/** Element id of the prompt counter, shared by the send button's description. */
const PROMPT_COUNTER_ID = "prints-prompt-counter";

/**
 * The composer's send button. Over the model's prompt limit it is disabled and
 * names the counter's over-limit message as its reason.
 */
export function GenerateButton({
  busy,
  disabled,
  label,
  onGenerate,
  promptOver,
}: {
  busy: boolean;
  disabled: boolean;
  label: string;
  onGenerate: () => void;
  promptOver: boolean;
}): React.JSX.Element {
  return (
    <Button
      aria-busy={busy}
      aria-describedby={promptOver ? PROMPT_COUNTER_ID : undefined}
      aria-label={label}
      className="prints-generate"
      data-generation-submit
      disabled={disabled || promptOver}
      onClick={onGenerate}
      size="sm"
      title={label}
      type="button"
      variant="primary"
    >
      {busy ? (
        <Loader decorative size="sm" />
      ) : (
        <ArrowUp aria-hidden="true" size={20} />
      )}
    </Button>
  );
}
/** Where the caret belongs once `value` has been written by a mention pick. */
export type CaretRequest = Readonly<{ value: string; caret: number }>;

export function MediaComposerTextarea({
  caretRequest,
  disabled,
  maxLength,
  addedLength = 0,
  mentionCount,
  onCaret,
  onChange,
  onMentionDismiss,
  onMentionMove,
  onMentionPick,
  onSend,
  onSlashMove,
  onSlashPick,
  placeholder,
  slashCount,
  value,
}: {
  caretRequest: CaretRequest | null;
  disabled?: boolean;
  /** The selected model's prompt limit; the box never truncates past it. */
  maxLength?: number | undefined;
  /** Characters the picked style and expanded `@characters` add; they count toward the limit. */
  addedLength?: number | undefined;
  mentionCount: number;
  onCaret: (caret: number) => void;
  onChange: (value: string) => void;
  onMentionDismiss: () => void;
  onMentionMove: (delta: -1 | 1) => void;
  onMentionPick: () => void;
  onSend: () => boolean | Promise<boolean>;
  onSlashMove: (delta: -1 | 1) => void;
  onSlashPick: () => void;
  placeholder: string;
  slashCount: number;
  value: string;
}): React.JSX.Element {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const latestValue = useRef(value);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const restoreFocus = useRef(false);
  latestValue.current = value;

  useLayoutEffect(() => {
    if (sending || disabled || !restoreFocus.current) return;
    restoreFocus.current = false;
    const textarea = textareaRef.current;
    // Native disabling drops keyboard focus. Restore it only after React has
    // re-enabled the control, without stealing focus moved elsewhere.
    if (
      textarea &&
      textarea.ownerDocument.activeElement === textarea.ownerDocument.body
    )
      textarea.focus({ preventScroll: true });
  }, [disabled, sending]);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea || caretRequest?.value !== value) return;
    textarea.setSelectionRange(caretRequest.caret, caretRequest.caret);
    textarea.focus({ preventScroll: true });
  }, [caretRequest, value]);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${String(Math.min(textarea.scrollHeight, 160))}px`;
  }, [value]);

  const send = useCallback(async () => {
    const draft = latestValue.current.trim();
    if (!draft || disabled || sendingRef.current) return;
    if (maxLength !== undefined && draft.length + addedLength > maxLength)
      return;
    restoreFocus.current =
      textareaRef.current === textareaRef.current?.ownerDocument.activeElement;
    sendingRef.current = true;
    setSending(true);
    try {
      if (!(await onSend())) return;
      setHistory((previous) =>
        previous.at(-1) === draft ? previous : [...previous, draft].slice(-20),
      );
      setHistoryIndex(-1);
      onChange("");
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }, [disabled, maxLength, onChange, onSend, addedLength]);

  const typed = value.trim().length;
  const length = typed > 0 ? typed + addedLength : 0;
  const over = maxLength !== undefined && length > maxLength;
  return (
    <div className="relative min-w-0 flex-1">
      <Textarea
        aria-invalid={over ? true : undefined}
        aria-label="Image prompt"
        className="min-h-12 max-h-40 w-full resize-none !border-0 !bg-transparent !shadow-none focus:!outline-none"
        data-generation-prompt
        disabled={disabled === true || sending}
        onChange={(event) => {
          onChange(event.currentTarget.value);
          onCaret(event.currentTarget.selectionStart);
          setHistoryIndex(-1);
        }}
        onSelect={(event) => {
          onCaret(event.currentTarget.selectionStart);
        }}
        onKeyDown={(event) => {
          if (isImeComposing(event)) return;
          if (mentionCount > 0) {
            if (event.key === "ArrowUp" || event.key === "ArrowDown") {
              event.preventDefault();
              onMentionMove(event.key === "ArrowUp" ? -1 : 1);
              return;
            }
            if (
              (event.key === "Enter" && !event.shiftKey) ||
              event.key === "Tab"
            ) {
              event.preventDefault();
              onMentionPick();
              return;
            }
            if (event.key === "Escape") {
              event.preventDefault();
              onMentionDismiss();
              return;
            }
          }
          if (value.startsWith("/")) {
            if (event.key === "ArrowUp" && slashCount) {
              event.preventDefault();
              onSlashMove(-1);
              return;
            }
            if (event.key === "ArrowDown" && slashCount) {
              event.preventDefault();
              onSlashMove(1);
              return;
            }
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              if (slashCount) onSlashPick();
              return;
            }
            if (event.key === "Escape") {
              event.preventDefault();
              onChange(value.slice(1));
              return;
            }
          }
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            void send();
            return;
          }
          if (
            event.key === "ArrowUp" &&
            textareaRef.current?.selectionStart === 0 &&
            history.length &&
            (historyIndex === -1 || historyIndex > 0)
          ) {
            event.preventDefault();
            const next =
              historyIndex === -1 ? history.length - 1 : historyIndex - 1;
            setHistoryIndex(next);
            onChange(history[next]);
            return;
          }
          if (event.key === "ArrowDown" && historyIndex !== -1) {
            event.preventDefault();
            const next = historyIndex + 1;
            if (next >= history.length) {
              setHistoryIndex(-1);
              onChange("");
            } else {
              setHistoryIndex(next);
              onChange(history[next]);
            }
          }
        }}
        placeholder={placeholder}
        ref={textareaRef}
        rows={1}
        value={value}
      />
      {maxLength !== undefined && length > 0 ? (
        <p
          className={`px-3 pb-1 text-xs tabular-nums ${over ? "text-error" : "text-dim"}`}
          data-prompt-counter
          id={PROMPT_COUNTER_ID}
          role={over ? "alert" : "status"}
        >
          {over
            ? `${String(length)} / ${String(maxLength)} characters. This model accepts up to ${String(maxLength)}; shorten the prompt${addedLength > 0 ? " or its style and characters" : ""} by ${String(length - maxLength)} or pick another model.`
            : `${String(length)} / ${String(maxLength)}`}
        </p>
      ) : null}
    </div>
  );
}

export function MediaSlashSheet({
  index,
  matches,
  onPick,
}: {
  index: number;
  matches: readonly MediaSlashItem[];
  onPick: (index: number) => void;
}): React.JSX.Element {
  if (!matches.length)
    return (
      <Popover
        open
        side="top"
        className="left-0 right-0 z-30 px-3 py-1.5 text-xs text-dim"
      >
        No matching commands
      </Popover>
    );
  return (
    <CommandMenu
      className="absolute bottom-full left-0 right-0 z-30 mb-1"
      items={matches.map((item) => ({
        description: item.description,
        id: item.id,
        label: `/${item.slash} ${item.title}`,
      }))}
      onSelect={(id) => {
        onPick(matches.findIndex((item) => item.id === id));
      }}
      selected={matches[index]?.id}
    />
  );
}

export function useMediaSlashSheet(
  items: readonly MediaSlashItem[],
  draft: string,
) {
  const [slashIndex, setSlashIndex] = useState(0);
  const slashOpen = draft.startsWith("/");
  // Parakeet owns slash grammar and ranking; Media supplies only its catalog.
  const slashMatches = useMemo(() => {
    if (!slashOpen) return [];
    const completion = completeSlash(
      items.map((item, order) => ({
        alias: item.slash,
        commandId: item.id,
        title: item.title,
        description: item.description,
        category: "Prompt",
        order,
        keys: [],
        availability: { status: "available" },
      })),
      draft,
      { idleCategory: "Prompt" },
    );
    if (completion.kind !== "commands") return [];
    return completion.items.flatMap(
      ({ command }) =>
        items.find((item) => item.id === command.commandId) ?? [],
    );
  }, [draft, items, slashOpen]);
  // A new draft re-ranks the matches, so the best match is highlighted again.
  useEffect(() => {
    setSlashIndex(0);
  }, [draft]);
  return {
    moveSlash: (delta: -1 | 1) => {
      setSlashIndex((current) =>
        slashMatches.length
          ? (current + delta + slashMatches.length) % slashMatches.length
          : 0,
      );
    },
    resetSlash: () => {
      setSlashIndex(0);
    },
    slashIndex,
    slashMatches,
    slashOpen,
  };
}

/** The saved characters offered while an `@name` is being typed. */
export function MediaMentionSheet({
  images,
  index,
  matches,
  onPick,
}: {
  /** Prints-folder images by path, for each character's first reference. */
  images: readonly Readonly<{ path: string; url: string }>[];
  index: number;
  matches: readonly PromptCharacter[];
  onPick: (index: number) => void;
}): React.JSX.Element {
  return (
    <CommandMenu
      aria-label="Characters"
      className="absolute bottom-full left-0 right-0 z-30 mb-1"
      descriptionPlacement="inline"
      items={matches.map((character) => {
        const first = character.references.at(0)?.path;
        const thumbnail = images.find((image) => image.path === first);
        return {
          description: character.description || undefined,
          id: String(character.id),
          label: `@${character.name}`,
          media: (
            <span className="prints-character-thumb mask mask-squircle">
              {thumbnail ? <img src={thumbnail.url} alt="" /> : null}
            </span>
          ),
        };
      })}
      onSelect={(id) => {
        onPick(matches.findIndex((character) => String(character.id) === id));
      }}
      selected={matches[index] ? String(matches[index].id) : undefined}
    />
  );
}

/** Typing `@` offers saved characters; picking one completes the name. */
export function useCharacterMentions(
  characters: readonly PromptCharacter[],
  draft: string,
) {
  const [caret, setCaret] = useState(0);
  const [index, setIndex] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [caretRequest, setCaretRequest] = useState<CaretRequest | null>(null);
  const typing = dismissed === draft ? null : mentionAt(draft, caret);
  const matches = typing ? suggestCharacters(characters, typing.query) : [];
  // A new draft re-ranks the matches, so the best match is highlighted again.
  useEffect(() => {
    setIndex(0);
  }, [draft]);
  return {
    caretRequest,
    matches,
    index,
    setCaret,
    dismiss: () => {
      setDismissed(draft);
    },
    move: (delta: -1 | 1) => {
      setIndex((current) =>
        matches.length
          ? (current + delta + matches.length) % matches.length
          : 0,
      );
    },
    /** The draft with the highlighted character completed, or null. */
    complete: (at: number): string | null => {
      const character = matches.at(at);
      if (!typing || !character) return null;
      const next = `${draft.slice(0, typing.start)}@${character.name} ${draft.slice(caret)}`;
      const position = typing.start + character.name.length + 2;
      setCaretRequest({ value: next, caret: position });
      setCaret(position);
      return next;
    },
  };
}
