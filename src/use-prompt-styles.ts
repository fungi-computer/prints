import type { AppRoot } from "@fungi.computer/agar";
import { describeAppError } from "@fungi.computer/agar/errors";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { printsKeys, promptStylesQuery } from "./media-queries.js";
import { deleteStyle, saveStyle, type PromptStyle } from "./prompt-styles.js";

/** The saved style blocks, plus create/rename/delete that keep the list fresh. */
export function usePromptStyles(app: AppRoot | null) {
  const client = useQueryClient();
  const query = useQuery(promptStylesQuery(app));
  const write = <Variables>(
    run: (
      owner: AppRoot,
      computerId: string,
      variables: Variables,
    ) => Promise<{ readonly styles: readonly PromptStyle[] }>,
  ) => ({
    mutationFn: (variables: Variables) => {
      const computerId = app?.context.get().computerId;
      if (!app || !computerId) throw new Error("No Computer selected");
      return run(app, computerId, variables);
    },
    onSuccess: (data: { readonly styles: readonly PromptStyle[] }) => {
      client.setQueryData(printsKeys.styles(app), data);
    },
  });
  const save = useMutation(
    write(
      (
        owner,
        computerId,
        style: Readonly<{
          id?: number | undefined;
          name: string;
          text: string;
        }>,
      ) => saveStyle(owner.capabilities, computerId, style),
    ),
  );
  const remove = useMutation(
    write((owner, computerId, id: number) =>
      deleteStyle(owner.capabilities, computerId, id),
    ),
  );
  const failure = save.error ?? remove.error ?? query.error;
  return {
    styles: query.data?.styles ?? [],
    error: failure ? describeAppError(failure).message : null,
    busy: save.isPending || remove.isPending,
    save: (
      style: Readonly<{ id?: number | undefined; name: string; text: string }>,
      done: (saved: PromptStyle | undefined) => void,
    ) => {
      save.mutate(style, {
        onSuccess: (data) => {
          done(data.styles.find((entry) => entry.name === style.name));
        },
      });
    },
    remove: (id: number, done: () => void) => {
      remove.mutate(id, { onSuccess: done });
    },
  };
}
