import { useAppCommandCatalog } from "@fungi.computer/agar/react";
import { type AppRoot } from "@fungi.computer/agar";
import { slashRegistry } from "@fungi.computer/parakeet/slash";
import {
  type WhistleCommand,
  type WhistleCommandKey,
} from "@fungi.computer/whistle";
import { useCallback, useMemo, useRef, useSyncExternalStore } from "react";

import { SIZE_MODES, SIZE_PRESETS } from "./generation-model.js";
import type { MediaSlashItem } from "./media-composer-pieces.js";

/** What Media's prompt commands change in the live form. */
export type PromptCommandActions = Readonly<{
  clear: () => void;
  useSize: (mode: (typeof SIZE_MODES)[number]) => void;
  /** Open the style picker, where a saved style is chosen or managed. */
  openStyles: () => void;
  /** Send the next prompt without a style. */
  clearStyle: () => void;
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
    {
      id: "choose-style",
      title: "Choose style",
      category: "Prompt",
      description: "Pick, create or edit a saved style",
      projections: { slash: { aliases: ["style"], order: 4 }, palette: {} },
      handler: () => {
        actions().openStyles();
      },
    },
    {
      id: "no-style",
      title: "Use no style",
      category: "Prompt",
      description: "Send the prompt without a style",
      projections: { slash: { aliases: ["nostyle"], order: 5 }, palette: {} },
      handler: () => {
        actions().clearStyle();
      },
    },
  ];
}

/**
 * Own the prompt box's command runtime: its slash rows come only from Media's
 * catalog, and the same catalog is registered with the host for the shell.
 */
/** The prompt box's slash rows and the one door that runs them. */
export type PromptCommands = Readonly<{
  items: readonly MediaSlashItem[];
  run: (command: WhistleCommandKey) => void;
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
        command: command.command,
        slash: command.alias,
        title: command.title,
        description: command.description,
      })),
    [snapshot],
  );
  return {
    items,
    run: (command) => {
      void runtime.execute(command, { origin: "slash" });
    },
  };
}
