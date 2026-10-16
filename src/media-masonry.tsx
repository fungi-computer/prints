// Retained from Botanical 73713b32490253a1cc9f160e74f232830a7d3683.
import {
  createPositioner,
  type RenderComponentProps,
  useMasonry,
} from "masonic";
import {
  type HTMLAttributes,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Status } from "@fungi.computer/caps/components/status";
import { GenerationFrame } from "@fungi.computer/caps/components/generation-frame";
import { IconButton } from "@fungi.computer/caps/components/icon-button";
import { Loader } from "@fungi.computer/caps/components/loader";
import { isVideoPath } from "./local-images.js";
import { ImagePlus, Info, Check, RotateCcw, X } from "lucide-react";

/** One decoded image in the retained wall. */
export type MediaMasonryItem = {
  height: number;
  key: string;
  onOpen: (path: string) => void;
  onVisible?: () => void;
  path: string;
  referenced?: boolean;
  selected?: boolean;
  referenceDisabled?: boolean;
  onToggleReference?: () => void;
  onInfo?: () => void;
  url: string;
  width: number;
  pending?: boolean;
  pendingLabel?: string;
  error?: string;
  onRetry?: () => void;
  onDismiss?: () => void;
};

/** Wall finish — the protected Media wall has no inter-tile gap. */
const MASONRY_GAP = 0;
const MASONRY_FALLBACK_WIDTH = 320;

// ─────────────────────────────────────────────────────────────────────
// Pure layout — MASONRY (masonic's positioner = the layout engine; zero
// hover mutation — the wall NEVER re-packs on hover). The wall's layout +
// virtualization are MASONIC'S OWN now (createPositioner + useMasonry in
// MediaMasonryWall) — the hand-rolled masonryBands banding and its pure
// computeMasonryLayout wrapper are GONE: BAND_HEIGHT_CAP split rows
// mid-flow → random visual gaps. What stays pure here is the corner-shove
// column rule. Covered by media-gallery.test.mjs.
// ─────────────────────────────────────────────────────────────────────

/** The corner-shove rule: column count scales with BOTH the wall width AND
 *  the tile count — sparse sets span FEWER columns so a handful of images
 *  fills the width deliberately (Krea rhythm): one tile uses one column, up to four use two;
 *  wide walls use three or four, narrow walls use two.
 *
 *  COLS_3_FLOOR (Levi 2026-08-24) — the pane at an EVEN split of a MacBook
 *  Air 13" (1440 logical), rail accounted: 720 - 64 (w-16). Derived, not
 *  magic — 3 columns should start a little below half the screen once the
 *  rail is taken. The wall measures its own region, so this is the real
 *  pane width at the 50/50 split. */
const COLS_3_FLOOR = 720 - 64; // 656
export function masonryColumnCount(itemCount: number, width: number): number {
  if (itemCount <= 0 || !Number.isFinite(width) || width <= 0) return 0;
  if (itemCount === 1) return 1;
  if (itemCount <= 4) return 2;
  if (width >= 1280) return 4;
  if (width >= COLS_3_FLOOR) return 3;
  return 2;
}

function TileMedia({ item }: { item: MediaMasonryItem }): React.JSX.Element {
  return isVideoPath(item.path) ? (
    <video
      aria-label={item.path}
      className="block h-full w-full object-cover"
      data-media-thumb
      loop
      muted
      playsInline
      src={item.url}
    />
  ) : (
    <img
      alt={item.path}
      className="block h-full w-full object-cover"
      data-media-thumb
      src={item.url}
    />
  );
}

/** Gallery actions are siblings of the image button, never nested controls. */
const MediaTileView = memo(function MediaTileView({
  item,
}: {
  item: MediaMasonryItem;
}): React.JSX.Element {
  const surface = useRef<HTMLDivElement>(null);
  useEffect(() => {
    item.onVisible?.();
  }, [item.onVisible]);
  // Once a tile reserves space for an upload or generation, including an
  // overwrite, its result develops inside the same GenerationFrame.
  const [reserved, setReserved] = useState(
    item.pending === true && !item.onVisible,
  );
  if (item.pending && !item.onVisible && !reserved) setReserved(true);
  useLayoutEffect(() => {
    const element = surface.current;
    if (!element || item.pending || reserved) return;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (preference.matches) return;
    let active = true;
    let finish: (() => void) | undefined;
    let revert: (() => void) | undefined;
    const finishOnPreferenceChange = () => finish?.();
    void import("animejs").then(({ animate, spring }) => {
      if (!active) return;
      const motion = animate(element, {
        opacity: { from: 0, to: 1, duration: 160, ease: "outQuad" },
        translateY: {
          from: 6,
          to: 0,
          ease: spring({ bounce: 0.16, duration: 320 }),
        },
        scale: {
          from: 0.985,
          to: 1,
          ease: spring({ bounce: 0.16, duration: 320 }),
        },
      });
      finish = () => {
        void motion.complete();
      };
      revert = () => {
        motion.revert();
      };
    });
    preference.addEventListener("change", finishOnPreferenceChange);
    return () => {
      active = false;
      preference.removeEventListener("change", finishOnPreferenceChange);
      revert?.();
    };
  }, [item.key, item.pending, reserved]);
  return (
    <div
      ref={surface}
      className="prints-gallery-tile"
      data-referenced={item.referenced ? true : undefined}
    >
      <button
        className="block h-full w-full overflow-hidden bg-base-200 p-0 text-left"
        data-media-thumb-wrap
        type="button"
        disabled={item.pending}
        onClick={() => {
          item.onOpen(item.path);
        }}
        onKeyDown={(event) => {
          if (
            event.key.toLowerCase() === "i" &&
            !event.ctrlKey &&
            !event.metaKey &&
            !event.altKey &&
            item.onInfo
          ) {
            event.preventDefault();
            item.onInfo();
          }
        }}
        title={item.path}
      >
        {/* Media fills the tile edge to edge; the selection ring sits inside it. */}
        <div
          className="caps-item block! h-full w-full overflow-hidden rounded-none! border-0! bg-transparent! shadow-none! z-auto! -outline-offset-2!"
          data-selected={item.selected ?? false}
        >
          {item.pending || reserved || item.error ? (
            <GenerationFrame
              data-media-pending={item.pending ? "true" : undefined}
              failure={
                item.error ? (
                  <span title={item.error} className="prints-tile-failed">
                    <Status
                      size="compact"
                      appearance="chip"
                      glyph="bang"
                      tone="error"
                      label="Not saved"
                    />
                  </span>
                ) : undefined
              }
              indicator={
                <Loader decorative size="fill" tone="accent" variant="bloom" />
              }
              label={item.pendingLabel ?? "Preparing image…"}
              status={
                item.pending ? (item.error ? "failed" : "generating") : "done"
              }
            >
              {item.pending ? null : <TileMedia item={item} />}
            </GenerationFrame>
          ) : (
            <TileMedia item={item} />
          )}
        </div>
      </button>
      {item.error ? (
        <div className="prints-gallery-pending-actions">
          {item.onRetry ? (
            <IconButton
              aria-label={`Retry ${item.path}`}
              icon={<RotateCcw />}
              onClick={item.onRetry}
            />
          ) : null}
          {item.onDismiss ? (
            <IconButton
              aria-label={`Dismiss ${item.path}`}
              icon={<X />}
              onClick={item.onDismiss}
            />
          ) : null}
        </div>
      ) : null}
      <div className="prints-gallery-tools">
        {!item.pending && item.onInfo ? (
          <IconButton
            aria-label={`Image info: ${item.path}`}
            title="Image info (I)"
            aria-keyshortcuts="I"
            onClick={item.onInfo}
            icon={<Info />}
          />
        ) : null}
        {!item.pending && item.onToggleReference ? (
          <IconButton
            className="prints-gallery-reference"
            aria-label={`${item.referenced ? "Remove reference" : "Add reference"}: ${item.path}`}
            title={item.referenced ? "Remove reference" : "Add reference"}
            aria-pressed={item.referenced ?? false}
            disabled={item.referenceDisabled}
            onClick={item.onToggleReference}
            icon={item.referenced ? <Check /> : <ImagePlus />}
          />
        ) : null}
      </div>
    </div>
  );
});

/** The grid element — useMasonry renders the wall's container AS this
 *  component, so the grid keeps its data-media-grid receipt (masonic owns
 *  the container style: position/width + height = the virtual total). */
const MediaMasonryGrid = memo(function MediaMasonryGrid({
  children,
  style,
  ...rest
}: HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return (
    <div data-media-grid {...rest} style={style}>
      {children}
    </div>
  );
});

export type MediaFocus = {
  key: string;
  requestId: string;
  onFocus: () => void;
};

export type MediaScrollRef = {
  current: HTMLDivElement | null;
};

function useMediaRegionBox(
  scrollRef: MediaScrollRef,
  itemCount: number,
): { height: number; width: number } {
  const [regionBox, setRegionBox] = useState({ height: 0, width: 0 });
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const measure = () => {
      setRegionBox((previous) => {
        const next = {
          height: element.clientHeight,
          width: element.clientWidth,
        };
        return next.width === previous.width && next.height === previous.height
          ? previous
          : next;
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [scrollRef, itemCount]);
  return regionBox;
}

function useMediaRegionScroll(scrollRef: MediaScrollRef) {
  const [scrollTop, setScrollTop] = useState(0);
  const [isScrolling, setIsScrolling] = useState(false);
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    let timer: null | ReturnType<typeof setTimeout> = null;
    const onScroll = () => {
      setScrollTop(element.scrollTop);
      setIsScrolling(true);
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        setIsScrolling(false);
      }, 150);
    };
    element.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      element.removeEventListener("scroll", onScroll);
      if (timer !== null) clearTimeout(timer);
    };
  }, [scrollRef]);
  return { isScrolling, scrollTop };
}

function useMediaWallPositioner(items: MediaMasonryItem[], width: number) {
  const columnCount = Math.max(1, masonryColumnCount(items.length, width));
  return useMemo(() => {
    const columnWidth = Math.floor(
      (width - (columnCount - 1) * MASONRY_GAP) / columnCount,
    );
    // Keep one Masonic owner across scroll renders. A changed item set or
    // width starts fresh, including when removing items also changes columns.
    const positioner = createPositioner(columnCount, columnWidth, MASONRY_GAP);
    if (columnWidth > 0) {
      items.forEach((item, index) => {
        const aspect = item.height > 0 ? item.width / item.height : 1;
        positioner.set(index, columnWidth / aspect);
      });
    }
    return positioner;
  }, [items, width, columnCount]);
}

/** Each virtual cell preserves the image's aspect ratio. */
const WallCell = memo(function WallCell({
  data,
  width,
}: {
  data: MediaMasonryItem;
  width: number;
}): React.JSX.Element {
  const aspect = data.height > 0 ? data.width / data.height : 1;
  return (
    <div data-media-tile={data.key} style={{ height: width / aspect, width }}>
      <MediaTileView item={data} />
    </div>
  );
});

/** Focus only a mounted, ready tile; Masonic may still be mounting it. */
function focusGalleryTile(viewport: HTMLDivElement, key: string): boolean {
  const tile = Array.from(
    viewport.querySelectorAll<HTMLElement>("[data-media-tile]"),
  ).find((element) => element.dataset.mediaTile === key);
  const button = tile?.querySelector<HTMLButtonElement>(
    "[data-media-thumb-wrap]",
  );
  if (!button || button.disabled) return false;
  button.focus({ preventScroll: true });
  return true;
}

/** A responsive rebuild may replace the button the drawer would restore. */
function restoreGalleryTileFocus(
  viewport: HTMLDivElement,
  key: string,
  rememberWidth: () => void,
): void {
  const document = viewport.ownerDocument;
  if (
    document.activeElement !== document.body ||
    focusGalleryTile(viewport, key)
  ) {
    rememberWidth();
  }
}

/** Reveal Masonic's tile position inside the gallery's own viewport. */
function revealGalleryTile(
  viewport: HTMLDivElement,
  grid: Element,
  position: { top: number; height: number },
): number {
  const top =
    position.top +
    grid.getBoundingClientRect().top -
    viewport.getBoundingClientRect().top +
    viewport.scrollTop;
  if (
    top < viewport.scrollTop ||
    top + position.height > viewport.scrollTop + viewport.clientHeight
  ) {
    viewport.scrollTo({ top, behavior: "instant" });
  }
  return top;
}

/** Masonic owns placement; the image region owns its scrolling viewport. */
const MediaMasonryWall = memo(function MediaMasonryWall({
  items,
  scrollRef,
  focus,
}: {
  items: MediaMasonryItem[];
  scrollRef: MediaScrollRef;
  focus?: MediaFocus;
}): React.JSX.Element {
  const regionBox = useMediaRegionBox(scrollRef, items.length);
  const width = regionBox.width || MASONRY_FALLBACK_WIDTH;
  const wallPositioner = useMediaWallPositioner(items, width);
  const { isScrolling, scrollTop } = useMediaRegionScroll(scrollRef);
  const knownTiles = useRef(new Set<string>());
  const focusedRequest = useRef<string | null>(null);
  const focusedWidth = useRef<number | null>(null);
  useEffect(() => {
    if (!focus) return;
    const alreadyFocused = focusedRequest.current === focus.requestId;
    if (alreadyFocused && focusedWidth.current === width) return;
    const viewport = scrollRef.current;
    const index = items.findIndex((item) => item.key === focus.key);
    const position = wallPositioner.get(index);
    if (!viewport || !position || regionBox.height === 0) return;
    const grid = viewport.querySelector("[data-media-grid]");
    if (!grid) return;
    const top = revealGalleryTile(viewport, grid, position);
    if (alreadyFocused) {
      restoreGalleryTileFocus(viewport, focus.key, () => {
        focusedWidth.current = width;
      });
      return;
    }
    if (focusGalleryTile(viewport, focus.key)) {
      focusedRequest.current = focus.requestId;
      focusedWidth.current = width;
      focus.onFocus();
    } else {
      viewport.scrollTo({ top, behavior: "instant" });
    }
  }, [
    focus,
    items,
    regionBox.height,
    scrollRef,
    scrollTop,
    wallPositioner,
    width,
  ]);

  useEffect(() => {
    const viewport = scrollRef.current;
    if (!viewport || regionBox.width === 0 || regionBox.height === 0) return;
    // Initial directory reads don't navigate. Only newly admitted reservations
    // do; progress, completion, retries and resize keep the user's position.
    const index = items.reduce(
      (latest, item, index) =>
        item.pending && !item.onVisible && !knownTiles.current.has(item.key)
          ? index
          : latest,
      -1,
    );
    knownTiles.current = new Set(items.map((item) => item.key));
    if (index < 0) return;
    // Use Masonic's position even when virtualization hasn't mounted the tile.
    const tile = wallPositioner.get(index);
    const grid = viewport.querySelector("[data-media-grid]");
    if (!tile || !grid) return;
    const offset =
      grid.getBoundingClientRect().top -
      viewport.getBoundingClientRect().top +
      viewport.scrollTop;
    const top = offset + tile.top;
    const bottom = top + tile.height;
    if (
      top >= viewport.scrollTop &&
      bottom <= viewport.scrollTop + viewport.clientHeight
    )
      return;
    viewport.scrollTo({
      top: Math.max(
        0,
        top - Math.max(0, (viewport.clientHeight - tile.height) / 2),
      ),
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
  }, [items, regionBox.width, regionBox.height, scrollRef, wallPositioner]);

  const renderCell = useCallback(
    ({ data, width: cellWidth }: RenderComponentProps<MediaMasonryItem>) => (
      <WallCell data={data} width={cellWidth} />
    ),
    [],
  );

  return useMasonry({
    as: MediaMasonryGrid,
    height: regionBox.height,
    isScrolling,
    itemKey: (item) => item.key,
    items,
    overscanBy: 2,
    positioner: wallPositioner,
    render: renderCell,
    scrollTop,
  });
});

/** The caller owns file access, references, and URL lifetime. */
export function MediaMosaic({
  items,
  scrollRef,
  focus,
}: {
  items: MediaMasonryItem[];
  scrollRef: MediaScrollRef;
  focus?: MediaFocus;
}): React.JSX.Element {
  return (
    <section data-media-mosaic>
      <MediaMasonryWall items={items} scrollRef={scrollRef} focus={focus} />
    </section>
  );
}
