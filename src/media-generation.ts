import { AppError, mediaGeneration } from "@fungi.computer/agar";
import { describeAppError } from "@fungi.computer/agar/errors";
import { useComputerId } from "@fungi.computer/agar/react";
import { computerWriteFile } from "@fungi.computer/agar/computer";
import {
  mediaGenerationReferenceSchema,
  type MediaGenerationReference,
  type MediaGenerationSession,
} from "@fungi.computer/agar/media";
import { queryKeys } from "@fungi.computer/agar/query";
import {
  useInfiniteQuery,
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryKey,
} from "@tanstack/react-query";
import { Option, Schema } from "effect";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  describeGenerationError,
  generationDestinationFor,
  generationInputFor,
  generationPendingLabel,
  modelFor,
  validationMessage,
  GENERATION_UNAVAILABLE_REASON,
  type GenerationDraft,
  type GenerationRecord,
  type GenerationState,
} from "./generation-model.js";
import { mediaModelsQuery } from "./media-queries.js";
import {
  completeGeneration,
  forgetGeneration,
  listGenerations,
  rememberGeneration,
} from "./media-recovery.js";
import {
  normalizePendingGeneration,
  type PendingGeneration,
} from "./media-recovery-contract.js";
import {
  composePrompt,
  promptLengthMessage,
  promptLimitFor,
  type PromptStyle,
} from "./prompt-styles.js";
import { planCharacters, type PromptCharacter } from "./prompt-characters.js";
import type { useMediaFolder } from "./media-folder.js";
import type { GallerySlot } from "./gallery-slots.js";
import { reportCatchFailure } from "./log-event.js";

import type { MediaConnection } from "./media-gallery.js";
export type GenerationEffects = {
  reserve: (slot: GallerySlot) => void;
  saved: (record: GenerationRecord, connection: MediaConnection) => void;
  failed: (key: string, message: string) => void;
};
type RecoveryPage = Awaited<ReturnType<typeof listGenerations>>;
type RecoveryPages = InfiniteData<RecoveryPage, string | null>;
type Command = {
  connection: MediaConnection;
  reference: MediaGenerationReference;
  input: ReturnType<typeof generationInputFor>;
  draft: GenerationDraft;
  /** The prompt and own reference count as typed, before composition. */
  typed: { prompt: string; references: number };
  /** Name of the style whose text leads `input.settings.prompt`. */
  style?: string | undefined;
  /** Saved characters whose text and references `input` was composed with. */
  characters?: readonly string[] | undefined;
};
type Run = Command & {
  session: MediaGenerationSession;
  controller: AbortController;
  recoveryKey: QueryKey;
  ticket: number;
};
const readReference = Schema.decodeUnknownOption(
  Schema.Struct({ reference: mediaGenerationReferenceSchema }),
);

/** Query owns durable recovery pages and mutations; native attempts own cancellation. */
export function useMediaGeneration({
  connection,
  folder,
  effects,
  styles,
  characters,
}: {
  connection: MediaConnection | null;
  folder: ReturnType<typeof useMediaFolder>;
  effects: GenerationEffects;
  styles: readonly PromptStyle[];
  characters: readonly PromptCharacter[];
}) {
  const app = connection?.app ?? null;
  const computerId = useComputerId(app);
  const current = useRef(connection);
  current.current = connection;
  const callbacks = useRef(effects);
  callbacks.current = effects;
  const client = useQueryClient();
  const key = queryKeys.of(app, "prints", "generation");
  const recoveryKey = [...key, "recovery"];
  const modelQuery = useQuery(mediaModelsQuery(app));
  const session = modelQuery.isError ? undefined : modelQuery.data;
  const models = session?.models ?? [];
  const mediaCapability = app?.capabilities.has(mediaGeneration) === true;
  const canGenerate = session?.canGenerate ?? false;
  const modelsError = modelQuery.error
    ? describeAppError(modelQuery.error).message
    : session?.models.length === 0
      ? "The granted Media model registry is empty."
      : null;
  const pending = useInfiniteQuery<
    RecoveryPage,
    Error,
    RecoveryPages,
    QueryKey,
    string | null
  >({
    queryKey: recoveryKey,
    enabled: app !== null && computerId !== null,
    initialPageParam: null,
    queryFn: async ({ pageParam, signal }) => {
      if (!app)
        throw new AppError("Prints disconnected", {
          code: "DISCONNECTED",
          retryable: true,
        });
      if (app.context.get().computerId !== computerId)
        throw new AppError("Computer selection changed", {
          code: "SELECTION_CHANGED",
          retryable: false,
        });
      const page = await listGenerations(app.capabilities, pageParam);
      signal.throwIfAborted();
      return page;
    },
    getNextPageParam: (page: RecoveryPage) => page.next,
  });
  const records = useMemo(
    () =>
      Array.from(
        new Map<string, PendingGeneration>(
          pending.data?.pages
            .flatMap((page) => page.records)
            .map((record) => [record.reference.requestId, record]) ?? [],
        ).values(),
      ),
    [pending.data],
  );
  const active = useRef(new Map<string, AbortController>());
  const ticket = useRef(0);
  const retry = useRef<Command | null>(null);
  const [admissionError, setAdmissionError] = useState<Extract<
    GenerationState,
    { kind: "error" }
  > | null>(null);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const selected = (command: Command) =>
    current.current === command.connection &&
    command.connection.app.context.get().computerId ===
      command.reference.computerId;
  const removeRecord = (queryKey: QueryKey, requestId: string) => {
    client.setQueryData<RecoveryPages>(
      queryKey,
      (previous) =>
        previous && {
          ...previous,
          pages: previous.pages.map((page) => ({
            ...page,
            records: page.records.filter(
              (record) => record.reference.requestId !== requestId,
            ),
          })),
        },
    );
  };
  const generate = useMutation({
    mutationKey: [...key, "run"],
    mutationFn: async (run: Run): Promise<GenerationRecord> => {
      run.controller.signal.throwIfAborted();
      const pendingRecord = normalizePendingGeneration({
        reference: run.reference,
        input: run.input,
        typed: run.typed,
        style: run.style,
        characters: run.characters,
      });
      await rememberGeneration(run.connection.app.capabilities, pendingRecord);
      run.controller.signal.throwIfAborted();
      const attempt = await run.session.restoreAttempt(run.reference);
      let result;
      try {
        result = await attempt.generate(pendingRecord.input, {
          signal: run.controller.signal,
        });
      } finally {
        attempt[Symbol.dispose]();
      }
      await completeGeneration(
        run.connection.app.capabilities,
        pendingRecord.reference,
        result,
      );
      return { input: run.input, result };
    },
    onMutate: (run) => {
      if (!selected(run) || run.controller.signal.aborted) return;
      callbacks.current.reserve({
        key: `${run.reference.computerId}:${run.input.destination.path}`,
        computerId: run.reference.computerId,
        path: run.input.destination.path,
        width: run.draft.width,
        height: run.draft.height,
        pendingLabel: generationPendingLabel(
          modelFor(run.session.models, run.input.settings.model),
        ),
      });
    },
    onSuccess: (record, run) => {
      removeRecord(run.recoveryKey, run.reference.requestId);
      if (retry.current?.reference.requestId === run.reference.requestId)
        retry.current = null;
      if (!selected(run) || run.controller.signal.aborted) return;
      callbacks.current.saved(record, run.connection);
    },
    onError: (cause, run) => {
      reportCatchFailure("generate-media", cause);
      if (!selected(run) || run.controller.signal.aborted) return;
      folder.recheck();
      callbacks.current.failed(
        `${run.reference.computerId}:${run.input.destination.path}`,
        describeGenerationError(cause).message,
      );
    },
    onSettled: (_result, _cause, run) => {
      if (active.current.get(run.reference.requestId) === run.controller)
        active.current.delete(run.reference.requestId);
    },
  });
  const discard = useMutation({
    mutationKey: [...key, "discard"],
    mutationFn: async (
      run: Command & { recoveryKey: QueryKey; controller: AbortController },
    ) => {
      await forgetGeneration(run.connection.app.capabilities, run.reference);
    },
    onSuccess: (_result, run) => {
      removeRecord(run.recoveryKey, run.reference.requestId);
      if (retry.current?.reference.requestId === run.reference.requestId)
        retry.current = null;
    },
    onError: (cause, run) => {
      if (selected(run)) setRecoveryError(describeAppError(cause).message);
    },
    onSettled: (_result, _cause, run) => {
      if (active.current.get(run.reference.requestId) === run.controller)
        active.current.delete(run.reference.requestId);
    },
  });
  const running = useMutationState({
    filters: { mutationKey: key, status: "pending" },
    select: (mutation) =>
      Option.getOrNull(readReference(mutation.state.variables))?.reference
        .requestId,
  });
  const activeGenerations = new Set(running.filter((id) => id !== undefined));
  useEffect(() => {
    setAdmissionError(null);
    setRecoveryError(null);
    retry.current = null;
    const selectedRecoveryKey = queryKeys.of(
      app,
      "prints",
      "generation",
      "recovery",
    );
    const grants = app?.capabilities.subscribe(() => {
      queueMicrotask(() => {
        void client.resetQueries({
          queryKey: selectedRecoveryKey,
          exact: true,
        });
      });
    });
    const stop = () => {
      ticket.current += 1;
      for (const controller of active.current.values()) controller.abort();
      active.current.clear();
      void client.cancelQueries({ queryKey: selectedRecoveryKey });
    };
    const context = app?.context.subscribe((value) => {
      if (value.computerId !== computerId) stop();
    });
    const lifecycle = app?.lifecycle.subscribe((value) => {
      if (
        value === "disposing" ||
        value === "disposed" ||
        value === "disconnected"
      )
        stop();
    });
    return () => {
      context?.();
      lifecycle?.();
      grants?.();
      stop();
    };
  }, [app, computerId, connection, client]);
  const run = (command: Command) => {
    const id = command.reference.requestId;
    if (active.current.has(id)) return false;
    if (!selected(command)) {
      setRecoveryError(
        "Select the original Computer to retry this generation.",
      );
      return false;
    }
    if (session?.computerId !== command.reference.computerId) {
      setRecoveryError(
        "Media access is unavailable for the original Computer.",
      );
      return false;
    }
    const controller = new AbortController();
    active.current.set(id, controller);
    retry.current = command;
    setAdmissionError(null);
    setRecoveryError(null);
    ticket.current += 1;
    generate.mutate({
      ...command,
      session,
      controller,
      ticket: ticket.current,
      recoveryKey,
    });
    return true;
  };
  const submit = async (draft: GenerationDraft) => {
    if (!connection?.app.capabilities.has(computerWriteFile) || !canGenerate)
      return false;
    if (folder.path === null) {
      folder.setEditing(true);
      return false;
    }
    retry.current = null;
    const model = modelFor(models, draft.model);
    if (model === undefined) {
      setAdmissionError({
        kind: "error",
        message: "Choose a model from the granted registry.",
      });
      return false;
    }
    const plan = planCharacters({
      prompt: draft.prompt,
      saved: characters,
      references: draft.references,
      model: { label: model.label, maxReferences: model.input.maxReferences },
    });
    if (plan.kind === "refused") {
      setAdmissionError({ kind: "error", message: plan.message });
      return false;
    }
    // The typed prompt with the characters' references; the expanded prompt's
    // length is checked below, where the message can name what expanded it.
    const invalid = validationMessage(
      { ...draft, references: plan.references },
      model,
    );
    if (invalid) {
      setAdmissionError({ kind: "error", message: invalid });
      return false;
    }
    const style =
      draft.style === undefined
        ? undefined
        : styles.find((entry) => entry.name === draft.style);
    if (draft.style !== undefined && style === undefined) {
      setAdmissionError({
        kind: "error",
        message: `The "${draft.style}" style no longer exists. Pick another or none.`,
      });
      return false;
    }
    const characterNames = plan.characters.map((entry) => entry.name);
    const composed = composePrompt(style?.text, plan.prompt);
    const tooLong = promptLengthMessage(
      composed,
      promptLimitFor(model),
      style?.name,
      characterNames,
    );
    if (tooLong !== undefined) {
      setAdmissionError({ kind: "error", message: tooLong });
      return false;
    }
    if (!mediaCapability || !session) {
      setAdmissionError(null);
      return false;
    }
    const captured = connection;
    const id = captured.app.context.get().computerId;
    const admissionTicket = ticket.current;
    const resolved = {
      ...draft,
      prompt: composed,
      references: plan.references,
      destination: generationDestinationFor(draft, folder.path, model),
    };
    const input = generationInputFor(resolved, model);
    let reference: MediaGenerationReference;
    try {
      const folderError = await folder.ensureCreated();
      if (folderError) {
        setAdmissionError({ kind: "error", message: folderError });
        return false;
      }
      if (
        ticket.current !== admissionTicket ||
        current.current !== captured ||
        captured.app.context.get().computerId !== id
      )
        return false;
      const attempt = await session.createAttempt();
      reference = attempt.reference;
      attempt[Symbol.dispose]();
    } catch (cause) {
      if (
        ticket.current === admissionTicket &&
        current.current === captured &&
        captured.app.context.get().computerId === id
      )
        setAdmissionError({ kind: "error", ...describeGenerationError(cause) });
      return false;
    }
    if (
      ticket.current !== admissionTicket ||
      current.current !== captured ||
      captured.app.context.get().computerId !== id
    )
      return false;
    return run({
      connection: captured,
      reference,
      input,
      draft: resolved,
      typed: {
        prompt: draft.prompt.trim(),
        references: draft.references.length,
      },
      style: style?.name,
      characters: characterNames,
    });
  };
  const latest = generate.variables;
  const attemptState: GenerationState | null =
    admissionError ??
    (latest && selected(latest) && latest.ticket === ticket.current
      ? generate.isPending
        ? { kind: "pending", draft: latest.draft }
        : generate.isError
          ? { kind: "error", ...describeGenerationError(generate.error) }
          : { kind: "completed", record: generate.data }
      : null);
  const state: GenerationState =
    attemptState ??
    (!connection || !mediaCapability || computerId === null
      ? { kind: "unavailable", reason: GENERATION_UNAVAILABLE_REASON }
      : modelsError
        ? { kind: "unavailable", reason: modelsError }
        : session
          ? { kind: "ready" }
          : { kind: "loading" });
  return {
    state,
    models,
    modelsLoading: modelQuery.isFetching,
    modelsError,
    canGenerate,
    mediaCapability,
    retryModels: () => {
      void modelQuery.refetch();
    },
    submit,
    isRunning: () => active.current.size > 0,
    activeGenerations,
    pendingGenerations: records,
    recoveryError:
      recoveryError ??
      (pending.error ? describeAppError(pending.error).message : null),
    reportRecoveryError: (cause: unknown) => {
      setRecoveryError(describeAppError(cause).message);
    },
    hasMore: pending.hasNextPage,
    loadMore: () => {
      if (!pending.isFetching) void pending.fetchNextPage();
    },
    resume: (record: PendingGeneration) => {
      if (!connection || session?.computerId !== record.reference.computerId) {
        setRecoveryError(
          "Select the original Computer to retry this generation.",
        );
        return;
      }
      run({
        connection,
        ...record,
        draft: {
          ...record.input.settings,
          references: record.input.settings.references ?? [],
          destination: record.input.destination.path,
        },
      });
    },
    discard: (record: PendingGeneration) => {
      if (!connection || active.current.has(record.reference.requestId)) return;
      const controller = new AbortController();
      active.current.set(record.reference.requestId, controller);
      discard.mutate({
        ...record,
        connection,
        controller,
        draft: {
          ...record.input.settings,
          references: record.input.settings.references ?? [],
        },
        recoveryKey,
      });
    },
    retryPath: (path: string) => {
      const command = retry.current;
      if (command?.input.destination.path !== path || !selected(command))
        return false;
      run(command);
      return true;
    },
    retry:
      retry.current && selected(retry.current)
        ? () => {
            if (retry.current) run(retry.current);
          }
        : undefined,
    errorKey: `generation:${retry.current?.reference.requestId ?? "draft"}:${String(ticket.current)}`,
  };
}
