import { AppError, mediaGeneration } from "@fungi.computer/agar";
import {
  describeAppError,
  type ErrorDescription,
} from "@fungi.computer/agar/errors";
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
  draftFromInput,
  wallSizeFor,
  generationFailureOf,
  generationDestinationFor,
  generationInputFor,
  generationPendingLabel,
  modelFor,
  resolveReferenceRoles,
  validationMessage,
  GENERATION_UNAVAILABLE_REASON,
  type GenerationDraft,
  type GenerationRecord,
  type GenerationState,
} from "./generation-model.js";

import {
  MAX_GENERATIONS_IN_FLIGHT,
  GenerationLimitError,
  generationHoldMs,
  generationLimitReason,
} from "./generation-limit.js";
import {
  operationInputFor,
  operationModelFor,
  operationRefusal,
  OPERATION_LABELS,
  type OperationSource,
  type PrintOperation,
} from "./print-operations.js";
import { mediaModelsQuery } from "./media-queries.js";
import {
  completeGeneration,
  failGeneration,
  forgetGeneration,
  listGenerations,
  rememberGeneration,
} from "./media-recovery.js";
import {
  normalizePendingGeneration,
  type GenerationFailure,
  type PendingGeneration,
} from "./media-recovery-contract.js";
import {
  composePrompt,
  promptLengthMessage,
  promptLimitFor,
  type PromptStyle,
} from "./prompt-styles.js";
import {
  plainPlan,
  planCharacters,
  type PromptCharacter,
} from "./prompt-characters.js";
import {
  mentionedReferenceNumbers,
  referenceWording,
  relabelReferenceMentions,
} from "./reference-mentions.js";
import type { useMediaFolder } from "./media-folder.js";
import type { GallerySlot } from "./gallery-slots.js";
import { reportCatchFailure } from "./log-event.js";

import type { MediaConnection } from "./media-gallery.js";
export type GenerationEffects = {
  reserve: (slot: GallerySlot) => void;
  saved: (record: GenerationRecord, connection: MediaConnection) => void;
  failed: (key: string, message: string) => void;
  /** Drop a reserved slot whose run was stopped, so the remembered record's Retry and Dismiss tile shows. */
  release: (key: string) => void;
  /** One presentation owner for admission, execution and recovery failures. */
  notifyFailure: (message: string) => void;
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
  resumed?: boolean;
  session: MediaGenerationSession;
  controller: AbortController;
  recoveryKey: QueryKey;
  ticket: number;
};
/** One run's failure, kept beside the others so none overwrites another. */
type RunFailure = Readonly<{
  requestId: string;
  path: string;
  mediaKind: Extract<GenerationState, { kind: "error" }>["mediaKind"];
  message: string;
  action: ErrorDescription["action"] | undefined;
  /** What the run was asked for, so the failure says which print. */
  prompt: string;
}>;
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
  const autoResumed = useRef(new Set<string>());
  const ticket = useRef(0);
  /** Every run's command until it succeeds or is dismissed, by request id. */
  const commands = useRef(new Map<string, Command>());
  /** Runs the person stopped, so their abort records a Retry-able failure. */
  const stopping = useRef(new Set<string>());
  /**
   * When each stopped run was stopped. Stop ends the waiting, not the paid
   * provider call, so a stopped run keeps its place until the hold passes.
   */
  const stoppedAt = useRef(new Map<string, number>());
  const holdTimers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const [, setHoldTick] = useState(0);
  const [failures, setFailures] = useState<readonly RunFailure[]>([]);
  const [admissionError, setAdmissionError] = useState<Extract<
    GenerationState,
    { kind: "error" }
  > | null>(null);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const refuseAdmission = (
    failure: Extract<GenerationState, { kind: "error" }>,
  ) => {
    setAdmissionError(failure);
    callbacks.current.notifyFailure(failure.message);
  };
  const failRecovery = (message: string) => {
    setRecoveryError(message);
    callbacks.current.notifyFailure(message);
  };
  const reportedRecoveryQueryError = useRef<Error | null>(null);
  useEffect(() => {
    if (reportedRecoveryQueryError.current === pending.error) return;
    reportedRecoveryQueryError.current = pending.error;
    if (pending.error)
      callbacks.current.notifyFailure(describeAppError(pending.error).message);
  }, [pending.error]);
  const selected = (command: Command) =>
    current.current === command.connection &&
    command.connection.app.context.get().computerId ===
      command.reference.computerId;
  /** Show a remembered run as failed (or running again) without waiting for a refetch. */
  const markFailure = (
    queryKey: QueryKey,
    requestId: string,
    failure: GenerationFailure | undefined,
  ) => {
    client.setQueryData<RecoveryPages>(
      queryKey,
      (previous) =>
        previous && {
          ...previous,
          pages: previous.pages.map((page) => ({
            ...page,
            records: page.records.map((record) =>
              record.reference.requestId === requestId
                ? { ...record, failure }
                : record,
            ),
          })),
        },
    );
  };
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
  /** Show a run that is not in the remembered list yet, with its failure. */
  const upsertRecord = (queryKey: QueryKey, record: PendingGeneration) => {
    client.setQueryData<RecoveryPages>(queryKey, (previous) => {
      if (!previous) return previous;
      const known = previous.pages.some((page) =>
        page.records.some(
          (entry) => entry.reference.requestId === record.reference.requestId,
        ),
      );
      if (known) return previous;
      return {
        ...previous,
        pages: previous.pages.map((page, at) =>
          at === 0 ? { ...page, records: [record, ...page.records] } : page,
        ),
      };
    });
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
      markFailure(run.recoveryKey, run.reference.requestId, undefined);
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
      const model = modelFor(run.session.models, run.input.settings.model);
      const slot: GallerySlot = {
        key: `${run.reference.computerId}:${run.input.destination.path}`,
        computerId: run.reference.computerId,
        path: run.input.destination.path,
        ...wallSizeFor(model, run.draft),
        pendingLabel: generationPendingLabel(model),
      };
      if (model?.kind === "video") {
        slot.startedAt = Date.now();
        slot.resumed = run.resumed === true;
      }
      callbacks.current.reserve(slot);
    },
    onSuccess: (record, run) => {
      removeRecord(run.recoveryKey, run.reference.requestId);
      commands.current.delete(run.reference.requestId);
      if (!selected(run) || run.controller.signal.aborted) return;
      callbacks.current.saved(record, run.connection);
    },
    onError: (cause, run) => {
      reportCatchFailure("generate-media", cause);
      if (run.controller.signal.aborted) {
        // Only the person's Stop is a result worth keeping; closing Prints is not.
        if (stopping.current.delete(run.reference.requestId)) {
          const stopped: GenerationFailure = {
            reason: "CANCELLED",
            message: "Stopped. Retry to run it again.",
          };
          void failGeneration(
            run.connection.app.capabilities,
            run.reference,
            stopped,
          ).catch((failed: unknown) => {
            reportCatchFailure("fail-generation", failed);
          });
          upsertRecord(
            run.recoveryKey,
            normalizePendingGeneration({
              reference: run.reference,
              input: run.input,
              typed: run.typed,
              style: run.style,
              characters: run.characters,
              failure: stopped,
            }),
          );
          markFailure(run.recoveryKey, run.reference.requestId, stopped);
        }
        callbacks.current.release(
          `${run.reference.computerId}:${run.input.destination.path}`,
        );
        return;
      }
      if (cause instanceof GenerationLimitError) {
        // The backend refused before remembering anything, so there is no run
        // to keep: say so once in the toast and drop the reserved tile.
        commands.current.delete(run.reference.requestId);
        callbacks.current.release(
          `${run.reference.computerId}:${run.input.destination.path}`,
        );
        if (selected(run)) callbacks.current.notifyFailure(cause.message);
        return;
      }
      const failure = generationFailureOf(cause);
      // The reason is remembered with the run, so it outlives a reload.
      void failGeneration(
        run.connection.app.capabilities,
        run.reference,
        failure,
      ).catch((failed: unknown) => {
        reportCatchFailure("fail-generation", failed);
      });
      if (!selected(run)) return;
      markFailure(run.recoveryKey, run.reference.requestId, failure);
      const described = describeGenerationError(cause);
      const runFailure: RunFailure = {
        requestId: run.reference.requestId,
        path: run.input.destination.path,
        mediaKind:
          modelFor(run.session.models, run.input.settings.model)?.kind ?? null,
        message: described.message,
        action: described.action,
        prompt: run.typed.prompt,
      };
      setFailures((previous) => [
        ...previous.filter((entry) => entry.requestId !== runFailure.requestId),
        runFailure,
      ]);
      folder.recheck();
      // Every refused or failed run also says why in the on-screen toast.
      callbacks.current.notifyFailure(described.message);
      callbacks.current.failed(
        `${run.reference.computerId}:${run.input.destination.path}`,
        failure.message,
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
      commands.current.delete(run.reference.requestId);
      setFailures((previous) =>
        previous.filter((entry) => entry.requestId !== run.reference.requestId),
      );
    },
    onError: (cause, run) => {
      if (selected(run)) failRecovery(describeAppError(cause).message);
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
  // Runs going now, and runs stopped here within the hold, count. A remembered
  // run with nothing behind it (Prints was closed) shows Retry and Dismiss and
  // holds no place here; the backend lets it go once no run can still be alive.
  const now = Date.now();
  const inFlight = new Set([
    ...activeGenerations,
    ...[...stoppedAt.current]
      .filter(([, at]) => now - at < generationHoldMs)
      .map(([id]) => id),
  ]);
  const atLimit = inFlight.size >= MAX_GENERATIONS_IN_FLIGHT;
  useEffect(() => {
    autoResumed.current.clear();
    setAdmissionError(null);
    setRecoveryError(null);
    commands.current.clear();
    stopping.current.clear();
    stoppedAt.current.clear();
    for (const timer of holdTimers.current) clearTimeout(timer);
    holdTimers.current.clear();
    setFailures([]);
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
      for (const timer of holdTimers.current) clearTimeout(timer);
      holdTimers.current.clear();
    };
  }, [app, computerId, connection, client]);
  /** Forget one failed run: its remembered command, its error and its record. */
  const dismissRun = (requestId: string) => {
    setFailures((previous) =>
      previous.filter((entry) => entry.requestId !== requestId),
    );
    const command = commands.current.get(requestId);
    if (!command || active.current.has(requestId)) return;
    commands.current.delete(requestId);
    const controller = new AbortController();
    active.current.set(requestId, controller);
    discard.mutate({ ...command, controller, recoveryKey });
  };
  const run = (command: Command & { resumed?: boolean }) => {
    const id = command.reference.requestId;
    if (active.current.has(id)) return false;
    if (!selected(command)) {
      failRecovery("Select the original Computer to retry this generation.");
      return false;
    }
    if (session?.computerId !== command.reference.computerId) {
      failRecovery("Media access is unavailable for the original Computer.");
      return false;
    }
    // A run already counted (resumed after a reload) fits by definition.
    if (!inFlight.has(id) && atLimit) {
      failRecovery(generationLimitReason);
      return false;
    }
    const controller = new AbortController();
    active.current.set(id, controller);
    commands.current.set(id, command);
    stoppedAt.current.delete(id);
    setFailures((previous) =>
      previous.filter((entry) => entry.requestId !== id),
    );
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
  useEffect(() => {
    if (!connection || !session || !pending.isSuccess) return;
    for (const record of records) {
      const id = record.reference.requestId;
      if (
        autoResumed.current.has(id) ||
        record.reference.computerId !== computerId ||
        modelFor(session.models, record.input.settings.model)?.kind !== "video"
      )
        continue;
      if (
        run({
          connection,
          ...record,
          resumed: true,
          draft: draftFromInput(record.input),
        })
      )
        autoResumed.current.add(id);
    }
  }, [connection, computerId, session, pending.isSuccess, records]);
  /**
   * `labels` are the label numbers of `draft.references`, as the prompt names
   * them; absent, `@image1` is the first reference.
   */
  const submit = async (
    draft: GenerationDraft,
    labels: readonly number[] = draft.references.map((_item, at) => at + 1),
  ) => {
    if (!connection?.app.capabilities.has(computerWriteFile) || !canGenerate)
      return false;
    if (folder.path === null) {
      folder.setEditing(true);
      return false;
    }
    if (atLimit) {
      callbacks.current.notifyFailure(generationLimitReason);
      return false;
    }
    const model = modelFor(models, draft.model);
    if (model === undefined) {
      refuseAdmission({
        kind: "error",
        mediaKind: null,
        message: "Choose a model from the granted registry.",
      });
      return false;
    }
    // Naming references in the prompt makes every attachment a reference.
    const named = mentionedReferenceNumbers(draft.prompt).length > 0;
    const plan =
      model.kind === "audio"
        ? plainPlan(draft.prompt)
        : planCharacters({
            prompt: draft.prompt,
            saved: characters,
            references: draft.references,
            labels,
            wording: (merged) =>
              referenceWording(
                resolveReferenceRoles(merged, model, named),
                model,
              ),
            computerId,
            model: {
              label: model.label,
              maxReferences: model.input.maxReferences,
            },
          });
    if (plan.kind === "refused") {
      refuseAdmission({
        kind: "error",
        mediaKind: model.kind,
        message: plan.message,
      });
      return false;
    }
    // The typed prompt with the characters' references; the expanded prompt's
    // length is checked below, where the message can name what expanded it.
    const invalid = validationMessage(
      {
        ...draft,
        references: resolveReferenceRoles(plan.references, model, named),
      },
      model,
    );
    if (invalid) {
      refuseAdmission({
        kind: "error",
        mediaKind: model.kind,
        message: invalid,
      });
      return false;
    }
    // A style block is for pictures; audio is sent as typed.
    const styleName = model.kind === "audio" ? undefined : draft.style;
    const style =
      styleName === undefined
        ? undefined
        : styles.find((entry) => entry.name === styleName);
    if (styleName !== undefined && style === undefined) {
      refuseAdmission({
        kind: "error",
        mediaKind: model.kind,
        message: `The "${styleName}" style no longer exists. Pick another or none.`,
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
      refuseAdmission({
        kind: "error",
        mediaKind: model.kind,
        message: tooLong,
      });
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
      references: resolveReferenceRoles(plan.references, model, named),
      destination: generationDestinationFor(
        draft,
        folder.landingPath ?? folder.path,
        model,
      ),
    };
    const input = generationInputFor(resolved, model);
    let reference: MediaGenerationReference;
    try {
      const folderError = await folder.ensureCreated();
      if (folderError) {
        refuseAdmission({
          kind: "error",
          mediaKind: model.kind,
          message: folderError,
        });
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
      ) {
        refuseAdmission({
          kind: "error",
          mediaKind: model.kind,
          ...describeGenerationError(cause),
        });
      }
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
      // Stored in attach order, so a recalled prompt names the references
      // the way a fresh composer numbers them.
      typed: {
        prompt: relabelReferenceMentions(draft.prompt.trim(), (number) => {
          const at = labels.indexOf(number);
          return at < 0 ? undefined : at + 1;
        }),
        references: draft.references.length,
      },
      style: style?.name,
      characters: characterNames,
    });
  };
  /**
   * Start an image action on a print: one run, counted against the cap like any
   * generation, that saves a new print beside the source. Resolves to the
   * reason it could not start, or null once it has (a later failure shows on
   * the run's own tile).
   */
  const operate = async (
    source: OperationSource,
    operation: PrintOperation,
    megapixels?: number,
  ): Promise<string | null> => {
    if (!connection?.app.capabilities.has(computerWriteFile) || !canGenerate)
      return GENERATION_UNAVAILABLE_REASON;
    if (!session) return GENERATION_UNAVAILABLE_REASON;
    if (atLimit) return generationLimitReason;
    const model = operationModelFor(models, operation);
    if (model === undefined)
      return `${OPERATION_LABELS[operation]} is not available on this Computer.`;
    const refusal = operationRefusal(model, source);
    if (refusal !== undefined) return refusal;
    const captured = connection;
    const id = captured.app.context.get().computerId;
    if (source.computerId !== id)
      return "Select this print's Computer to edit it.";
    const admissionTicket = ticket.current;
    const { input, draft } = operationInputFor(model, source, megapixels);
    let reference: MediaGenerationReference;
    try {
      const attempt = await session.createAttempt();
      reference = attempt.reference;
      attempt[Symbol.dispose]();
    } catch (cause) {
      return describeGenerationError(cause).message;
    }
    if (
      ticket.current !== admissionTicket ||
      current.current !== captured ||
      captured.app.context.get().computerId !== id
    )
      return "The selected Computer changed. Try again.";
    run({
      connection: captured,
      reference,
      input,
      draft,
      typed: { prompt: input.settings.prompt, references: 1 },
      characters: [],
    });
    return null;
  };
  const latest = generate.variables;
  const attemptState: GenerationState | null =
    admissionError ??
    (activeGenerations.size > 0 && latest
      ? { kind: "pending", draft: latest.draft }
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
    session,
    modelsLoading: modelQuery.isFetching,
    modelsError,
    canGenerate,
    mediaCapability,
    retryModels: () => {
      void modelQuery.refetch();
    },
    submit,
    operate,
    atLimit,
    /** Stop the run whose tile sits at `path`; the others keep going. */
    stopPath: (path: string) => {
      for (const [id, command] of commands.current) {
        const controller = active.current.get(id);
        if (
          command.input.destination.path !== path ||
          !controller ||
          !activeGenerations.has(id)
        )
          continue;
        stopping.current.add(id);
        stoppedAt.current.set(id, Date.now());
        // Re-render when the hold ends, so Generate comes back on its own.
        const timer = setTimeout(() => {
          holdTimers.current.delete(timer);
          setHoldTick((tick) => tick + 1);
        }, generationHoldMs + 1000);
        holdTimers.current.add(timer);
        controller.abort();
      }
    },
    activeGenerations,
    pendingGenerations: records,
    recoveryError:
      recoveryError ??
      (pending.error ? describeAppError(pending.error).message : null),
    reportRecoveryError: (cause: unknown) => {
      failRecovery(describeAppError(cause).message);
    },
    hasMore: pending.hasNextPage,
    loadMore: () => {
      if (!pending.isFetching) void pending.fetchNextPage();
    },
    resume: (record: PendingGeneration) => {
      if (!connection || session?.computerId !== record.reference.computerId) {
        failRecovery("Select the original Computer to retry this generation.");
        return;
      }
      run({
        connection,
        ...record,
        draft: draftFromInput(record.input),
      });
    },
    discard: (record: PendingGeneration) => {
      if (!connection || active.current.has(record.reference.requestId)) return;
      commands.current.delete(record.reference.requestId);
      setFailures((previous) =>
        previous.filter(
          (entry) => entry.requestId !== record.reference.requestId,
        ),
      );
      const controller = new AbortController();
      active.current.set(record.reference.requestId, controller);
      discard.mutate({
        ...record,
        connection,
        controller,
        draft: draftFromInput(record.input),
        recoveryKey,
      });
    },
    failures: failures.map((failure) => ({
      ...failure,
      key: `generation:${failure.requestId}`,
      retry: commands.current.has(failure.requestId)
        ? () => {
            const command = commands.current.get(failure.requestId);
            if (command && selected(command)) run(command);
          }
        : undefined,
      dismiss: () => {
        dismissRun(failure.requestId);
      },
    })),
    /** Retry the failed run whose tile sits at `path`. */
    retryPath: (path: string) => {
      for (const command of commands.current.values()) {
        if (command.input.destination.path !== path || !selected(command))
          continue;
        return run(command);
      }
      return false;
    },
    /** What the run at `path` was asked for, so its failed tile says which print. */
    promptAt: (path: string) => {
      for (const command of commands.current.values())
        if (command.input.destination.path === path)
          return command.typed.prompt;
      return undefined;
    },
    dismissPath: (path: string) => {
      for (const [id, command] of commands.current)
        if (command.input.destination.path === path) dismissRun(id);
    },
  };
}
