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
import { FailureLine } from "@fungi.computer/caps/components/failure-line";
import { GenerationFrame } from "@fungi.computer/caps/components/generation-frame";
import { IconButton } from "@fungi.computer/caps/components/icon-button";
import { Loader } from "@fungi.computer/caps/components/loader";
import { isAudioPath } from "./audio-media.js";
import { AudioTileFace, AudioTilePlay, AudioTileScope } from "./audio-tile.js";
import { isVideoPath } from "./local-images.js";
import { Checkbox } from "@fungi.computer/caps/components/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@fungi.computer/caps/components/dropdown-menu";
import {
  Check,
  Clock,
  Ellipsis,
  FolderInput,
  Heart,
  ImagePlus,
  Info,
  Upload,
} from "lucide-react";

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
  /** What the print was asked for, so a failed tile says which one it was. */
  prompt?: string | undefined;
  onRetry?: () => void;
  onDismiss?: () => void;
  /** Where the print came from: its model and a clip's seconds, or an upload. */
  badge?: Readonly<{ label: string | null; seconds: number | null }>;
  /** The library folder a print sits in, shown where several folders mix. */
  folderCaption?: string | undefined;
  favorite?: boolean;
  onToggleFavorite?: () => void;
  onMove?: () => void;
  /** In select mode a tile toggles instead of opening. */
  select?: Readonly<{
    active: boolean;
    checked: boolean;
    onToggle: () => void;
  }>;
};

/** Wall finish: one gutter between tiles and around the wall, in px. It is
 *  Caps' `--spacing-sm` (0.5rem) at the 16px root; masonic needs a number. */
const MASONRY_GAP = 8;
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

/** A sparse wall has at most this many tiles. */
const SPARSE_TILE_LIMIT = 4;
/** Below this pane width the wall is a phone's. */
const PHONE_WIDTH = 640;

/** The corner-shove rule: column count scales with BOTH the wall width AND
 *  the tile count — sparse sets span FEWER columns so a handful of images
 *  fills the width deliberately (Krea rhythm): one tile uses one column, two use
 *  two, three or four use three on a wide pane (two on a narrow one, one on a
 *  phone, full-width); a full wall uses four, three or two as the pane allows.
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
  if (itemCount <= SPARSE_TILE_LIMIT) {
    if (width < PHONE_WIDTH) return 1;
    return itemCount === 2 || width < COLS_3_FLOOR ? 2 : 3;
  }
  if (width >= 1280) return 4;
  if (width >= COLS_3_FLOOR) return 3;
  return 2;
}

function TileMedia({ item }: { item: MediaMasonryItem }): React.JSX.Element {
  if (isAudioPath(item.path)) return <AudioTileFace url={item.url} />;
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
const TileBody = memo(function TileBody({
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
      {item.error ? (
        <div
          className="block h-full w-full overflow-hidden bg-base-200"
          data-media-failed
          title={item.path}
        >
          <GenerationFrame
            status="failed"
            failure={
              <div className="flex max-w-full flex-col items-center gap-xs">
                {item.prompt ? (
                  <p className="m-0 max-w-full truncate px-md text-xs text-(--stipe-fg-muted)">
                    {item.prompt}
                  </p>
                ) : null}
                <FailureLine
                  density="tile"
                  message={item.error}
                  onRetry={item.onRetry}
                  onDismiss={item.onDismiss}
                />
              </div>
            }
          />
        </div>
      ) : (
        <button
          className="block h-full w-full overflow-hidden bg-base-200 p-0 text-left"
          data-media-thumb-wrap
          type="button"
          disabled={item.pending}
          aria-pressed={item.select?.active ? item.select.checked : undefined}
          onClick={() => {
            if (item.select?.active) item.select.onToggle();
            else item.onOpen(item.path);
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
            {item.pending || reserved ? (
              <GenerationFrame
                data-media-pending={item.pending ? "true" : undefined}
                indicator={
                  <Loader
                    decorative
                    size="fill"
                    tone="accent"
                    variant="bloom"
                  />
                }
                label={item.pendingLabel ?? "Preparing image…"}
                status={item.pending ? "generating" : "done"}
              >
                {item.pending ? null : <TileMedia item={item} />}
              </GenerationFrame>
            ) : (
              <TileMedia item={item} />
            )}
          </div>
        </button>
      )}
      {!item.pending && !item.error ? <TileLibraryMarks item={item} /> : null}
      <div className="prints-gallery-tools">
        {!item.pending && !item.error ? <TileMenu item={item} /> : null}
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

/** A print's tile; an audio print's face and play key share one playback. */
const MediaTileView = memo(function MediaTileView({
  item,
}: {
  item: MediaMasonryItem;
}): React.JSX.Element {
  return isAudioPath(item.path) ? (
    <AudioTileScope url={item.url}>
      <TileBody item={item} />
    </AudioTileScope>
  ) : (
    <TileBody item={item} />
  );
});

const formatSeconds = (seconds: number): string => `${String(seconds)}s`;

/** Library marks over the picture: a favorite heart or select box on the left, the
 *  source badge below, and a menu of folder actions. Siblings of the open button. */
function TileLibraryMarks({
  item,
}: {
  item: MediaMasonryItem;
}): React.JSX.Element | null {
  const { select } = item;
  return (
    <>
      {isAudioPath(item.path) && item.url !== "" ? (
        <AudioTilePlay title={item.path} />
      ) : null}
      <div
        className="prints-tile-mark"
        data-checked={select?.active ? select.checked : undefined}
        data-favorite={item.favorite ? true : undefined}
      >
        {select?.active ? (
          <Checkbox
            appearance="compact"
            aria-label={`Select ${item.path}`}
            checked={select.checked}
            onChange={select.onToggle}
          />
        ) : item.onToggleFavorite ? (
          <IconButton
            aria-label={`${item.favorite ? "Unfavorite" : "Favorite"}: ${item.path}`}
            aria-pressed={item.favorite ?? false}
            className="prints-tile-heart"
            icon={<Heart fill={item.favorite ? "currentColor" : "none"} />}
            onClick={item.onToggleFavorite}
            title={item.favorite ? "Remove from favorites" : "Favorite"}
          />
        ) : null}
      </div>
      {item.badge ? (
        <div className="prints-tile-badge" data-media-badge>
          {item.badge.label === null ? (
            <>
              <Upload aria-hidden size={12} />
              <span>Upload</span>
            </>
          ) : (
            <>
              <span className="prints-tile-badge-model">
                {item.badge.label}
              </span>
              {item.badge.seconds === null ? null : (
                <>
                  <Clock aria-hidden size={12} />
                  <span>{formatSeconds(item.badge.seconds)}</span>
                </>
              )}
            </>
          )}
        </div>
      ) : null}
      {item.folderCaption ? (
        <div className="prints-tile-folder" title={item.folderCaption}>
          {item.folderCaption}
        </div>
      ) : null}
    </>
  );
}

/** The tile's folder actions, beside Image info in the hover tools. */
function TileMenu({
  item,
}: {
  item: MediaMasonryItem;
}): React.JSX.Element | null {
  if (!item.onMove || item.select?.active) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <IconButton
            aria-label={`More actions: ${item.path}`}
            title="More actions"
            icon={<Ellipsis />}
          />
        }
      />
      <DropdownMenuContent>
        <DropdownMenuItem onSelect={item.onMove}>
          <FolderInput aria-hidden size={16} /> Move to…
        </DropdownMenuItem>
        {item.onToggleFavorite ? (
          <DropdownMenuItem onSelect={item.onToggleFavorite}>
            <Heart aria-hidden size={16} />{" "}
            {item.favorite ? "Remove from favorites" : "Favorite"}
          </DropdownMenuItem>
        ) : null}
        {item.onInfo ? (
          <DropdownMenuItem onSelect={item.onInfo}>
            <Info aria-hidden size={16} /> Image info
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

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

/** Whole-pixel tile height: fractional heights leave 1px seams between
 *  stacked tiles once Masonic accumulates them into positions. */
function tileHeight(width: number, item: MediaMasonryItem): number {
  const aspect = item.height > 0 ? item.width / item.height : 1;
  return Math.round(width / aspect);
}

/** One picture shows whole: its column narrows to the window-high aspect
 *  box and the grid centres it, so no crop and no empty card. */
function wallColumnWidth(
  items: MediaMasonryItem[],
  width: number,
  columnCount: number,
  regionHeight: number,
): number {
  const full = Math.floor(
    (width - (columnCount - 1) * MASONRY_GAP) / columnCount,
  );
  const only = items.length === 1 ? items[0] : undefined;
  if (!only || regionHeight <= 0) return full;
  const aspect = only.height > 0 ? only.width / only.height : 1;
  return Math.max(1, Math.min(full, Math.floor(regionHeight * aspect)));
}

function useMediaWallPositioner(
  items: MediaMasonryItem[],
  paneWidth: number,
  paneHeight: number,
) {
  // A Library wall keeps two columns on a phone however few prints a folder holds.
  const library = items.some((item) => item.select !== undefined);
  const columnCount = Math.max(
    1,
    masonryColumnCount(items.length, paneWidth),
    library && items.length >= 2 ? 2 : 1,
  );
  const width = paneWidth - 2 * MASONRY_GAP;
  const regionHeight = paneHeight - 2 * MASONRY_GAP;
  return useMemo(() => {
    const columnWidth = wallColumnWidth(
      items,
      width,
      columnCount,
      regionHeight,
    );
    // Keep one Masonic owner across scroll renders. A changed item set or
    // width starts fresh, including when removing items also changes columns.
    const positioner = createPositioner(columnCount, columnWidth, MASONRY_GAP);
    if (columnWidth > 0) {
      items.forEach((item, index) => {
        positioner.set(index, tileHeight(columnWidth, item));
      });
    }
    return positioner;
  }, [items, width, columnCount, regionHeight]);
}

/** Each virtual cell preserves the image's aspect ratio. */
const WallCell = memo(function WallCell({
  data,
  width,
}: {
  data: MediaMasonryItem;
  width: number;
}): React.JSX.Element {
  return (
    <div
      data-media-tile={data.key}
      style={{ height: tileHeight(width, data), width }}
    >
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
  // One layout for every count: the same inset and gutter, tiles at their own
  // aspect. A lone picture is the only wall that is centred and fitted to the
  // window; every other wall starts at the top, newest first.
  const sole = items.length === 1 && regionBox.height > 0;
  const wallWidth = width - 2 * MASONRY_GAP;
  const wallHeight = regionBox.height - 2 * MASONRY_GAP;
  const wallPositioner = useMediaWallPositioner(items, width, regionBox.height);
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
    // The wall is newest first, so the first new reservation is the newest.
    const index = items.findIndex(
      (item) =>
        item.pending && !item.onVisible && !knownTiles.current.has(item.key),
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
    // The newest tile leads the wall: bring it to the top edge, not the middle.
    viewport.scrollTo({
      top: Math.max(0, top - MASONRY_GAP),
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

  const wall = useMasonry({
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
  // One stable wrapper keeps tiles mounted as the count changes.
  return (
    <div
      data-media-sole={sole ? "" : undefined}
      style={{
        boxSizing: "border-box",
        padding: MASONRY_GAP,
        ...(sole
          ? {
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              minHeight: regionBox.height,
            }
          : undefined),
      }}
    >
      <div
        style={{
          width: sole
            ? wallColumnWidth(items, wallWidth, 1, wallHeight)
            : "100%",
        }}
      >
        {wall}
      </div>
    </div>
  );
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
