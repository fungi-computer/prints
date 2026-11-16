import { useRef } from "react";
import {
  Dialog,
  DialogBackdrop,
  DialogPopup,
  DialogPortal,
  DialogTitle,
} from "@fungi.computer/caps/components/dialog";
import { IconButton } from "@fungi.computer/caps/components/icon-button";
import { ArrowLeft, ArrowRight, X } from "lucide-react";

/** One composer reference the lightbox can show large. */
export type ReferenceSlide = {
  key: string;
  /** The slot it fills, such as First frame, Last frame or the image name. */
  label: string;
  /** Its file name, the picture's alt text. */
  name: string;
  url: string;
};

/** The distance in pixels a horizontal drag must cover to count as a swipe. */
const SWIPE_DISTANCE = 48;

/**
 * One reference, large, over the page. Esc, a click outside or the close key
 * dismisses it; arrow keys, the arrow keys on screen or a swipe move between
 * the composer's references. Focus returns to the reference's thumbnail.
 */
export function ReferenceLightbox({
  slides,
  index,
  onIndexChange,
  onClose,
  returnFocusTo,
}: {
  slides: readonly ReferenceSlide[];
  /** The open slide, or null while closed. */
  index: number | null;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  /** The thumbnail that opened the slide with this key, for focus on close. */
  returnFocusTo: (key: string) => HTMLElement | null;
}) {
  const swipeFrom = useRef<number | null>(null);
  // A drag that ended over the stage is a swipe, never a click outside.
  const dragged = useRef(false);
  const current = index === null ? undefined : slides.at(index);
  const open = current !== undefined;
  // Closing keeps the last slide on screen for the exit, and names the
  // thumbnail that takes focus back.
  const last = useRef<{ slide: ReferenceSlide; index: number } | null>(null);
  if (index !== null && current !== undefined)
    last.current = { slide: current, index };
  const shown = last.current;
  if (shown === null) return null;
  const { slide } = shown;
  const move = (delta: -1 | 1) => {
    const target = shown.index + delta;
    if (target >= 0 && target < slides.length) onIndexChange(target);
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPortal>
        <DialogBackdrop />
        <DialogPopup
          size="fill"
          className="prints-reference-lightbox"
          finalFocus={() => returnFocusTo(slide.key)}
          onClick={(event) => {
            const target = event.target;
            if (dragged.current) {
              dragged.current = false;
              return;
            }
            // The popup fills the window, so "outside" is any of its own
            // empty space: the popup itself, or a bar or stage marked as dismissing.
            if (
              target === event.currentTarget ||
              (target instanceof HTMLElement &&
                target.dataset.dismiss !== undefined)
            )
              onClose();
          }}
          onKeyDown={(event) => {
            if (event.altKey || event.ctrlKey || event.metaKey) return;
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
              event.preventDefault();
              move(event.key === "ArrowLeft" ? -1 : 1);
            }
          }}
        >
          <div className="prints-reference-lightbox-bar" data-dismiss>
            <DialogTitle className="prints-reference-lightbox-title">
              {slide.label}
            </DialogTitle>
            <span
              className="prints-reference-lightbox-position"
              aria-live="polite"
              aria-atomic="true"
            >
              {shown.index + 1} of {slides.length}
            </span>
            <IconButton
              icon={<X />}
              aria-label="Close"
              title="Close (Esc)"
              onClick={onClose}
            />
          </div>
          <div
            className="prints-reference-lightbox-stage"
            data-dismiss
            onPointerDown={(event) => {
              swipeFrom.current = event.clientX;
              dragged.current = false;
            }}
            onPointerUp={(event) => {
              const from = swipeFrom.current;
              swipeFrom.current = null;
              if (from === null) return;
              const travelled = event.clientX - from;
              dragged.current = Math.abs(travelled) > 8;
              if (Math.abs(travelled) >= SWIPE_DISTANCE)
                move(travelled > 0 ? -1 : 1);
            }}
            onPointerCancel={() => {
              swipeFrom.current = null;
            }}
          >
            <img src={slide.url} alt={slide.name} draggable={false} />
          </div>
          <div className="prints-reference-lightbox-actions" data-dismiss>
            <IconButton
              size="default"
              iconSize="md"
              aria-label="Previous reference"
              title="Previous reference (Left arrow)"
              aria-keyshortcuts="ArrowLeft"
              icon={<ArrowLeft />}
              disabled={shown.index === 0}
              onClick={() => {
                move(-1);
              }}
            />
            <IconButton
              size="default"
              iconSize="md"
              aria-label="Next reference"
              title="Next reference (Right arrow)"
              aria-keyshortcuts="ArrowRight"
              icon={<ArrowRight />}
              disabled={shown.index === slides.length - 1}
              onClick={() => {
                move(1);
              }}
            />
          </div>
        </DialogPopup>
      </DialogPortal>
    </Dialog>
  );
}
