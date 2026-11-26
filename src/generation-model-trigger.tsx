import { ComposerModelKey } from "@fungi.computer/parakeet";
import { KeycapButton } from "@fungi.computer/caps/components/keycap";
import { ChevronDown, Cpu } from "lucide-react";
import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { modelName, type MediaModel } from "./generation-model.js";

type TriggerProps = Omit<
  ComponentPropsWithoutRef<"button">,
  "children" | "title"
> & {
  /** An icon-only key for phones; the name stays in its tooltip. */
  compact: boolean;
  emptyLabel: string;
  expanded: boolean;
  selected: MediaModel | undefined;
};

/**
 * The generation model's key face. The menu's trigger renders it, and so does
 * the first paint before the menu code has loaded, so the two look identical.
 */
export const GenerationModelTrigger = forwardRef<
  HTMLButtonElement,
  TriggerProps
>(function GenerationModelTrigger(
  { compact, emptyLabel, expanded, selected, ...props },
  ref,
) {
  const name = selected === undefined ? emptyLabel : modelName(selected);
  return compact ? (
    <KeycapButton
      {...props}
      ref={ref}
      className="parakeet-composer-model-key"
      expanded={expanded}
      icon={<Cpu />}
      label={null}
      readout={
        <ChevronDown
          aria-hidden="true"
          className="size-[var(--stipe-icon-size-sm)] shrink-0"
        />
      }
      title={name}
    />
  ) : (
    <ComposerModelKey {...props} ref={ref} expanded={expanded} label={name} />
  );
});
