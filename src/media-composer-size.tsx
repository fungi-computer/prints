import { Option, Schema } from "effect";
import { reportCatchFailure } from "./log-event.js";
import {
  useCallback,
  useLayoutEffect,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from "react";

/** localStorage key of the person's composer size: `{ maxHeight, collapsed }`. */
export const COMPOSER_STORAGE_KEY = "prints.composer.v1";
/** The auto-grow cap before the person picks one, and what a reset returns to. */
const COMPOSER_DEFAULT_MAX = 160;
/** The smallest cap the handle allows. */
const COMPOSER_MIN_MAX = 96;
const STEP = 24;
const BIG_STEP = 96;
/** A phone's box grows to this share of the visual viewport. */
const PHONE_SHARE = 0.4;

export type ComposerSize = Readonly<{
  maxHeight: number;
  collapsed: boolean;
}>;

const DEFAULT_SIZE: ComposerSize = {
  maxHeight: COMPOSER_DEFAULT_MAX,
  collapsed: false,
};

/** The tallest cap that still leaves the gallery in view. */
export function composerCeiling(viewport: number, pane: number): number {
  return Math.max(
    COMPOSER_MIN_MAX,
    Math.floor(Math.min(viewport * 0.7, pane - 200)),
  );
}

export function clampComposerMax(value: number, ceiling: number): number {
  return Math.round(Math.min(Math.max(value, COMPOSER_MIN_MAX), ceiling));
}

const storedSizeSchema = Schema.fromJsonString(
  Schema.Struct({ maxHeight: Schema.Finite, collapsed: Schema.Boolean }),
);
const decodeStoredSize = Schema.decodeUnknownOption(storedSizeSchema);

/** The stored size, or the defaults when it is missing, blocked or malformed. */
export function readComposerSize(): ComposerSize {
  try {
    const decoded = decodeStoredSize(
      window.localStorage.getItem(COMPOSER_STORAGE_KEY),
    );
    return Option.isSome(decoded)
      ? {
          maxHeight: Math.max(decoded.value.maxHeight, COMPOSER_MIN_MAX),
          collapsed: decoded.value.collapsed,
        }
      : DEFAULT_SIZE;
  } catch (cause) {
    reportCatchFailure("composer-size-read", cause);
    return DEFAULT_SIZE;
  }
}

function writeComposerSize(size: ComposerSize) {
  try {
    window.localStorage.setItem(COMPOSER_STORAGE_KEY, JSON.stringify(size));
  } catch (cause) {
    // Storage can be blocked; the size then lasts for this visit only.
    reportCatchFailure("composer-size-write", cause);
  }
}

function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(false);
  useLayoutEffect(() => {
    const query = window.matchMedia("(pointer: coarse)");
    const update = () => {
      setCoarse(query.matches);
    };
    update();
    query.addEventListener("change", update);
    return () => {
      query.removeEventListener("change", update);
    };
  }, []);
  return coarse;
}

/** The pane around the composer, for the room the gallery keeps. */
function paneOf(anchor: HTMLElement | null): HTMLElement | null {
  return anchor?.closest<HTMLElement>("[data-app-pane]") ?? null;
}

export type ComposerLayout = Readonly<{
  /** The textarea's auto-grow cap in px. */
  cap: number;
  coarse: boolean;
  collapsed: boolean;
  /** A phone's full-screen editor is open. */
  fullscreen: boolean;
  min: number;
  max: number;
  /** The desktop cap the handle sets, already clamped. */
  maxHeight: number;
  setMaxHeight: (value: number) => void;
  reset: () => void;
  setCollapsed: (collapsed: boolean) => void;
  setFullscreen: (open: boolean) => void;
}>;

/**
 * The composer's size: a persisted auto-grow cap and collapsed flag, clamped
 * to the room the pane has now, and the phone's own cap and full-screen mode.
 */
export function useComposerLayout(
  anchor: RefObject<HTMLElement | null>,
): ComposerLayout {
  // A server render has no window: start from defaults, then read the real
  // size, room and pointer before the first paint.
  const [size, setSize] = useState(DEFAULT_SIZE);
  const [ceiling, setCeiling] = useState(composerCeiling(800, 800));
  const [viewport, setViewport] = useState(800);
  const [fullscreen, setFullscreen] = useState(false);
  const coarse = useCoarsePointer();

  useLayoutEffect(() => {
    setSize(readComposerSize());
  }, []);

  useLayoutEffect(() => {
    const measure = () => {
      const pane = paneOf(anchor.current);
      setCeiling(
        composerCeiling(
          window.innerHeight,
          pane?.clientHeight ?? window.innerHeight,
        ),
      );
      setViewport(window.visualViewport?.height ?? window.innerHeight);
    };
    measure();
    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("resize", measure);
    };
  }, [anchor]);

  const maxHeight = clampComposerMax(size.maxHeight, ceiling);
  const update = useCallback((next: ComposerSize) => {
    setSize(next);
    writeComposerSize(next);
  }, []);
  // A phone that leaves coarse mode (a rotated tablet) cannot keep the editor open.
  const editorOpen = fullscreen && coarse;
  return {
    cap: coarse
      ? Math.max(COMPOSER_MIN_MAX, Math.round(viewport * PHONE_SHARE))
      : maxHeight,
    coarse,
    collapsed: size.collapsed,
    fullscreen: editorOpen,
    min: COMPOSER_MIN_MAX,
    max: ceiling,
    maxHeight,
    setMaxHeight: (value) => {
      update({ ...size, maxHeight: clampComposerMax(value, ceiling) });
    },
    reset: () => {
      update({ ...size, maxHeight: COMPOSER_DEFAULT_MAX });
    },
    setCollapsed: (collapsed) => {
      update({ ...size, collapsed });
    },
    setFullscreen,
  };
}

/**
 * The drag handle on the composer's top edge. Dragging up raises the cap the
 * box may auto-grow to; it never pins the box taller than its text.
 */
export function ComposerResizeHandle({
  layout,
}: {
  layout: ComposerLayout;
}): React.JSX.Element | null {
  const [drag, setDrag] = useState<{ y: number; height: number } | null>(null);
  if (layout.coarse) return null;
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? BIG_STEP : STEP;
    const next =
      event.key === "ArrowUp"
        ? layout.maxHeight + step
        : event.key === "ArrowDown"
          ? layout.maxHeight - step
          : event.key === "Home"
            ? layout.min
            : event.key === "End"
              ? layout.max
              : null;
    if (event.key === "Enter") {
      event.preventDefault();
      layout.reset();
    } else if (next !== null) {
      event.preventDefault();
      layout.setMaxHeight(next);
    }
  };
  return (
    <div
      aria-label="Resize prompt"
      aria-orientation="horizontal"
      aria-valuemax={layout.max}
      aria-valuemin={layout.min}
      aria-valuenow={layout.maxHeight}
      aria-valuetext={`${String(layout.maxHeight)} pixels`}
      className="prints-composer-handle"
      data-composer-handle
      data-dragging={drag === null ? undefined : ""}
      onDoubleClick={layout.reset}
      onKeyDown={move}
      onPointerCancel={() => {
        setDrag(null);
      }}
      onPointerDown={(event: PointerEvent<HTMLDivElement>) => {
        // Keep the caret in the prompt while the edge is dragged.
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        setDrag({ y: event.clientY, height: layout.maxHeight });
      }}
      onPointerMove={(event) => {
        if (drag === null) return;
        layout.setMaxHeight(drag.height + (drag.y - event.clientY));
      }}
      onPointerUp={() => {
        setDrag(null);
      }}
      role="separator"
      tabIndex={0}
    />
  );
}
