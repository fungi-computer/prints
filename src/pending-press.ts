import { useEffect, useRef, useState, type RefObject } from "react";

/** What a stand-in key hands its menu when the menu's code lands. */
export type PendingKey = { id: symbol; focused: RefObject<boolean> };

// One press is pending at a time, across every stand-in key: the last press
// wins. Safari and Firefox on macOS do not focus a button on a mouse click, so
// blur cannot tell that the person moved on; a pointerdown or keydown outside
// the pressed key does.
let pending: { id: symbol; element: Element } | null = null;

function outside(event: Event) {
  if (pending === null) return;
  // Escape cancels a press even when typed on the pressed key itself.
  const escape = event instanceof KeyboardEvent && event.key === "Escape";
  if (
    escape ||
    !(event.target instanceof Node && pending.element.contains(event.target))
  )
    clearPending();
}

function clearPending() {
  pending = null;
  globalThis.document.removeEventListener("pointerdown", outside, true);
  globalThis.document.removeEventListener("keydown", outside, true);
}

function setPending(id: symbol, element: Element) {
  clearPending();
  pending = { id, element };
  globalThis.document.addEventListener("pointerdown", outside, true);
  globalThis.document.addEventListener("keydown", outside, true);
}

/** Whether this key's press is the pending one (read-only, safe to repeat). */
export function isPendingOpen(id: symbol) {
  return pending?.id === id;
}

/** A menu that has taken over its key clears the press it was opened for. */
export function useClearPendingOnMount(id: symbol) {
  useEffect(() => {
    if (pending?.id === id) clearPending();
  }, [id]);
}

/**
 * A stand-in key shows until its menu code lands. This remembers a press (a
 * click, which Enter and Space also arrive as) and whether the key had focus, so
 * the real menu can open once and keep the person's place.
 */
export function usePendingPress(load: () => void) {
  const [id] = useState(() => Symbol("menu key"));
  const focused = useRef(false);
  const key: PendingKey = { id, focused };
  return {
    key,
    handlers: {
      onBlur: () => {
        focused.current = false;
        if (pending?.id === id) clearPending();
      },
      onClick: (event: { currentTarget: Element }) => {
        setPending(id, event.currentTarget);
        load();
      },
      onFocus: () => {
        focused.current = true;
        load();
      },
      onPointerEnter: load,
    },
  };
}
