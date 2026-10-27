import type { AppRoot } from "@fungi.computer/agar";
import { AppError } from "@fungi.computer/agar/errors";
import { mediaGeneration } from "@fungi.computer/agar";
import { appBackend } from "@fungi.computer/agar/backend";
import { openMediaGeneration } from "@fungi.computer/agar/media";
import { capabilityQuery, queryKeys } from "@fungi.computer/agar/query";
import { mediaNotices, mediaSettings } from "./media-settings.js";
import { listStyles, readPrintStyle } from "./prompt-styles.js";
import { listCharacters } from "./prompt-characters.js";

export const printsKeys = {
  models: (app: AppRoot | null) => queryKeys.of(app, "prints", "models"),
  folder: (app: AppRoot | null) => queryKeys.of(app, "prints", "folder"),
  dismissals: (app: AppRoot | null) =>
    queryKeys.of(app, "prints", "dismissals"),
  styles: (app: AppRoot | null) => queryKeys.of(app, "prints", "styles"),
  printStyle: (app: AppRoot | null, path: string) =>
    queryKeys.of(app, "prints", "print-style", path),
  characters: (app: AppRoot | null) =>
    queryKeys.of(app, "prints", "characters"),
};

export function mediaModelsQuery(app: AppRoot | null) {
  return {
    ...capabilityQuery(
      app,
      mediaGeneration,
      printsKeys.models(app),
      async (_handle, signal) => {
        if (!app) throw new Error("Prints is disconnected");
        const session = await openMediaGeneration(app.capabilities);
        signal.throwIfAborted();
        return session;
      },
    ),
    enabled: Boolean(
      app?.context.get().computerId && app.capabilities.has(mediaGeneration),
    ),
    // The session contains admitted RPC methods, not JSON to structurally share.
    structuralSharing: false,
  };
}

export function mediaFolderQuery(app: AppRoot | null) {
  const computerId = app?.context.get().computerId;
  return {
    ...capabilityQuery(
      app,
      appBackend,
      printsKeys.folder(app),
      async (_handle, signal) => {
        if (!app || !computerId) throw new Error("No Computer selected");
        const folder = await mediaSettings(app.capabilities, {
          operation: "read-folder",
          computerId,
        });
        signal.throwIfAborted();
        if (app.context.get().computerId !== computerId)
          throw new AppError("Computer selection changed", {
            code: "SELECTION_CHANGED",
            retryable: false,
          });
        return folder;
      },
    ),
    enabled: Boolean(computerId && app.capabilities.has(appBackend)),
  };
}

export function noticeDismissalsQuery(app: AppRoot | null) {
  const computerId = app?.context.get().computerId;
  return {
    ...capabilityQuery(
      app,
      appBackend,
      printsKeys.dismissals(app),
      async (_handle, signal) => {
        if (!app || !computerId) throw new Error("No Computer selected");
        const notices = await mediaNotices(app.capabilities, {
          operation: "read-notices",
          computerId,
        });
        signal.throwIfAborted();
        return notices;
      },
    ),
    enabled: Boolean(computerId && app.capabilities.has(appBackend)),
  };
}

/** Saved style blocks for this installation. */
export function promptStylesQuery(app: AppRoot | null) {
  const computerId = app?.context.get().computerId;
  return {
    ...capabilityQuery(
      app,
      appBackend,
      printsKeys.styles(app),
      async (_handle, signal) => {
        if (!app || !computerId) throw new Error("No Computer selected");
        const styles = await listStyles(app.capabilities, computerId);
        signal.throwIfAborted();
        return styles;
      },
    ),
    enabled: Boolean(computerId && app.capabilities.has(appBackend)),
  };
}

/** The style recorded for the print saved at one Computer path. */
export function printStyleQuery(app: AppRoot | null, path: string | null) {
  const computerId = app?.context.get().computerId;
  return {
    ...capabilityQuery(
      app,
      appBackend,
      printsKeys.printStyle(app, path ?? ""),
      async (_handle, signal) => {
        if (!app || !computerId || path === null)
          throw new Error("No print selected");
        const recorded = await readPrintStyle(
          app.capabilities,
          computerId,
          path,
        );
        signal.throwIfAborted();
        return recorded;
      },
    ),
    enabled: Boolean(
      computerId && path !== null && app.capabilities.has(appBackend),
    ),
  };
}

/** Saved characters for this installation. */
export function promptCharactersQuery(app: AppRoot | null) {
  const computerId = app?.context.get().computerId;
  return {
    ...capabilityQuery(
      app,
      appBackend,
      printsKeys.characters(app),
      async (_handle, signal) => {
        if (!app || !computerId) throw new Error("No Computer selected");
        const characters = await listCharacters(app.capabilities, computerId);
        signal.throwIfAborted();
        return characters;
      },
    ),
    enabled: Boolean(computerId && app.capabilities.has(appBackend)),
  };
}
