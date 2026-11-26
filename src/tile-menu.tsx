import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@fungi.computer/caps/components/dropdown-menu";
import { useLayoutEffect, useRef, useState } from "react";
import {
  isPendingOpen,
  useClearPendingOnMount,
  type PendingKey,
} from "./pending-press.js";
import { Check, FolderInput, Heart, ImagePlus, Info } from "lucide-react";
import { TileMenuButton } from "./tile-menu-button.js";
import type { MediaMasonryItem } from "./media-masonry.js";

/** The tile's folder actions menu; loaded after first paint. */
export default function TileMenuContent({
  item,
  press,
}: {
  item: MediaMasonryItem;
  /** What was done to the stand-in key before this menu loaded, read once on mount. */
  press: PendingKey;
}) {
  const [start] = useState(() => ({
    focused: press.focused.current,
    open: isPendingOpen(press.id),
  }));
  useClearPendingOnMount(press.id);
  const trigger = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    // Opening moves focus into the menu itself; otherwise keep it on the key.
    if (start.focused && !start.open) trigger.current?.focus();
  }, [start]);
  return (
    <DropdownMenu defaultOpen={start.open}>
      <DropdownMenuTrigger
        ref={trigger}
        render={(props) => <TileMenuButton {...props} path={item.path} />}
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
        {item.onToggleReference ? (
          <DropdownMenuItem
            disabled={item.referenceDisabled}
            onSelect={item.onToggleReference}
          >
            {item.referenced ? (
              <Check aria-hidden size={16} />
            ) : (
              <ImagePlus aria-hidden size={16} />
            )}{" "}
            {item.referenced ? "Remove reference" : "Add reference"}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
