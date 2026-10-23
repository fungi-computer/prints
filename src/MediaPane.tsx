import { usePrintNavigation } from "./print-navigation.js";
import { PrintInfoDrawer } from "./print-info-drawer.js";
import {
  useGalleryMedia,
  type GalleryImage,
  type MediaConnection,
} from "./media-gallery.js";
import { useMediaGeneration } from "./media-generation.js";
import type { AppRoot } from "@fungi.computer/agar";
import { useForm, useSelector } from "@tanstack/react-form";
import { ArrowUp, ImagePlus, SlidersHorizontal, Upload, X } from "lucide-react";

import { IconButton } from "@fungi.computer/caps/components/icon-button";
import { Button } from "@fungi.computer/caps/components/button";
import { KeycapButton } from "@fungi.computer/caps/components/keycap";
import { Loader } from "@fungi.computer/caps/components/loader";
import { ScrollArea } from "@fungi.computer/caps/components/scroll-area";
import { Input } from "@fungi.computer/caps/components/input";
import { Select } from "@fungi.computer/caps/components/select";
import { EmptyState } from "@fungi.computer/caps/blocks/empty-state";
import { useWindowStatus } from "@fungi.computer/agar/react";
import { folderStatusItem } from "./folder-status.js";
import { Card } from "@fungi.computer/caps/components/card";
import {
  Popover,
  PopoverAnchor,
} from "@fungi.computer/caps/components/popover";
import { useMediaFolder } from "./media-folder.js";
import {
  PrintsFolderDialog,
  PrintsFooter,
  type PrintsNotice,
} from "./prints-activity.js";
import { noticesFor } from "./prints-notices.js";
import { useNoticeDismissals } from "./notice-dismissals.js";
import { reportCatchFailure } from "./log-event.js";
import type { UploadQueueProps } from "@fungi.computer/caps/blocks/upload-queue";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { MediaMosaic, type MediaMasonryItem } from "./media-masonry.js";
import { galleryWithSlots } from "./gallery-slots.js";
import {
  MediaComposerTextarea,
  MediaSlashSheet,
  useMediaSlashSheet,
} from "./media-composer-pieces.js";
import { normalizeUploadFilename } from "./upload-path.js";
import {
  DEFAULT_MODEL_ID,
  type GenerationDraft,
  type MediaModel,
  defaultGenerationDraft,
  draftForModel,
  generateActionLabel,
  modelFor,
  sizeChoicesFor,
  sizeForModel,
  sizeModeFor,
  SIZE_PRESETS,
} from "./generation-model.js";
import { registerGenerationCommands } from "./generation-commands.js";
import { usePromptCommands } from "./prompt-commands.js";

/** Starting points for an empty gallery; choosing one fills the composer. */
const promptSuggestions = [
  "a mushroom knight",
  "moss on a keyboard",
  "your Agent's selfie",
] as const;

type GenerationSubmit = (draft: GenerationDraft) => Promise<boolean>;

function useGenerationForm(submit: { current: GenerationSubmit }) {
  const accepted = useRef(false);
  const form = useForm({
    defaultValues: defaultGenerationDraft(),
    onSubmit: async ({ value }) => {
      accepted.current = await submit.current(value);
    },
  });
  const submitCurrent = useCallback(async () => {
    accepted.current = false;
    await form.handleSubmit();
    return accepted.current;
  }, [form]);
  return Object.assign(form, { submitCurrent });
}

function GenerationComposer({
  actions,
  guidance,
  commandApp,
  form,
  models,
  modelsLoading,
  mediaCapability,
  submitting,
  values,
  computerId,
  mediaDirectory,
  referenceImages,
  onSubmit,
  footer,
}: {
  footer: (controls: ReactNode, send: ReactNode) => ReactNode;
  actions: ReactNode;
  guidance: PrintsNotice | undefined;
  commandApp: AppRoot | undefined;
  form: ReturnType<typeof useGenerationForm>;
  models: readonly MediaModel[];
  modelsLoading: boolean;
  mediaCapability: boolean;
  submitting: boolean;
  values: GenerationDraft;
  computerId: string | null;
  mediaDirectory: string | null;
  referenceImages: readonly { path: string; url: string }[];
  onSubmit: () => Promise<boolean>;
}): React.JSX.Element {
  const selected = modelFor(models, values.model);
  const providerSized = selected?.input.dimensions === "none";
  const [customSize, setCustomSize] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Catalog-sized models offer only their sizes; others add presets and custom.
  const catalogSized = selected !== undefined && selected.sizes !== null;
  const sizeChoices = sizeChoicesFor(selected);
  const sizeMode = catalogSized
    ? `${String(values.width)}x${String(values.height)}`
    : customSize
      ? "custom"
      : sizeModeFor(values.width, values.height);
  const referencesAllowed = (selected?.input.maxReferences ?? 0) > 0;
  const promptCommands = usePromptCommands(
    {
      clear: () => {
        form.setFieldValue("prompt", "");
      },
      useSize: (mode) => {
        setCustomSize(false);
        form.setFieldValue("width", SIZE_PRESETS[mode].width);
        form.setFieldValue("height", SIZE_PRESETS[mode].height);
        form.setFieldValue("prompt", "");
      },
    },
    commandApp,
  );
  const slash = useMediaSlashSheet(promptCommands.items, values.prompt);
  const pickSlash = (index: number) => {
    const item = slash.slashMatches.at(index);
    if (!item) return;
    slash.resetSlash();
    promptCommands.run(item.id);
  };
  return (
    <PopoverAnchor className="prints-composer-anchor">
      <Card
        aria-label="Image generation"
        className="prints-composer"
        data-generation-form
      >
        <form
          aria-busy={submitting}
          onSubmit={(event) => {
            event.preventDefault();
            void onSubmit();
          }}
        >
          {values.references.length > 0 ? (
            <div
              className="prints-reference-tray"
              aria-label="Image references"
            >
              {values.references.map((reference, index) => {
                const thumbnail = referenceImages.find(
                  (image) => image.path === reference.path,
                );
                return (
                  <div
                    className="prints-reference-tile"
                    key={reference.path}
                    title={reference.path}
                  >
                    <div className="prints-reference-face mask mask-squircle">
                      {thumbnail ? (
                        <img
                          src={thumbnail.url}
                          alt={reference.path.split("/").at(-1)}
                        />
                      ) : (
                        <span>Ref {index + 1}</span>
                      )}
                    </div>
                    <IconButton
                      icon={<X />}
                      className="prints-reference-remove"
                      aria-label={`Remove reference ${String(index + 1)}`}
                      onClick={() => {
                        form.setFieldValue(
                          "references",
                          values.references.filter(
                            (item) => item.path !== reference.path,
                          ),
                        );
                      }}
                    />
                  </div>
                );
              })}
            </div>
          ) : null}
          <form.Field name="prompt">
            {(field) => (
              <div className="prints-prompt">
                {slash.slashOpen ? (
                  <MediaSlashSheet
                    index={slash.slashIndex}
                    matches={slash.slashMatches}
                    onPick={pickSlash}
                  />
                ) : null}
                <MediaComposerTextarea
                  disabled={
                    !mediaCapability ||
                    modelsLoading ||
                    models.length === 0 ||
                    submitting
                  }
                  onChange={(value) => {
                    field.handleChange(value);
                  }}
                  onSend={onSubmit}
                  onSlashMove={slash.moveSlash}
                  onSlashPick={() => {
                    pickSlash(slash.slashIndex);
                  }}
                  placeholder="What are we making?"
                  slashCount={slash.slashMatches.length}
                  value={field.state.value}
                />
              </div>
            )}
          </form.Field>
        </form>
        {guidance ? (
          <div
            className="prints-composer-guidance"
            role="status"
            data-composer-guidance
          >
            <span>
              {guidance.group === "Images" && guidance.detail ? (
                guidance.detail
              ) : (
                <>
                  {guidance.title}. {guidance.detail}
                </>
              )}
            </span>
            {guidance.actions?.map((action) => (
              <Button
                key={action.label}
                variant="ghost"
                size="xs"
                onClick={action.run}
              >
                {action.label}
              </Button>
            ))}
          </div>
        ) : null}
        {footer(
          <>
            {actions}
            {referencesAllowed && values.references.length > 0 ? (
              <span
                className="prints-reference-count"
                data-generation-references
              >
                {values.references.length} /{" "}
                {selected?.input.maxReferences ?? 0} references
              </span>
            ) : null}
            <form.Field name="model">
              {(field) => (
                <label className="prints-model">
                  <span className="sr-only">Model</span>
                  <Select
                    aria-label="Generation model"
                    data-generation-model
                    className="select-sm"
                    disabled={modelsLoading || !mediaCapability}
                    onChange={(event) => {
                      const next = modelFor(models, event.currentTarget.value);
                      field.handleChange(event.currentTarget.value);
                      if (!next) return;
                      if (next.input.steps === "fixed") setSettingsOpen(false);
                      const touched = form.store.state.fieldMeta;
                      const nextDraft = draftForModel(values, next);
                      const size = sizeForModel(values, next, selected);
                      if (
                        next.input.dimensions === "none" ||
                        next.sizes !== null
                      )
                        setCustomSize(false);
                      form.setFieldValue("width", size.width);
                      form.setFieldValue("height", size.height);
                      if (
                        next.input.steps === "fixed" ||
                        !touched.steps?.isTouched
                      )
                        form.setFieldValue("steps", nextDraft.steps);
                      if (next.input.maxReferences === 0)
                        form.setFieldValue("references", []);
                      else if (
                        form.store.state.values.references.length >
                        next.input.maxReferences
                      )
                        form.setFieldValue(
                          "references",
                          form.store.state.values.references.slice(
                            0,
                            next.input.maxReferences,
                          ),
                        );
                    }}
                    value={field.state.value}
                  >
                    {models.length === 0 ? (
                      <option value="">
                        {computerId === null
                          ? "Choose a Computer"
                          : modelsLoading
                            ? "Loading models…"
                            : "Models unavailable"}
                      </option>
                    ) : null}
                    {models.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.label.split(" — ")[0]}
                      </option>
                    ))}
                  </Select>
                </label>
              )}
            </form.Field>
            <label className="prints-size">
              <span className="sr-only">Size</span>
              <Select
                aria-label="Generation size"
                data-generation-size
                className="select-sm"
                disabled={providerSized}
                title={
                  providerSized
                    ? "This model chooses the output size."
                    : undefined
                }
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setCustomSize(value === "custom");
                  const choice = sizeChoices.find(
                    (option) => option.value === value,
                  );
                  if (choice) {
                    form.setFieldValue("width", choice.width);
                    form.setFieldValue("height", choice.height);
                  }
                }}
                value={providerSized ? "provider" : sizeMode}
              >
                {providerSized ? (
                  <option value="provider">Model default</option>
                ) : (
                  <>
                    {catalogSized &&
                    !sizeChoices.some((choice) => choice.value === sizeMode) ? (
                      <option value={sizeMode} disabled>
                        Choose a supported resolution
                      </option>
                    ) : null}
                    {sizeChoices.map((choice) => (
                      <option key={choice.value} value={choice.value}>
                        {choice.label}
                      </option>
                    ))}
                    {catalogSized ? null : (
                      <option value="custom">Custom size</option>
                    )}
                  </>
                )}
              </Select>
            </label>
            {!providerSized && !catalogSized && sizeMode === "custom" ? (
              <div className="prints-custom-size">
                <form.Field name="width">
                  {(field) => (
                    <label className="space-y-1">
                      <span className="text-xs font-bold">Width</span>
                      <Input
                        aria-label="Generation width"
                        data-generation-width
                        max={4096}
                        min={1}
                        onChange={(event) => {
                          field.handleChange(
                            Number(event.currentTarget.value) || 1,
                          );
                        }}
                        type="number"
                        value={field.state.value}
                      />
                    </label>
                  )}
                </form.Field>
                <form.Field name="height">
                  {(field) => (
                    <label className="space-y-1">
                      <span className="text-xs font-bold">Height</span>
                      <Input
                        aria-label="Generation height"
                        data-generation-height
                        max={4096}
                        min={1}
                        onChange={(event) => {
                          field.handleChange(
                            Number(event.currentTarget.value) || 1,
                          );
                        }}
                        type="number"
                        value={field.state.value}
                      />
                    </label>
                  )}
                </form.Field>
              </div>
            ) : null}
            {selected?.video ? (
              <form.Field name="durationSeconds">
                {(field) => (
                  <label className="block space-y-1">
                    <span className="text-xs font-bold">Seconds</span>
                    <Input
                      aria-label="Video length in seconds"
                      data-generation-duration
                      max={selected.video?.maxSeconds}
                      min={selected.video?.minSeconds}
                      onChange={(event) => {
                        field.handleChange(
                          Number(event.currentTarget.value) || undefined,
                        );
                      }}
                      type="number"
                      value={field.state.value ?? ""}
                    />
                  </label>
                )}
              </form.Field>
            ) : null}
            {selected && selected.input.steps !== "fixed" ? (
              <PopoverAnchor className="prints-advanced">
                <IconButton
                  aria-label="Generation settings"
                  aria-expanded={settingsOpen}
                  title="Generation settings"
                  type="button"
                  icon={<SlidersHorizontal />}
                  iconSize="sm"
                  size="sm"
                  onClick={() => {
                    setSettingsOpen(!settingsOpen);
                  }}
                />
                <Popover
                  open={settingsOpen}
                  side="top"
                  className="prints-advanced-panel z-30"
                >
                  <form.Field name="steps">
                    {(field) => (
                      <label className="block space-y-1">
                        <span className="text-xs font-bold">
                          Steps (optional)
                        </span>
                        <Input
                          aria-label="Generation steps"
                          data-generation-steps
                          max={selected.input.maxSteps ?? undefined}
                          min={1}
                          onChange={(event) => {
                            field.handleChange(
                              event.currentTarget.value === ""
                                ? undefined
                                : Number(event.currentTarget.value),
                            );
                          }}
                          type="number"
                          value={field.state.value ?? ""}
                        />
                      </label>
                    )}
                  </form.Field>
                </Popover>
              </PopoverAnchor>
            ) : null}
            {computerId && mediaDirectory ? (
              <span
                className="sr-only"
                data-generation-computer
                title={`Saved to ${computerId}:${mediaDirectory}`}
              >
                Saves to {mediaDirectory}
              </span>
            ) : null}
          </>,
          <Button
            aria-label={generateActionLabel(selected)}
            title={generateActionLabel(selected)}
            className="prints-generate"
            variant="primary"
            size="sm"
            data-generation-submit
            disabled={
              !mediaCapability ||
              modelsLoading ||
              models.length === 0 ||
              submitting
            }
            aria-busy={submitting}
            onClick={() => {
              void onSubmit();
            }}
            type="button"
          >
            {submitting ? (
              <Loader decorative size="sm" />
            ) : (
              <ArrowUp aria-hidden="true" size={20} />
            )}
          </Button>,
        )}
      </Card>
    </PopoverAnchor>
  );
}

export function MediaPane({
  connection,
}: {
  connection: MediaConnection | null;
}): React.JSX.Element {
  const connectionRef = useRef(connection);
  connectionRef.current = connection;
  const folder = useMediaFolder(connection?.app ?? null);
  const [noticesOpen, setNoticesOpen] = useState(false);
  const dismissed = useNoticeDismissals(
    connection?.app ?? null,
    folder.computerId,
  );
  const [infoImage, setInfoImage] = useState<GalleryImage | null>(null);
  useEffect(() => {
    setInfoImage(null);
  }, [connection, folder.computerId]);
  const mediaDirectory = folder.path;
  const galleryMedia = useGalleryMedia(connection, folder);
  const {
    gallery,
    images,
    failed,
    loading,
    gallerySlots,
    canBrowse,
    canRead,
    canWrite,
    reserveSlot,
    failSlot,
    clearSlotError,
    removeSlot,
    openComputerFile,
    uploads,
    uploadFiles,
  } = galleryMedia;
  const printNavigation = usePrintNavigation(
    connection,
    (path, action, selectedConnection, computerId) => {
      gallery.refresh();
      return openComputerFile(path, action, selectedConnection, computerId);
    },
  );
  const navigationListed = gallery.entries.some(
    (entry) => entry.path === printNavigation.target?.path,
  );
  useEffect(() => {
    if (printNavigation.target && !navigationListed && gallery.nextPageReady) {
      gallery.loadMore();
    }
  }, [
    printNavigation.target,
    navigationListed,
    gallery.nextPageReady,
    gallery.loadMore,
  ]);
  const navigationImage = images.find(
    (image) =>
      image.source.kind === "computer" &&
      image.source.computerId === printNavigation.target?.computerId &&
      image.source.path === printNavigation.target.path,
  );
  // The shell's window status bar draws these beside the window's Computer;
  // the folder item opens where Prints saves new images.
  const printCount = new Set([
    ...gallery.entries.map(
      (entry) => `${folder.computerId ?? ""}:${entry.path}`,
    ),
    ...images.map((image) =>
      image.source.kind === "computer"
        ? `${image.source.computerId}:${image.source.path}`
        : image.file.name,
    ),
  ]).size;
  useWindowStatus(
    connection?.app,
    [
      ...(folder.available
        ? [
            folderStatusItem(folder.path, {
              checking: folder.busy && folder.path === null,
              editing: folder.editing,
            }),
          ]
        : []),
      ...(canBrowse
        ? [
            {
              kind: "text" as const,
              id: "prints",
              text: `${String(printCount)} ${printCount === 1 ? "print" : "prints"}`,
            },
          ]
        : []),
    ],
    (action) => {
      if (action.itemId !== "folder" || !folder.available) return false;
      folder.setEditing(true);
      return true;
    },
    (cause) => {
      // Say so in the window instead of leaving a stale bar silently.
      reportCatchFailure("prints.status.report", cause);
      void connection?.app.ui
        .showToast({
          message: "Prints couldn't update its status bar.",
          tone: "error",
        })
        .catch((toastCause: unknown) => {
          reportCatchFailure("prints.status.toast", toastCause);
        });
    },
  );
  const generation = useMediaGeneration({
    connection,
    folder,
    effects: {
      reserve: reserveSlot,
      failed: failSlot,
      saved: ({ result }, selectedConnection) => {
        if (canRead)
          void openComputerFile(
            result.destination.path,
            "add",
            selectedConnection,
            result.destination.computerId,
          );
        else
          failSlot(
            `${result.destination.computerId}:${result.destination.path}`,
            "Image saved, but this App cannot read its preview.",
          );
      },
    },
  });
  const {
    state: generationState,
    models,
    modelsLoading,
    modelsError,
    canGenerate,
    mediaCapability,
    pendingGenerations,
    activeGenerations,
    recoveryError,
  } = generation;
  const modelsRef = useRef(models);
  const generationRef = useRef(generation);
  generationRef.current = generation;
  const scrollRef = useRef<HTMLDivElement>(null);
  const uploadInput = useRef<HTMLInputElement>(null);
  const pasteSequence = useRef(0);
  const generationSubmit = useRef(generation.submit);
  generationSubmit.current = generation.submit;
  const form = useGenerationForm(generationSubmit);
  const formRef = useRef(form);
  formRef.current = form;
  const values = useSelector(form.store, (state) => state.values);
  const submitting = useSelector(form.store, (state) => state.isSubmitting);
  const commandApp = connection?.app;
  useEffect(() => {
    if (!commandApp) return;
    return registerGenerationCommands(commandApp, {
      readDraft: () => formRef.current.store.state.values,
      readModels: () => modelsRef.current,
      setDraft: (patch) => {
        const current = formRef.current;
        if (patch.model !== undefined) {
          const model = modelFor(modelsRef.current, patch.model);
          if (!model)
            throw new Error("Choose a model from the granted registry.");
          const modelDraft = draftForModel(current.store.state.values, model);
          const previousModel = modelFor(
            modelsRef.current,
            current.store.state.values.model,
          );
          const size = sizeForModel(
            current.store.state.values,
            model,
            previousModel,
          );
          current.setFieldValue("model", modelDraft.model);
          current.setFieldValue("width", size.width);
          current.setFieldValue("height", size.height);
          current.setFieldValue("steps", modelDraft.steps);
          current.setFieldValue(
            "references",
            current.store.state.values.references.slice(
              0,
              model.input.maxReferences,
            ),
          );
        }
        if (patch.destination !== undefined)
          current.setFieldValue("destination", patch.destination ?? undefined);
        if (patch.height !== undefined)
          current.setFieldValue("height", patch.height);
        if (patch.prompt !== undefined)
          current.setFieldValue("prompt", patch.prompt);
        if (patch.references !== undefined)
          current.setFieldValue("references", patch.references);
        if (patch.steps !== undefined)
          current.setFieldValue("steps", patch.steps ?? undefined);
        if (patch.width !== undefined)
          current.setFieldValue("width", patch.width);
      },
      submit: () => {
        if (
          formRef.current.store.state.isSubmitting ||
          generationRef.current.isRunning()
        )
          return Promise.resolve(false);
        return formRef.current.submitCurrent();
      },
    });
  }, [commandApp]);
  useEffect(() => {
    modelsRef.current = models;
  }, [models]);
  useEffect(() => {
    if (models.length === 0 || modelsError) return;
    const first =
      models.find((model) => model.id === DEFAULT_MODEL_ID) ?? models[0];
    if (!form.store.state.fieldMeta.model?.isTouched) {
      const next = draftForModel(form.store.state.values, first);
      form.setFieldValue("model", next.model);
      if (!form.store.state.fieldMeta.width?.isTouched)
        form.setFieldValue("width", next.width);
      if (!form.store.state.fieldMeta.height?.isTouched)
        form.setFieldValue("height", next.height);
      if (!form.store.state.fieldMeta.steps?.isTouched)
        form.setFieldValue("steps", next.steps);
    }
  }, [form, modelsError, models]);
  const selectedModel = modelFor(models, values.model);
  const references = values.references;
  const referenceLimit = selectedModel?.input.maxReferences ?? 0;
  // Keep gallery data stable while the composer changes. Actions still use
  // the current connection and operation callbacks when invoked.
  const galleryActions = useRef({
    openComputerFile,
    retryPath: generation.retryPath,
    uploads,
  });
  galleryActions.current = {
    openComputerFile,
    retryPath: generation.retryPath,
    uploads,
  };
  const selectedImageKey = navigationImage
    ? navigationImage.source.kind === "computer"
      ? `${navigationImage.source.computerId}:${navigationImage.source.path}`
      : navigationImage.file.name
    : null;
  const items = useMemo<MediaMasonryItem[]>(
    () =>
      images.map((image) => ({
        key:
          image.source.kind === "computer"
            ? `${image.source.computerId}:${image.source.path}`
            : image.file.name,
        selected:
          (image.source.kind === "computer"
            ? `${image.source.computerId}:${image.source.path}`
            : image.file.name) === selectedImageKey,
        path:
          image.source.kind === "computer"
            ? image.source.path
            : image.file.name,
        referenced: references.some(
          (reference) =>
            image.source.kind === "computer" &&
            reference.path === image.source.path,
        ),
        referenceDisabled:
          references.length >= referenceLimit &&
          !references.some(
            (reference) =>
              image.source.kind === "computer" &&
              reference.path === image.source.path,
          ),
        onToggleReference:
          image.source.kind === "computer" && referenceLimit > 0
            ? () => {
                if (image.source.kind !== "computer") return;
                const path = image.source.path;
                const referenced = references.some(
                  (reference) => reference.path === path,
                );
                form.setFieldValue(
                  "references",
                  referenced
                    ? references.filter((reference) => reference.path !== path)
                    : [...references, { path }],
                );
              }
            : undefined,
        onInfo: () => {
          setInfoImage(image);
        },
        url: image.url,
        width: image.width,
        height: image.height,
        onOpen: () => {
          if (image.source.kind === "computer")
            void galleryActions.current.openComputerFile(
              image.source.path,
              "open",
              image.source.connection,
              image.source.computerId,
            );
          else window.open(image.url, "_blank", "noopener,noreferrer");
        },
      })),
    [images, references, referenceLimit, form, selectedImageKey],
  );
  // Directory rows reserve space immediately. Masonic mounts only visible cells;
  // each mounted placeholder admits its native file query.
  const listedItems = useMemo<MediaMasonryItem[]>(() => {
    const computerId = folder.computerId;
    if (!computerId) return items;
    const ready = new Map(items.map((item) => [item.key, item]));
    const listed = [...gallery.entries].sort(
      (a, b) => b.modifiedAt - a.modifiedAt || a.name.localeCompare(b.name),
    );
    const rows = listed.map((entry) => {
      const key = `${computerId}:${entry.path}`;
      return (
        ready.get(key) ?? {
          key,
          path: entry.path,
          width: 1,
          height: 1,
          url: "",
          pending: true,
          pendingLabel: "Loading print…",
          onOpen: () => undefined,
          onVisible: () => {
            gallery.loadFile(entry.path);
          },
          error: gallery.failures.includes(entry.name)
            ? "Could not load this print."
            : undefined,
        }
      );
    });
    const keys = new Set(rows.map((item) => item.key));
    // A navigated output belongs to its directory page, never an appended tail.
    return [
      ...rows,
      ...items.filter(
        (item) => !keys.has(item.key) && item.key !== selectedImageKey,
      ),
    ];
  }, [
    items,
    gallery.entries,
    gallery.loadFile,
    gallery.failures,
    folder.computerId,
    selectedImageKey,
  ]);
  const hasPendingGeneration = generationState.kind === "pending";
  const wallItems = useMemo(
    () =>
      galleryWithSlots(listedItems, gallerySlots, (slot) => {
        const upload = uploads.items.find((item) => item.id === slot.uploadId);
        const error =
          slot.error ??
          (upload?.status === "error" || upload?.status === "cancelled"
            ? upload.message
            : undefined);
        return {
          key: slot.key,
          path: slot.path,
          width: slot.width,
          height: slot.height,
          url: "",
          pending: true,
          error,
          pendingLabel:
            upload?.status === "complete" ||
            generationState.kind === "completed"
              ? "Loading preview…"
              : slot.uploadId
                ? "Uploading image…"
                : slot.pendingLabel,
          onOpen: () => undefined,
          onRetry:
            error && (canRead || (upload && upload.status !== "complete"))
              ? () => {
                  clearSlotError(slot.key);
                  if (upload && upload.status !== "complete") {
                    galleryActions.current.uploads.retry(upload.id);
                    return;
                  }
                  if (
                    !slot.uploadId &&
                    galleryActions.current.retryPath(slot.path)
                  ) {
                    return;
                  } else if (connectionRef.current) {
                    void galleryActions.current.openComputerFile(
                      slot.path,
                      "add",
                      connectionRef.current,
                      slot.computerId,
                    );
                  }
                }
              : undefined,
          onDismiss: error
            ? () => {
                removeSlot(slot.key);
                if (slot.uploadId)
                  galleryActions.current.uploads.remove(slot.uploadId);
              }
            : undefined,
        };
      }),
    [listedItems, gallerySlots, uploads.items, generationState.kind, canRead],
  );
  const generationBusy = submitting || hasPendingGeneration;
  const tileFailed = gallerySlots.some((slot) => slot.error !== undefined);
  const currentUploads = uploads.items.filter(
    (item) => item.computerId === folder.computerId,
  );
  const generationError =
    generationState.kind === "error" && modelsError === null
      ? {
          key: generation.errorKey,
          message: generationState.message,
          billing:
            generationState.action === "billing" && connection
              ? () => {
                  void connection.app.ui
                    .openTeamBilling()
                    .catch((cause: unknown) => {
                      reportCatchFailure("open-team-billing", cause);
                      if (connectionRef.current === connection)
                        generation.reportRecoveryError(cause);
                    });
                }
              : undefined,
          retry: tileFailed ? generation.retry : undefined,
        }
      : null;
  const notices = noticesFor({
    connected: connection !== null,
    mediaCapability,
    modelsError,
    retryModels: generation.retryModels,
    modelsLoading,
    models,
    canGenerate,
    canWrite,
    generationError,
    recoveryError,
    pendingGenerations,
    activeGenerations,
    gallerySlots,
    computerId: folder.computerId,
    failed,
    uploadError: uploads.error,
    uploads: currentUploads,
    permissions: () => {
      void connection?.app.ui
        .requestAppPermissions({})
        .catch((cause: unknown) => {
          generation.reportRecoveryError(cause);
        });
    },
    resume: (record) => {
      generation.resume(record);
    },
    discard: (record) => {
      generation.discard(record);
    },
    retryUpload: (id) => {
      uploads.retry(id);
    },
  });
  if (dismissed.error)
    notices.push({
      key: "dismissal-storage",
      group: "Setup",
      tone: "warning",
      blocking: true,
      short: "Activity not saved",
      title: "Activity not saved",
      detail: dismissed.error,
    });
  const visibleNotices = dismissed.visible(notices);
  const activity = {
    generating: activeGenerations.size,
    uploading: currentUploads.filter(
      (item) => item.status === "sending" || item.status === "queued",
    ).length,
  };
  const uploadQueueProps: UploadQueueProps = {
    items: currentUploads
      .filter((item) => item.status === "sending" || item.status === "queued")
      .map((item) => ({
        id: item.id,
        name: item.file.name,
        preview: { kind: "image" as const, url: item.previewUrl },
        progress: null,
        progressLabel: "",
        statusLabel: item.message,
        actions: {
          cancel: {
            label: "Cancel",
            accessibleLabel: `Cancel ${item.file.name}`,
          },
        },
      })),
    onCancel: (id: string) => {
      uploads.cancel(id);
    },
    onRetry: (id: string) => {
      uploads.retry(id);
    },
    onRemove: (id: string) => {
      uploads.remove(id);
    },
  };
  return (
    <main
      className="h-full w-full flex flex-col overflow-hidden"
      data-app-pane="media"
      data-generation-state={generationState.kind}
      data-computer-capability={canBrowse ? "connected" : "absent"}
      onPaste={(event) => {
        const pasted = Array.from(event.clipboardData.files);
        if (pasted.length && canWrite) {
          event.preventDefault();
          void uploadFiles(
            pasted.map((file) => {
              pasteSequence.current += 1;
              return new File(
                [file],
                `paste-${String(pasteSequence.current)}-${normalizeUploadFilename(file.name)}`,
                { type: file.type, lastModified: file.lastModified },
              );
            }),
          );
        }
      }}
    >
      <div className="prints-gallery-region">
        <ScrollArea
          screen
          surface
          surfaceSize="lg"
          surfaceDepth="deep"
          ref={scrollRef}
          className="flex-1 min-h-0"
          data-media-scroll
          aria-busy={loading || gallery.loading}
          onDragOver={(event) => {
            event.preventDefault();
          }}
          onDrop={(event) => {
            event.preventDefault();
            const dropped = Array.from(event.dataTransfer.files);
            if (dropped.length && canWrite) void uploadFiles(dropped);
          }}
        >
          <div className="prints-gallery-content">
            {wallItems.length > 0 ? (
              <MediaMosaic
                items={wallItems}
                scrollRef={scrollRef}
                focus={
                  navigationImage && printNavigation.target
                    ? {
                        key: `${printNavigation.target.computerId}:${printNavigation.target.path}`,
                        requestId: printNavigation.target.requestId,
                        onFocus: () => {
                          setInfoImage(navigationImage);
                        },
                      }
                    : undefined
                }
              />
            ) : !(loading || gallery.loading) ? (
              <EmptyState
                aria-live="polite"
                data-absence
                data-media-empty
                role="status"
                variant="panel"
                visual={<ImagePlus />}
                title="Nothing printed yet."
                description={
                  folder.computerId === null
                    ? "Your images will appear here."
                    : folder.available && mediaDirectory === null
                      ? "Pick a folder in the composer below, then describe something or drop in images."
                      : "Describe something and it lands here, or drop in images from your Computer."
                }
                {...(mediaCapability
                  ? {
                      suggestions: promptSuggestions.map((prompt) => ({
                        label: prompt,
                        onSelect: () => {
                          form.setFieldValue("prompt", prompt);
                        },
                      })),
                    }
                  : {})}
              />
            ) : (
              <EmptyState
                variant="hint"
                role="status"
                aria-live="polite"
                title="Loading prints…"
                description="Your library is on its way."
              />
            )}
            {gallery.hasNextPage && (
              <Button
                variant="ghost"
                disabled={gallery.loading}
                onClick={gallery.loadMore}
              >
                {gallery.loading ? "Loading images…" : "Load more images"}
              </Button>
            )}
          </div>
        </ScrollArea>
        {printNavigation.error ? (
          <p role="alert">
            Could not open this print. It may no longer be available on this
            Computer.
          </p>
        ) : null}
        {infoImage &&
        (infoImage.source.kind === "local" ||
          (infoImage.source.connection === connection &&
            infoImage.source.computerId === folder.computerId)) ? (
          <PrintInfoDrawer
            key={infoImage.url}
            image={infoImage}
            app={connection?.app ?? null}
            onClose={() => {
              setInfoImage(null);
            }}
          />
        ) : null}
      </div>
      <div className="prints-composer-dock">
        <section aria-label="Computer uploads" className="prints-uploads">
          <input
            ref={uploadInput}
            type="file"
            disabled={!canWrite || mediaDirectory === null}
            accept="image/*"
            multiple
            hidden
            aria-label="Choose images to upload"
            onChange={(event) => {
              void uploadFiles(Array.from(event.currentTarget.files ?? []));
              event.currentTarget.value = "";
            }}
          />
        </section>
        <GenerationComposer
          guidance={
            visibleNotices.find(
              (notice) => notice.blocking && notice.group === "Setup",
            ) ??
            (generationState.kind === "error"
              ? visibleNotices.find(
                  (notice) => notice.key === generationError?.key,
                )
              : undefined)
          }
          commandApp={commandApp}
          footer={(controls, send) => (
            <PrintsFooter
              notices={visibleNotices}
              activity={activity}
              uploads={uploadQueueProps}
              activityOpen={noticesOpen}
              onActivityOpenChange={setNoticesOpen}
              onDismiss={dismissed.dismiss}
              onDismissAll={() => {
                dismissed.dismissAll(notices);
              }}
              onLoadMore={generation.hasMore ? generation.loadMore : undefined}
              controls={controls}
              send={send}
            />
          )}
          actions={
            <KeycapButton
              aria-label="Upload images"
              title={
                canWrite
                  ? "Upload images to Computer"
                  : "Connect a writable Computer to upload"
              }
              icon={<Upload />}
              label={null}
              className="prints-upload-key"
              disabled={!canWrite || mediaDirectory === null}
              onClick={() => uploadInput.current?.click()}
            />
          }
          form={form}
          mediaCapability={
            mediaCapability &&
            canGenerate &&
            canWrite &&
            mediaDirectory !== null
          }
          models={models}
          modelsLoading={modelsLoading}
          onSubmit={form.submitCurrent}
          submitting={generationBusy}
          values={values}
          computerId={folder.computerId}
          mediaDirectory={mediaDirectory}
          referenceImages={images.flatMap((image) =>
            image.source.kind === "computer"
              ? [{ path: image.source.path, url: image.url }]
              : [],
          )}
        />
      </div>
      <PrintsFolderDialog folder={folder} />
    </main>
  );
}
