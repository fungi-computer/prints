import type { AppRoot } from "@fungi.computer/agar";
import { optimisticMutation } from "@fungi.computer/agar/query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { mediaNotices } from "./media-settings.js";
import { noticeDismissalsQuery, printsKeys } from "./media-queries.js";
import type { PrintsNotice } from "./prints-activity.js";

/** Hide immediately, restore failed writes, and reconcile with the stored keys. */
export function useNoticeDismissals(
  app: AppRoot | null,
  computerId: string | null,
) {
  const query = useQuery(noticeDismissalsQuery(app));
  const mutation = useMutation(
    optimisticMutation({
      queryKey: printsKeys.dismissals(app),
      mutationFn: ({
        owner,
        id,
        keys,
      }: {
        owner: AppRoot;
        id: string;
        keys: readonly string[];
      }) =>
        mediaNotices(owner.capabilities, {
          operation: "dismiss-notices",
          computerId: id,
          keys,
        }),
      apply: (previous: { readonly keys: readonly string[] }, variables) => ({
        keys: [...new Set([...previous.keys, ...variables.keys])].slice(-200),
      }),
    }),
  );
  const dismiss = (keys: readonly string[]) => {
    if (app && computerId && keys.length > 0)
      mutation.mutate({ owner: app, id: computerId, keys });
  };
  const currentMutation =
    mutation.variables?.owner === app && mutation.variables.id === computerId;
  return {
    error:
      currentMutation && mutation.isError
        ? "Could not dismiss activity. Please try again."
        : query.isError
          ? "Could not load dismissed activity. Notices may reappear."
          : null,
    visible: (notices: readonly PrintsNotice[]) =>
      notices.filter(
        (notice) =>
          (notice.blocking ?? false) || !query.data?.keys.includes(notice.key),
      ),
    dismiss: (key: string) => {
      dismiss([key]);
    },
    dismissAll: (notices: readonly PrintsNotice[]) => {
      dismiss(
        notices
          .filter((notice) => !notice.blocking)
          .map((notice) => notice.key)
          .slice(-200),
      );
    },
  };
}
