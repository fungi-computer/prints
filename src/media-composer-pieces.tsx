import { Popover } from "@fungi.computer/caps/components/popover";
import { isImeComposing } from "@fungi.computer/caps/lib/ime";
import { CommandMenu } from "@fungi.computer/caps/blocks/command-menu";
import { completeSlash } from "@fungi.computer/parakeet/slash";
import { Textarea } from "@fungi.computer/caps/components/textarea";
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

export function MediaComposerTextarea({
  disabled,
  onChange,
  onSend,
  onSlashMove,
  onSlashPick,
  placeholder,
  slashCount,
  value,
}: {
  disabled?: boolean;
  onChange: (value: string) => void;
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
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${String(Math.min(textarea.scrollHeight, 160))}px`;
  }, [value]);

  const send = useCallback(async () => {
    const draft = latestValue.current.trim();
    if (!draft || disabled || sendingRef.current) return;
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
  }, [disabled, onChange, onSend]);

  return (
    <div className="relative min-w-0 flex-1">
      <Textarea
        aria-label="Image prompt"
        className="min-h-12 max-h-40 w-full resize-none !border-0 !bg-transparent !shadow-none focus:!outline-none"
        data-generation-prompt
        disabled={disabled === true || sending}
        onChange={(event) => {
          onChange(event.currentTarget.value);
          setHistoryIndex(-1);
        }}
        onKeyDown={(event) => {
          if (isImeComposing(event)) return;
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
