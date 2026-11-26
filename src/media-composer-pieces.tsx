import type { WhistleCommandKey } from "@fungi.computer/whistle";
import { SendAction } from "@fungi.computer/caps/components/send-action";
import { isImeComposing } from "@fungi.computer/caps/lib/ime";
import {
  completionFieldProps,
  completionKeyAction,
} from "@fungi.computer/parakeet/completion-menu";
import { completeSlash } from "@fungi.computer/parakeet/slash";
import { Textarea } from "@fungi.computer/caps/components/textarea";
import { composerSendState } from "@fungi.computer/parakeet";
import type { ComposerLayout } from "./media-composer-size.js";
import {
  mentionAt,
  mentionedNames,
  suggestMentions,
  type MentionOption,
  type PromptCharacter,
  type ReferenceOption,
} from "./prompt-characters.js";
import {
  advanceLedger,
  emptyLedger,
  referenceKey,
  referenceLabel,
  referenceNumbers,
  type MediaReference,
} from "./reference-mentions.js";
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
  disabledReason,
  draft,
  label,
  onGenerate,
  promptOver,
}: {
  busy: boolean;
  disabled: boolean;
  /** Why it is disabled, when the person can fix that; replaces the label as the tooltip. */
  disabledReason?: string | undefined;
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
      title={
        (disabled || promptOver) && disabledReason ? disabledReason : label
      }
    />
  );
}
/** Where the caret belongs once `value` has been written by a mention pick. */
export type CaretRequest = Readonly<{ value: string; caret: number }>;

/** The sentence that names why a prompt over the model's limit cannot be sent. */
export function promptOverMessage({
  addedLength,
  length,
  maxLength,
}: {
  addedLength: number;
  length: number;
  maxLength: number;
}): string {
  return `${String(length)} / ${String(maxLength)} characters. This model accepts up to ${String(maxLength)}; shorten the prompt${addedLength > 0 ? " or its style and characters" : ""} by ${String(length - maxLength)} or pick another model.`;
}

/** The counter shows only near the limit, over the box's corner, so it never adds a row. */
const COUNTER_FROM = 0.8;

/** The height of one line of text, padding included. */
function oneLine(field: HTMLTextAreaElement): number {
  const style = window.getComputedStyle(field);
  const lineHeight = Number.parseFloat(style.lineHeight);
  return (
    (Number.isFinite(lineHeight) ? lineHeight : 26) +
    Number.parseFloat(style.paddingTop) +
    Number.parseFloat(style.paddingBottom)
  );
}

export function MediaComposerTextarea({
  caretRequest,
  layout,
  onOverflow,
  onOver,
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
  /** The composer's size: the auto-grow cap, collapsed and full-screen state. */
  layout: ComposerLayout;
  /** Whether the text is taller than the box, for the phone's expand key. */
  onOverflow: (overflowing: boolean) => void;
  /** Called with the reason when a send is attempted over the model's limit. */
  onOver: (message: string) => void;
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

  const { cap, collapsed, fullscreen } = layout;
  useLayoutEffect(() => {
    const field = textareaRef.current;
    if (!field) return;
    if (fullscreen) {
      // The editor's CSS fills the screen; there is no auto-grow to measure.
      field.style.height = "";
      onOverflow(false);
      return;
    }
    // An empty box is one line; the text grows it up to the cap.
    field.style.height = "auto";
    const line = field.scrollHeight;
    field.style.height = `${String(collapsed ? oneLine(field) : Math.min(line, cap))}px`;
    onOverflow(!collapsed && line > cap + 1);
    // A collapsed box shows its first line only, never a slice of the next.
    if (collapsed) field.scrollTop = 0;
    // A collapsed box that hides more text fades at its foot.
    if (collapsed && line > field.clientHeight + 1)
      field.setAttribute("data-clipped", "");
    else field.removeAttribute("data-clipped");
  }, [value, cap, collapsed, fullscreen, onOverflow]);

  // Opening the editor lands the caret and the view at the end of the text.
  useLayoutEffect(() => {
    const field = textareaRef.current;
    if (!field || !fullscreen) return;
    field.setSelectionRange(field.value.length, field.value.length);
    field.scrollTop = field.scrollHeight;
  }, [fullscreen]);

  const send = useCallback(async () => {
    const draft = latestValue.current.trim();
    if (!draft || disabled || sendingRef.current) return;
    if (maxLength !== undefined && draft.length + addedLength > maxLength) {
      onOver(
        promptOverMessage({
          addedLength,
          length: draft.length + addedLength,
          maxLength,
        }),
      );
      return;
    }
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
  }, [disabled, maxLength, onOver, onSend, addedLength]);

  const typed = value.trim().length;
  const length = typed > 0 ? typed + addedLength : 0;
  const over = maxLength !== undefined && length > maxLength;
  const counting =
    maxLength !== undefined && length >= Math.floor(maxLength * COUNTER_FROM);
  return (
    <div className="relative min-w-0 flex-1">
      <Textarea
        aria-invalid={over ? true : undefined}
        aria-label="Prompt"
        className="w-full"
        data-generation-prompt
        data-counting={counting ? "" : undefined}
        {...completionFieldProps(menu)}
        disabled={disabled === true || sending}
        onChange={(event) => {
          onChange(event.currentTarget.value);
          onCaret(event.currentTarget.selectionStart);
          setHistoryIndex(-1);
        }}
        onScroll={(event) => {
          if (collapsed) event.currentTarget.scrollTop = 0;
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
        style={{ maxHeight: fullscreen ? undefined : cap }}
        rows={1}
        value={value}
      />
      {counting ? (
        <p
          className={`prints-prompt-counter ${over ? "text-error" : "text-dim"}`}
          data-prompt-counter
          id={PROMPT_COUNTER_ID}
          role="status"
          title={
            over
              ? promptOverMessage({ addedLength, length, maxLength })
              : undefined
          }
        >
          {`${String(length)} / ${String(maxLength)}`}
          {over ? (
            <span className="sr-only">
              {" "}
              {promptOverMessage({ addedLength, length, maxLength })}
            </span>
          ) : null}
        </p>
      ) : null}
    </div>
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

/** The name a pick writes after the `@`. */
const pickedName = (option: MentionOption) =>
  option.kind === "reference"
    ? referenceLabel(option.reference.number)
    : option.character.name;

/** One mention in the prompt, drawn as a token with its thumbnail. */
export type MentionToken = Readonly<{
  key: string;
  label: string;
  url?: string | undefined;
  /** False for an `@imageN` whose reference is no longer attached. */
  valid: boolean;
}>;

/** The references and saved characters the prompt mentions, in order of appearance. */
export function mentionTokens(
  prompt: string,
  characters: readonly PromptCharacter[],
  references: readonly ReferenceOption[],
  images: readonly Readonly<{ path: string; url: string }>[],
): readonly MentionToken[] {
  return mentionedNames(prompt).flatMap((name): MentionToken[] => {
    const image = /^image(\d+)$/i.exec(name);
    if (image !== null) {
      const reference = references.find(
        (entry) => entry.number === Number(image.at(1)),
      );
      return [
        {
          key: name.toLowerCase(),
          label: `@${name.toLowerCase()}`,
          url: reference?.url,
          valid: reference !== undefined,
        },
      ];
    }
    const character = characters.find(
      (entry) => entry.name.toLowerCase() === name.toLowerCase(),
    );
    if (character === undefined) return [];
    const first = character.references.at(0)?.path;
    return [
      {
        key: `character:${String(character.id)}`,
        label: `@${character.name}`,
        url: images.find((entry) => entry.path === first)?.url,
        valid: true,
      },
    ];
  });
}

/** Inline tokens for the mentions in the prompt: thumbnail and name. */
export function MediaMentionTokens({
  tokens,
}: {
  tokens: readonly MentionToken[];
}): React.JSX.Element | null {
  if (tokens.length === 0) return null;
  return (
    <ul className="prints-mention-tokens" aria-label="Mentioned in the prompt">
      {tokens.map((token) => (
        <li
          key={token.key}
          className="prints-mention-token"
          data-mention-token={token.label}
          data-invalid={token.valid ? undefined : ""}
          title={token.valid ? undefined : "No longer attached"}
        >
          <span className="prints-mention-thumb mask mask-squircle">
            {token.url ? <img src={token.url} alt="" /> : null}
          </span>
          <span>{token.label}</span>
          {token.valid ? null : <span> · not attached</span>}
        </li>
      ))}
    </ul>
  );
}

/** Typing `@` offers attached references and saved characters; picking one completes the name. */
export function usePromptMentions(
  characters: readonly PromptCharacter[],
  references: readonly ReferenceOption[],
  draft: string,
) {
  const [caret, setCaret] = useState(0);
  const [index, setIndex] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [caretRequest, setCaretRequest] = useState<CaretRequest | null>(null);
  const typing = dismissed === draft ? null : mentionAt(draft, caret);
  const matches = typing
    ? suggestMentions(characters, references, typing.query)
    : [];
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
    /** The draft with the highlighted mention completed, or null. */
    complete: (at: number): string | null => {
      const option = matches.at(at);
      if (!typing || !option) return null;
      const name = pickedName(option);
      const next = `${draft.slice(0, typing.start)}@${name} ${draft.slice(caret)}`;
      const position = typing.start + name.length + 2;
      setCaretRequest({ value: next, caret: position });
      setCaret(position);
      return next;
    },
  };
}

/**
 * The label number of each attached reference, kept across renders so that
 * removing one never renumbers the mentions already in the prompt.
 */
export function useReferenceLabels(
  references: readonly MediaReference[],
  prompt: string,
  computerId: string | null,
): readonly number[] {
  const [ledger, setLedger] = useState(emptyLedger);
  const keys = references.map((reference) =>
    referenceKey(reference, computerId),
  );
  const next = advanceLedger(ledger, keys, prompt);
  // Derived from the props alone; settle it in this render, not after a paint.
  if (next !== ledger) setLedger(next);
  return referenceNumbers(next, keys);
}
