import type { AppRoot } from "@fungi.computer/agar";
import { describeAppError } from "@fungi.computer/agar/errors";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { printsKeys, promptCharactersQuery } from "./media-queries.js";
import {
  deleteCharacter,
  saveCharacter,
  type PromptCharacter,
} from "./prompt-characters.js";

type Edited = Readonly<{
  id?: number | undefined;
  name: string;
  description: string;
  references: readonly { path: string }[];
}>;

/** The saved characters, plus create/rename/delete that keep the list fresh. */
export function usePromptCharacters(app: AppRoot | null) {
  const client = useQueryClient();
  const query = useQuery(promptCharactersQuery(app));
  const write = <Variables>(
    run: (
      owner: AppRoot,
      computerId: string,
      variables: Variables,
    ) => Promise<{ readonly characters: readonly PromptCharacter[] }>,
  ) => ({
    mutationFn: (variables: Variables) => {
      const computerId = app?.context.get().computerId;
      if (!app || !computerId) throw new Error("No Computer selected");
      return run(app, computerId, variables);
    },
    onSuccess: (data: { readonly characters: readonly PromptCharacter[] }) => {
      client.setQueryData(printsKeys.characters(app), data);
    },
  });
  const save = useMutation(
    write((owner, computerId, character: Edited) =>
      saveCharacter(owner.capabilities, computerId, character),
    ),
  );
  const remove = useMutation(
    write((owner, computerId, id: number) =>
      deleteCharacter(owner.capabilities, computerId, id),
    ),
  );
  const failure = save.error ?? remove.error ?? query.error;
  return {
    characters: query.data?.characters ?? [],
    error: failure ? describeAppError(failure).message : null,
    busy: save.isPending || remove.isPending,
    save: (character: Edited, done: () => void) => {
      save.mutate(character, { onSuccess: done });
    },
    remove: (id: number, done: () => void) => {
      remove.mutate(id, { onSuccess: done });
    },
  };
}
