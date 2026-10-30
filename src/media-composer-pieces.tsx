import type { WhistleCommandKey } from "@fungi.computer/whistle";
import { SendAction } from "@fungi.computer/caps/components/send-action";
import { isImeComposing } from "@fungi.computer/caps/lib/ime";
import {
  CompletionMenu,
  completionFieldProps,
  completionKeyAction,
} from "@fungi.computer/parakeet/completion-menu";
import { completeSlash } from "@fungi.computer/parakeet/slash";
import { Textarea } from "@fungi.computer/caps/components/textarea";
import {
  composerSendState,
  useComposerTextareaSize,
} from "@fungi.computer/parakeet";
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
  /** Opaque Whistle render key. */
  id: string;
  /** The command's typed Whistle identity; run it by this. */
  command: WhistleCommandKey;
  slash: string;
  title: string;
}>;

/** Element id of the prompt counter, shared by the send button's description. */
const PROMPT_COUNTER_ID = "prints-prompt-counter";

/**
 * The composer's send key: Caps SendAction, the same key the chat composer
 * sends with. Generating, the arrow gives way to a working indicator in the
 * same key. Over the model's prompt limit it is disabled and names the
 * counter's over-limit message as its reason.
 */
export function GenerateButton({
  busy,
  disabled,
  draft,
  label,
  onGenerate,
  promptOver,
}: {
  busy: boolean;
  disabled: boolean;
  draft: string;
  label: string;
  onGenerate: () => void;
  promptOver: boolean;
}): React.JSX.Element {
  return (
    <SendAction
      aria-describedby={promptOver ? PROMPT_COUNTER_ID : undefined}
      aria-label={label}
      className="prints-generate"
      data-generation-submit
      disabled={disabled || promptOver}
      onClick={onGenerate}
      state={composerSendState({ draft, busy })}
      title={label}
    />
  );
}
/** Where the caret belongs once `value` has been written by a mention pick. */
export type CaretRequest = Readonly<{ value: string; caret: number }>;

export function MediaComposerTextarea({
  caretRequest,
  disabled,
  maxLength,
  addedLength = 0,
  menu,
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
  /** The completion menu drawn above the box, for the field's combobox semantics. */
  menu: Readonly<{ open: boolean; listId: string; selected: number }>;
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

  useComposerTextareaSize(textareaRef, value);

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
      // Admission is not completion. Keep the draft, like button submission,
      // so a later provider or save failure cannot erase the creator's prompt.
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }, [disabled, maxLength, onSend, addedLength]);

  const typed = value.trim().length;
  const length = typed > 0 ? typed + addedLength : 0;
  const over = maxLength !== undefined && length > maxLength;
  return (
    <div className="relative min-w-0 flex-1">
      <Textarea
        aria-invalid={over ? true : undefined}
        aria-label="Image prompt"
        className="w-full"
        data-generation-prompt
        {...completionFieldProps(menu)}
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
          const action = completionKeyAction(event);
          if (mentionCount > 0 && action !== null) {
            event.preventDefault();
            if (action === "next") onMentionMove(1);
            else if (action === "previous") onMentionMove(-1);
            else if (action === "accept") onMentionPick();
            else onMentionDismiss();
            return;
          }
          // With no matching command only Enter (never sends a `/` draft) and
          // Escape stay with the menu; Tab and arrows keep their field meaning.
          const slashKey =
            value.startsWith("/") &&
            action !== null &&
            (slashCount > 0 || action === "dismiss" || event.key === "Enter");
          if (slashKey) {
            event.preventDefault();
            if (action === "dismiss") onChange(value.slice(1));
            else if (!slashCount) return;
            else if (action === "next") onSlashMove(1);
            else if (action === "previous") onSlashMove(-1);
            else onSlashPick();
            return;
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
        command: item.command,
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
    highlightSlash: setSlashIndex,
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
  listId,
  matches,
  onHighlight,
  onPick,
}: {
  /** Prints-folder images by path, for each character's first reference. */
  images: readonly Readonly<{ path: string; url: string }>[];
  index: number;
  listId: string;
  matches: readonly PromptCharacter[];
  onHighlight: (index: number) => void;
  onPick: (index: number) => void;
}): React.JSX.Element {
  return (
    <CompletionMenu
      open
      rows={matches.map((character) => {
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
      label="Characters"
      kind="characters"
      onHighlight={onHighlight}
      onChoose={onPick}
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
    highlight: setIndex,
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
