import * as Schema from "effect/Schema";
import { mediaLibraryPathSchema } from "@fungi.computer/agar/media";
import { useComputerId } from "@fungi.computer/agar/react";
import { appBackend } from "@fungi.computer/agar/backend";
import { AppError } from "@fungi.computer/agar/errors";
import { mediaSettings } from "./media-settings.js";
import type { AppRoot } from "@fungi.computer/agar";
import {
  computerWriteFile,
  listComputerFiles,
} from "@fungi.computer/agar/computer";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import { useRef, useState } from "react";
import { mediaFolderQuery, printsKeys } from "./media-queries.js";
import { galleryListingQuery, galleryKeys } from "./media-gallery-query.js";

/** Query owns the stored choice; a mutation validates before changing it. */
export function useMediaFolder(app: AppRoot | null) {
  const computerId = useComputerId(app);
  const currentApp = useRef(app);
  currentApp.current = app;
  const client = useQueryClient();
  const query = useQuery(mediaFolderQuery(app));
  // Validate with the gallery's first page rather than a separate probe read.
  const listing = useInfiniteQuery(
    galleryListingQuery(app, query.data?.configured ? query.data.path : null),
  );
  const [editor, setEditor] = useState<{
    app: AppRoot | null;
    computerId: string | null;
  } | null>(null);
  const selected = (owner: typeof editor) =>
    owner?.app === app && owner.computerId === computerId;
  const mutation = useMutation({
    mutationKey: printsKeys.folder(app),
    mutationFn: async ({
      owner,
      id,
      path,
      create,
    }: {
      owner: AppRoot;
      id: string;
      path: string;
      create: boolean;
      queryKey: QueryKey;
    }) => {
      const requireSelection = () => {
        if (
          currentApp.current !== owner ||
          owner.context.get().computerId !== id
        )
          throw new AppError("Computer selection changed", {
            code: "SELECTION_CHANGED",
            retryable: false,
          });
      };
      requireSelection();
      if (create)
        await owner.capabilities.require(computerWriteFile).mkdir({ path });
      requireSelection();
      await listComputerFiles(owner.capabilities, {
        path,
        limit: 1,
        offset: 0,
      });
      requireSelection();
      return mediaSettings(owner.capabilities, {
        operation: "select-folder",
        computerId: id,
        path,
      });
    },
    onSuccess: (_folder, variables) => {
      if (
        variables.owner === currentApp.current &&
        variables.owner.context.get().computerId === variables.id
      )
        setEditor(null);
    },
    onSettled: (_data, _error, variables) =>
      Promise.all([
        client.invalidateQueries({ queryKey: variables.queryKey, exact: true }),
        client.invalidateQueries({
          queryKey: galleryKeys.listing(variables.owner, variables.path),
          exact: true,
        }),
      ]),
  });
  const currentMutation =
    mutation.variables?.owner === app && mutation.variables.id === computerId;
  const busy = query.isFetching || (currentMutation && mutation.isPending);
  const choose = async (
    value: string,
    create: boolean,
  ): Promise<string | null> => {
    if (!app || !computerId || busy)
      return "Computer selection changed. Try again.";
    const path = value.trim();
    if (!Schema.is(mediaLibraryPathSchema)(path))
      return "Enter an absolute Computer folder, such as /media.";
    try {
      await mutation.mutateAsync({
        owner: app,
        id: computerId,
        path,
        create,
        queryKey: printsKeys.folder(app),
      });
      return null;
    } catch {
      return "Could not use this folder. Check its location and your Computer permissions.";
    }
  };
  const unavailable = query.isError || listing.isError;
  return {
    path: unavailable ? null : (query.data?.path ?? null),
    galleryPath:
      unavailable || !query.data?.configured ? null : query.data.path,
    computerId,
    available: app?.capabilities.has(appBackend) === true,
    writable: app?.capabilities.has(computerWriteFile) === true,
    busy,
    error: unavailable
      ? "Your media folder is unavailable. Choose or create a folder."
      : null,
    editing: selected(editor),
    setEditing: (editing: boolean) => {
      setEditor(editing ? { app, computerId } : null);
    },
    choose,
    ensureCreated: async (): Promise<string | null> => {
      if (!query.data) return "Your Prints library is still loading.";
      if (query.data.configured) return null;
      return choose(query.data.path, true);
    },
    recheck: () => {
      void client.invalidateQueries({
        queryKey: galleryKeys.listing(app, query.data?.path ?? null),
        exact: true,
      });
      void client.invalidateQueries({
        queryKey: printsKeys.folder(app),
        exact: true,
      });
    },
  };
}
