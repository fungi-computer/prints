import { useAppCommandCatalog } from "@fungi.computer/agar/react";
import { type AppRoot } from "@fungi.computer/agar";
import { slashRegistry } from "@fungi.computer/parakeet/slash";
import { type WhistleCommand } from "@fungi.computer/whistle";
import { useCallback, useMemo, useRef, useSyncExternalStore } from "react";

import { SIZE_MODES, SIZE_PRESETS } from "./generation-model.js";
import type { MediaSlashItem } from "./media-composer-pieces.js";

/** What Media's prompt commands change in the live form. */
export type PromptCommandActions = Readonly<{
  clear: () => void;
  useSize: (mode: (typeof SIZE_MODES)[number]) => void;
}>;

/**
 * Media's prompt catalog, defined once: `/clear` and the size presets in the
 * prompt box, and the same commands in the shell's `:` line while Media is
 * focused. Each run reads the latest form actions.
 */
export function mediaPromptCommands(
  actions: () => PromptCommandActions,
): readonly WhistleCommand<never>[] {
  return [
    {
      id: "clear-prompt",
      title: "Clear prompt",
      category: "Prompt",
      description: "Remove the current prompt",
      projections: { slash: { aliases: ["clear"], order: 0 }, palette: {} },
      handler: () => {
        actions().clear();
      },
    },
    ...SIZE_MODES.map((mode, index): WhistleCommand<never> => ({
      id: `size-${mode}`,
      title: `Use ${mode} size`,
      category: "Prompt",
      description: `Use ${String(SIZE_PRESETS[mode].width)} × ${String(SIZE_PRESETS[mode].height)}`,
      projections: {
        slash: { aliases: [mode], order: index + 1 },
        palette: {},
      },
      handler: () => {
        actions().useSize(mode);
      },
    })),
  ];
}

/**
 * Own the prompt box's command runtime: its slash rows come only from Media's
 * catalog, and the same catalog is registered with the host for the shell.
 */
/** The prompt box's slash rows and the one door that runs them. */
export type PromptCommands = Readonly<{
  items: readonly MediaSlashItem[];
  run: (commandId: string) => void;
}>;

export function usePromptCommands(
  actions: PromptCommandActions,
  app: AppRoot | undefined,
): PromptCommands {
  const latest = useRef(actions);
  latest.current = actions;
  const build = useCallback(
    () => mediaPromptCommands(() => latest.current),
    [],
  );
  const runtime = useAppCommandCatalog(
    app,
    { sourceId: "media-prompt", namespace: "media" },
    build,
  );
  const snapshot = useSyncExternalStore(
    runtime.subscribe,
    runtime.snapshot,
    runtime.snapshot,
  );
  const items = useMemo(
    () =>
      slashRegistry(snapshot).map((command): MediaSlashItem => ({
        id: command.commandId,
        slash: command.alias,
        title: command.title,
        description: command.description,
      })),
    [snapshot],
  );
  return {
    items,
    run: (commandId) => {
      void runtime.execute(commandId, { origin: "slash" });
    },
  };
}
