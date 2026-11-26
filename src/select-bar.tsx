import { Button } from "@fungi.computer/caps/components/button";
import { IconButton } from "@fungi.computer/caps/components/icon-button";
import { FolderInput, Heart, X } from "lucide-react";

/**
 * The bar that takes the library bar's place while tiles are being chosen, at
 * the same height so the wall stays put. Narrow, it is compact and sits above
 * the composer.
 */
export function SelectBar({
  count,
  total,
  canWrite,
  onToggleAll,
  onMove,
  onFavorite,
  onDone,
}: Readonly<{
  count: number;
  total: number;
  canWrite: boolean;
  onToggleAll: () => void;
  onMove: () => void;
  onFavorite: () => void;
  onDone: () => void;
}>): React.JSX.Element {
  const everything = total > 0 && count === total;
  return (
    <div className="prints-select-bar" role="toolbar" aria-label="Selection">
      <span className="prints-select-count" aria-live="polite">
        {count === 0 ? "Choose prints" : `${String(count)} selected`}
      </span>
      <Button
        size="sm"
        variant="ghost"
        className="prints-select-all"
        disabled={total === 0}
        onClick={onToggleAll}
      >
        <span className="prints-select-wide">
          {everything ? "Clear selection" : "Select all in view"}
        </span>
        <span className="prints-select-narrow">
          {everything ? "None" : "All"}
        </span>
      </Button>
      <span className="prints-select-spacer" />
      <Button
        size="sm"
        variant="ghost"
        aria-label="Favorite"
        disabled={count === 0 || !canWrite}
        onClick={onFavorite}
      >
        <Heart aria-hidden size={16} />
        <span className="prints-select-wide">Favorite</span>
      </Button>
      <Button size="sm" disabled={count === 0 || !canWrite} onClick={onMove}>
        <FolderInput aria-hidden size={16} />
        <span className="prints-select-wide">Move to… ({count})</span>
        <span className="prints-select-narrow">Move ({count})</span>
      </Button>
      <IconButton
        className="prints-select-done"
        aria-label="Done selecting"
        title="Done selecting"
        icon={<X />}
        size="sm"
        onClick={onDone}
      />
    </div>
  );
}
