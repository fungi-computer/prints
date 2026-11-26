import { lazy, Suspense, useEffect, type ComponentProps } from "react";
import { usePendingPress } from "./pending-press.js";
import { GenerationModelTrigger } from "./generation-model-trigger.js";
import type { GenerationModelMenu } from "./generation-model-menu.js";

export type GenerationModelKeyProps = Omit<
  ComponentProps<typeof GenerationModelMenu>,
  "press"
>;

let menuModule:
  Promise<typeof import("./generation-model-menu.js")> | undefined;
/** Loads the menu code once; called right after first paint and on the first touch of the key. */
function loadMenu() {
  menuModule ??= import("./generation-model-menu.js");
  return menuModule;
}

const LazyMenu = lazy(async () => ({
  default: (await loadMenu()).GenerationModelMenu,
}));

/**
 * The generation model's key. The menu behind it (Base UI's menu and its
 * positioning code) loads right after first paint; until then the key shows
 * the same face, so nothing shifts or blanks.
 */
export function GenerationModelKey(props: GenerationModelKeyProps) {
  const { key: pressKey, handlers } = usePendingPress(() => void loadMenu());
  useEffect(() => {
    // After first paint, so the menu code never competes with it.
    const timer = setTimeout(() => void loadMenu(), 0);
    return () => {
      clearTimeout(timer);
    };
  }, []);
  const selected = props.models.find((model) => model.id === props.value);
  return (
    <Suspense
      fallback={
        <GenerationModelTrigger
          aria-haspopup="menu"
          aria-label="Generation model"
          className="btn caps-dropdown-trigger"
          compact={props.compact ?? false}
          data-generation-model={props.value}
          disabled={props.disabled || props.models.length === 0}
          emptyLabel={props.emptyLabel}
          expanded={false}
          {...handlers}
          selected={selected}
          type="button"
        />
      }
    >
      <LazyMenu {...props} press={pressKey} />
    </Suspense>
  );
}
