import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  isPendingOpen,
  useClearPendingOnMount,
  type PendingKey,
} from "./pending-press.js";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@fungi.computer/caps/components/dropdown-menu";
import { menuContainerFor } from "./menu-container.js";
import { modelName, type MediaModel } from "./generation-model.js";
import { GenerationModelTrigger } from "./generation-model-trigger.js";
import { formatPrintCost } from "./print-cost.js";

const tierNames = {
  draft: "Draft",
  balanced: "Balanced",
  premium: "Premium",
  max: "Max",
} satisfies Record<MediaModel["tier"], string>;

/**
 * The muted detail beside a model in the menu: what kind of output it makes
 * and, for video, the lowest per-second price the host's catalog lists. A
 * picture's price depends on its settings, so it shows its tier instead of a
 * guessed figure.
 */
function modelDetail(model: MediaModel): string {
  if (model.kind !== "video" || model.video === null)
    return tierNames[model.tier];
  const lowest = Math.min(
    ...model.video.prices.map((price) => price.silentMilliunitsPerSecond),
  );
  const price = Number.isFinite(lowest) ? formatPrintCost(lowest) : null;
  return price === null ? "Video" : `Video · from ${price}/s`;
}

const noPress = Symbol("no press");

const modelGroups = [
  { kind: "image", label: "Images" },
  { kind: "video", label: "Video" },
] as const;

/**
 * Marks the menu while more rows wait below the visible edge, so the foot fade
 * shows only then: a short menu, or one scrolled to its end, keeps its last row
 * clear.
 */
function watchMenuOverflow(menu: HTMLDivElement): () => void {
  const mark = () => {
    const more = menu.scrollHeight - menu.scrollTop - menu.clientHeight > 1;
    if (more) menu.setAttribute("data-more", "");
    else menu.removeAttribute("data-more");
  };
  mark();
  const frame = requestAnimationFrame(mark);
  menu.addEventListener("scroll", mark, { passive: true });
  return () => {
    cancelAnimationFrame(frame);
    menu.removeEventListener("scroll", mark);
  };
}

/** The generation model's single-choice menu on its key; loaded after first paint. */
export function GenerationModelMenu({
  compact = false,
  disabled,
  emptyLabel,
  models,
  onChange,
  onOpen,
  press,
  value,
}: {
  /** An icon-only key for phones; the name stays in its tooltip and the menu. */
  compact?: boolean;
  disabled: boolean;
  emptyLabel: string;
  models: readonly MediaModel[];
  onChange: (id: string) => void;
  /** The menu opened; the host may load what choosing a model will need. */
  onOpen?: () => void;
  /** What was done to the stand-in key before this menu loaded, read once on mount. */
  press?: PendingKey;
  value: string;
}) {
  const selected = models.find((model) => model.id === value);
  const trigger = useRef<HTMLButtonElement>(null);
  const [start] = useState(() => ({
    focused: press?.focused.current ?? false,
    open: press !== undefined && isPendingOpen(press.id),
  }));
  useClearPendingOnMount(press?.id ?? noPress);
  useLayoutEffect(() => {
    // Opening moves focus into the menu itself; otherwise keep it on the key.
    if (start.focused && !start.open) trigger.current?.focus();
  }, [start]);
  const [menu, setMenu] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (menu === null) return;
    return watchMenuOverflow(menu);
  }, [menu]);
  const [menuContainer, setMenuContainer] = useState<HTMLSpanElement | null>(
    null,
  );
  return (
    <span className="contents" ref={setMenuContainer}>
      <DropdownMenu
        defaultOpen={start.open}
        onOpenChange={(open) => {
          if (open) onOpen?.();
        }}
      >
        <DropdownMenuTrigger
          ref={trigger}
          aria-label="Generation model"
          data-generation-model={value}
          disabled={disabled || models.length === 0}
          render={(props, state) => (
            <GenerationModelTrigger
              {...props}
              compact={compact}
              emptyLabel={emptyLabel}
              expanded={state.open}
              selected={selected}
            />
          )}
        />
        <DropdownMenuContent
          ref={setMenu}
          data-generation-model-menu
          // Keep the native menu in this key's tray scope: model selection must
          // not light-dismiss an already open Settings tray.
          container={menuContainerFor(menuContainer)}
          side="top"
          align="start"
          aria-label="Generation models"
        >
          {modelGroups.map((group, index) => {
            const members = models.filter((model) => model.kind === group.kind);
            return members.length === 0 ? null : (
              <DropdownMenuGroup key={group.kind}>
                {index > 0 ? <DropdownMenuSeparator /> : null}
                <DropdownMenuLabel>{group.label}</DropdownMenuLabel>
                {members.map((model) => (
                  <DropdownMenuCheckboxItem
                    key={model.id}
                    data-generation-model-option={model.id}
                    checked={model.id === value}
                    closeOnClick
                    onSelect={() => {
                      onChange(model.id);
                    }}
                  >
                    <span className="prints-model-row flex items-baseline gap-lg">
                      <span className="min-w-0 flex-1">{modelName(model)}</span>
                      <span className="prints-model-detail">
                        {modelDetail(model)}
                      </span>
                    </span>
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuGroup>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}
