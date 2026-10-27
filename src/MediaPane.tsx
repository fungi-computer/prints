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
import { ImagePlus, SlidersHorizontal, Upload, X } from "lucide-react";

import { IconButton } from "@fungi.computer/caps/components/icon-button";
import { Button } from "@fungi.computer/caps/components/button";
import { KeycapButton } from "@fungi.computer/caps/components/keycap";
import { ScrollArea } from "@fungi.computer/caps/components/scroll-area";
import { Input } from "@fungi.computer/caps/components/input";
import { Field } from "@fungi.computer/caps/components/field";
import { Select } from "@fungi.computer/caps/components/select";
import { Switch } from "@fungi.computer/caps/components/switch";
import { EmptyState } from "@fungi.computer/caps/blocks/empty-state";
import { useWindowStatus } from "@fungi.computer/agar/react";
import { folderStatusItem } from "./folder-status.js";
import { Card } from "@fungi.computer/caps/components/card";
import { PopoverAnchor } from "@fungi.computer/caps/components/popover";
import { useMediaFolder } from "./media-folder.js";
import {
  PrintsFolderDialog,
  PrintsFooter,
  type PrintsNotice,
  type PrintsSettingsTray,
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
  MediaMentionSheet,
  MediaSlashSheet,
  useCharacterMentions,
  useMediaSlashSheet,
  GenerateButton,
} from "./media-composer-pieces.js";
import { usePromptCharacters } from "./use-prompt-characters.js";
import { PromptCharactersDialog } from "./prompt-character-controls.js";
import {
  addedPromptLength,
  expandCharacters,
  planCharacters,
  type PromptCharacter,
} from "./prompt-characters.js";
import { normalizeUploadFilename } from "./upload-path.js";
import {
  DEFAULT_MODEL_ID,
  type GenerationDraft,
  type MediaModel,
  defaultGenerationDraft,
  draftForModel,
  generateActionLabel,
  modelFor,
  modelName,
  nextReferenceRole,
  REFERENCE_ROLE_LABELS,
  referenceRoleMessage,
  referenceRolesFor,
  resolveReferenceRoles,
  sizeChoicesFor,
  shortSizeLabel,
  type SizeChoice,
  sizeForModel,
  SIZE_PRESETS,
} from "./generation-model.js";
import { registerGenerationCommands } from "./generation-commands.js";
import { usePromptCommands } from "./prompt-commands.js";
import { usePromptStyles } from "./use-prompt-styles.js";
import { animateModelFor, iterationDraft } from "./print-iteration.js";
import {
  PromptStyleSelect,
  PromptStylesDialog,
} from "./prompt-style-controls.js";

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

/**
 * The settings tray: the choices a creator sets once a session (style, size,
 * video length and audio, steps), and the doors to the style and character
 * libraries.
 */
function GenerationSettings({
  form,
  selected,
  stylePicker,
  sizeChoices,
  sizeMode,
  onCustomSize,
  onEditStyles,
  onEditCharacters,
}: {
  form: ReturnType<typeof useGenerationForm>;
  selected: MediaModel | undefined;
  stylePicker: ReactNode;
  sizeChoices: readonly SizeChoice[];
  sizeMode: string;
  onCustomSize: (custom: boolean) => void;
  onEditStyles: () => void;
  onEditCharacters: () => void;
}): React.JSX.Element {
  const providerSized = selected?.input.dimensions === "none";
  const catalogSized = selected !== undefined && selected.sizes !== null;
  const video = selected?.video ?? null;
  return (
    <div className="prints-settings">
      <Field label="Style" orientation="horizontal">
        {stylePicker}
      </Field>
      <Field label="Size" orientation="horizontal">
        <Select
          aria-label="Generation size"
          data-generation-size
          className="select-sm"
          disabled={providerSized}
          title={
            providerSized ? "This model chooses the output size." : undefined
          }
          onChange={(event) => {
            const value = event.currentTarget.value;
            onCustomSize(value === "custom");
            const choice = sizeChoices.find((option) => option.value === value);
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
      </Field>
      {!providerSized && !catalogSized && sizeMode === "custom" ? (
        <div className="prints-custom-size">
          <form.Field name="width">
            {(field) => (
              <Field label="Width">
                <Input
                  aria-label="Generation width"
                  data-generation-width
                  max={4096}
                  min={1}
                  onChange={(event) => {
                    field.handleChange(Number(event.currentTarget.value) || 1);
                  }}
                  type="number"
                  value={field.state.value}
                />
              </Field>
            )}
          </form.Field>
          <form.Field name="height">
            {(field) => (
              <Field label="Height">
                <Input
                  aria-label="Generation height"
                  data-generation-height
                  max={4096}
                  min={1}
                  onChange={(event) => {
                    field.handleChange(Number(event.currentTarget.value) || 1);
                  }}
                  type="number"
                  value={field.state.value}
                />
              </Field>
            )}
          </form.Field>
        </div>
      ) : null}
      {video ? (
        <form.Field name="durationSeconds">
          {(field) => (
            <Field label="Length" orientation="horizontal">
              <Select
                aria-label="Video length in seconds"
                className="select-sm"
                data-generation-duration
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  field.handleChange(
                    video.durations.find(
                      (seconds) => String(seconds) === value,
                    ),
                  );
                }}
                value={
                  field.state.value === undefined
                    ? ""
                    : String(field.state.value)
                }
              >
                {video.durations.map((seconds) => (
                  <option key={seconds} value={String(seconds)}>
                    {seconds} seconds
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </form.Field>
      ) : null}
      {video?.supportsAudio ? (
        <form.Field name="generateAudio">
          {(field) =>
            video.defaultGenerateAudio === null ? (
              <Field label="Audio" orientation="horizontal">
                <Select
                  aria-label="Video audio"
                  className="select-sm"
                  data-generation-audio
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    field.handleChange(
                      value === "" ? undefined : value === "on",
                    );
                  }}
                  value={
                    field.state.value === undefined
                      ? ""
                      : field.state.value
                        ? "on"
                        : "off"
                  }
                >
                  <option value="">Model default</option>
                  <option value="on">On</option>
                  <option value="off">Off</option>
                </Select>
              </Field>
            ) : (
              <Field label="Audio" orientation="horizontal">
                <Switch
                  aria-label="Video audio"
                  checked={field.state.value ?? true}
                  data-generation-audio
                  onCheckedChange={field.handleChange}
                />
              </Field>
            )
          }
        </form.Field>
      ) : null}
      {selected && selected.input.steps !== "fixed" ? (
        <form.Field name="steps">
          {(field) => (
            <Field label="Steps" optional orientation="horizontal">
              <Input
                aria-label="Generation steps"
                className="input-sm"
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
            </Field>
          )}
        </form.Field>
      ) : null}
      <div className="prints-settings-library">
        <Button
          size="xs"
          variant="ghost"
          type="button"
          onClick={() => {
            onEditStyles();
          }}
        >
          Edit styles…
        </Button>
        <Button
          size="xs"
          variant="ghost"
          type="button"
          onClick={() => {
            onEditCharacters();
          }}
        >
          Characters…
        </Button>
      </div>
    </div>
  );
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
  characters,
  characterDialog,
  onSubmit,
  footer,
  styleControls,
  addedLength,
}: {
  /** Characters the picked style and expanded `@characters` add to the prompt. */
  addedLength: number;
  /** The style picker for the settings tray, and the style library dialog. */
  styleControls: (dialog: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
  }) => Readonly<{ picker: ReactNode; dialog: ReactNode }>;
  characters: readonly PromptCharacter[];
  characterDialog: (dialog: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
  }) => ReactNode;
  footer: (
    controls: ReactNode,
    send: ReactNode,
    settings: PrintsSettingsTray,
  ) => ReactNode;
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
  const typedLength = values.prompt.trim().length;
  const promptOver =
    selected !== undefined &&
    typedLength > 0 &&
    typedLength + addedLength > selected.maxPromptLength;
  const roles = referenceRolesFor(selected);
  const video = selected?.video ?? null;
  const shownReferences = resolveReferenceRoles(values.references, selected);
  const roleProblem =
    selected === undefined
      ? undefined
      : referenceRoleMessage(
          shownReferences,
          selected,
          video?.formats.find(
            (format) =>
              format.width === values.width && format.height === values.height,
          )?.resolution,
        );
  const referenceLimit = selected?.input.maxReferences ?? 0;
  const referencesOver = values.references.length > referenceLimit;
  const [customSize, setCustomSize] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Catalog-sized models offer only their sizes; others add presets and custom.
  const catalogSized = selected !== undefined && selected.sizes !== null;
  const sizeChoices = sizeChoicesFor(selected);
  const sizeMode = catalogSized
    ? `${String(values.width)}x${String(values.height)}`
    : customSize
      ? "custom"
      : (sizeChoices.find(
          (choice) =>
            choice.width === values.width && choice.height === values.height,
        )?.value ?? "custom");
  const [stylesOpen, setStylesOpen] = useState(false);
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
      openStyles: () => {
        form.setFieldValue("prompt", "");
        setStylesOpen(true);
      },
      clearStyle: () => {
        form.setFieldValue("style", undefined);
        form.setFieldValue("prompt", "");
      },
    },
    commandApp,
  );
  const [charactersOpen, setCharactersOpen] = useState(false);
  const mentions = useCharacterMentions(characters, values.prompt);
  const slash = useMediaSlashSheet(promptCommands.items, values.prompt);
  // Show what the typed @names will add before the person sends.
  const usedCharacters = planCharacters({
    prompt: values.prompt,
    saved: characters,
    references: values.references,
    model:
      selected === undefined
        ? undefined
        : {
            label: selected.label,
            maxReferences: selected.input.maxReferences,
          },
  });
  const mentioned = expandCharacters(values.prompt, characters).characters;
  const pickSlash = (index: number) => {
    const item = slash.slashMatches.at(index);
    if (!item) return;
    slash.resetSlash();
    promptCommands.run(item.id);
  };
  const style = styleControls({
    open: stylesOpen,
    onOpenChange: setStylesOpen,
  });
  // The tray's chip reads back what the hidden choices are set to.
  const summary = [
    values.style,
    shortSizeLabel(selected, values.width, values.height),
    video && values.durationSeconds !== undefined
      ? `${String(values.durationSeconds)}s`
      : undefined,
    video?.supportsAudio && values.generateAudio === false
      ? "silent"
      : undefined,
  ].filter((part) => part !== undefined && part !== null);
  const settings = (
    <GenerationSettings
      form={form}
      selected={selected}
      stylePicker={style.picker}
      sizeChoices={sizeChoices}
      sizeMode={sizeMode}
      onCustomSize={setCustomSize}
      onEditStyles={() => {
        setSettingsOpen(false);
        setStylesOpen(true);
      }}
      onEditCharacters={() => {
        setSettingsOpen(false);
        setCharactersOpen(true);
      }}
    />
  );
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
                const role = shownReferences[index]?.role;
                const next = nextReferenceRole(roles, shownReferences, index);
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
                    {role === undefined ? null : next === undefined ? (
                      <span
                        className="prints-reference-role"
                        data-reference-role={role}
                      >
                        {REFERENCE_ROLE_LABELS[role]}
                      </span>
                    ) : (
                      <Button
                        size="xs"
                        variant="ghost"
                        type="button"
                        className="prints-reference-role"
                        data-reference-role={role}
                        aria-label={`Reference ${String(index + 1)}: ${REFERENCE_ROLE_LABELS[role]}. Use as ${REFERENCE_ROLE_LABELS[next]}`}
                        title={`Use as ${REFERENCE_ROLE_LABELS[next]}`}
                        onClick={() => {
                          form.setFieldValue(
                            "references",
                            shownReferences.map((item, at) =>
                              at === index ? { ...item, role: next } : item,
                            ),
                          );
                        }}
                      >
                        {REFERENCE_ROLE_LABELS[role]}
                      </Button>
                    )}
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
                {!slash.slashOpen && mentions.matches.length > 0 ? (
                  <MediaMentionSheet
                    images={referenceImages}
                    index={mentions.index}
                    matches={mentions.matches}
                    onPick={(at) => {
                      const next = mentions.complete(at);
                      if (next !== null) field.handleChange(next);
                    }}
                  />
                ) : null}
                <MediaComposerTextarea
                  caretRequest={mentions.caretRequest}
                  mentionCount={slash.slashOpen ? 0 : mentions.matches.length}
                  onCaret={mentions.setCaret}
                  onMentionDismiss={mentions.dismiss}
                  onMentionMove={mentions.move}
                  onMentionPick={() => {
                    const next = mentions.complete(mentions.index);
                    if (next !== null) field.handleChange(next);
                  }}
                  disabled={
                    !mediaCapability ||
                    modelsLoading ||
                    models.length === 0 ||
                    submitting
                  }
                  maxLength={selected?.maxPromptLength}
                  addedLength={addedLength}
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
                {values.references.length > 0 ||
                roleProblem !== undefined ||
                mentioned.length > 0 ? (
                  <div className="prints-composer-notes">
                    {values.references.length > 0 ? (
                      <span
                        className="prints-reference-count"
                        data-generation-references
                        data-over-limit={referencesOver ? "" : undefined}
                        role={referencesOver ? "alert" : undefined}
                      >
                        {values.references.length} / {referenceLimit} references
                        {referencesOver
                          ? referenceLimit === 0
                            ? " — this model takes none; remove them or pick another model"
                            : " — over this model's limit; remove some to generate"
                          : null}
                      </span>
                    ) : null}
                    {roleProblem !== undefined ? (
                      <span
                        className="prints-reference-count"
                        data-generation-reference-roles
                        data-over-limit=""
                        role="alert"
                      >
                        {roleProblem}
                      </span>
                    ) : null}
                    {mentioned.length > 0 ? (
                      <span
                        className="prints-reference-count"
                        data-generation-characters
                        data-over-limit={
                          usedCharacters.kind === "refused" ? "" : undefined
                        }
                        role={
                          usedCharacters.kind === "refused"
                            ? "alert"
                            : undefined
                        }
                      >
                        {usedCharacters.kind === "refused"
                          ? usedCharacters.message
                          : `Characters: ${mentioned.map((entry) => entry.name).join(", ")}`}
                      </span>
                    ) : null}
                  </div>
                ) : null}
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
                      form.setFieldValue(
                        "durationSeconds",
                        nextDraft.durationSeconds,
                      );
                      form.setFieldValue(
                        "generateAudio",
                        nextDraft.generateAudio,
                      );
                      if (
                        next.input.steps === "fixed" ||
                        !touched.steps?.isTouched
                      )
                        form.setFieldValue("steps", nextDraft.steps);
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
                        {modelName(model)}
                      </option>
                    ))}
                  </Select>
                </label>
              )}
            </form.Field>
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
          <GenerateButton
            busy={submitting}
            disabled={
              !mediaCapability ||
              modelsLoading ||
              models.length === 0 ||
              submitting
            }
            label={generateActionLabel(selected)}
            onGenerate={() => {
              void onSubmit();
            }}
            promptOver={promptOver}
          />,
          {
            label: (
              <span className="prints-settings-chip">
                <SlidersHorizontal
                  aria-hidden="true"
                  className="size-[var(--stipe-icon-size-sm)]"
                />
                {summary.length > 0 ? summary.join(" · ") : "Settings"}
              </span>
            ),
            content: settings,
            open: settingsOpen,
            onOpenChange: setSettingsOpen,
          },
        )}
        {style.dialog}
        {characterDialog({
          open: charactersOpen,
          onOpenChange: setCharactersOpen,
        })}
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
  const promptStyles = usePromptStyles(connection?.app ?? null);
  const promptCharacters = usePromptCharacters(connection?.app ?? null);
  const generation = useMediaGeneration({
    connection,
    folder,
    styles: promptStyles.styles,
    characters: promptCharacters.characters,
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
  /** Why an iterated draft differs from its print, while it keeps that model. */
  const [iterationNotice, setIterationNotice] = useState<{
    model: string;
    message: string;
  } | null>(null);
  const generationSubmit = useRef<GenerationSubmit>(generation.submit);
  generationSubmit.current = async (draft) => {
    const accepted = await generation.submit(draft);
    if (accepted) setIterationNotice(null);
    return accepted;
  };
  const form = useGenerationForm(generationSubmit);
  const loadDraft = (draft: GenerationDraft) => {
    form.setFieldValue("model", draft.model);
    form.setFieldValue("width", draft.width);
    form.setFieldValue("height", draft.height);
    form.setFieldValue("steps", draft.steps);
    form.setFieldValue("durationSeconds", draft.durationSeconds);
    form.setFieldValue("generateAudio", draft.generateAudio);
    form.setFieldValue("prompt", draft.prompt);
    form.setFieldValue("references", draft.references);
    form.setFieldValue("style", draft.style);
    form.setFieldValue("destination", undefined);
  };
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
          current.setFieldValue("durationSeconds", modelDraft.durationSeconds);
          current.setFieldValue("generateAudio", modelDraft.generateAudio);
        }
        if (patch.generateAudio !== undefined)
          current.setFieldValue(
            "generateAudio",
            patch.generateAudio ?? undefined,
          );
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
        if (patch.style !== undefined)
          current.setFieldValue("style", patch.style ?? undefined);
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
  const composerImages = images.flatMap((image) =>
    image.source.kind === "computer"
      ? [{ path: image.source.path, url: image.url }]
      : [],
  );
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
            referenceImages={composerImages}
            models={models}
            canAnimate={animateModelFor(models) !== undefined}
            onIterate={(action, lineage) => {
              if (infoImage.source.kind !== "computer") return null;
              const outcome = iterationDraft(action, {
                lineage,
                printPath: infoImage.source.path,
                models,
                styles: promptStyles.styles.map((entry) => entry.name),
                current: form.store.state.values,
              });
              if (outcome.kind === "refused") return outcome.message;
              loadDraft(outcome.draft);
              setIterationNotice(
                outcome.notice === null
                  ? null
                  : { model: outcome.draft.model, message: outcome.notice },
              );
              setInfoImage(null);
              return null;
            }}
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
          addedLength={addedPromptLength(
            values.prompt,
            promptStyles.styles.find((style) => style.name === values.style)
              ?.text,
            promptCharacters.characters,
          )}
          styleControls={(dialog) => ({
            picker: (
              <PromptStyleSelect
                styles={promptStyles.styles}
                selected={values.style}
                disabled={!mediaCapability || modelsLoading || generationBusy}
                onSelect={(name) => {
                  form.setFieldValue("style", name);
                }}
              />
            ),
            dialog: (
              <PromptStylesDialog
                open={dialog.open}
                onOpenChange={dialog.onOpenChange}
                styles={promptStyles.styles}
                selected={values.style}
                busy={promptStyles.busy}
                error={promptStyles.error}
                onSelect={(name) => {
                  form.setFieldValue("style", name);
                }}
                onSave={promptStyles.save}
                onDelete={(style, done) => {
                  promptStyles.remove(style.id, done);
                }}
              />
            ),
          })}
          characters={promptCharacters.characters}
          characterDialog={(dialog) => (
            <PromptCharactersDialog
              open={dialog.open}
              onOpenChange={dialog.onOpenChange}
              characters={promptCharacters.characters}
              images={composerImages}
              busy={promptCharacters.busy}
              error={promptCharacters.error}
              canUpload={canWrite && mediaDirectory !== null}
              onUpload={() => uploadInput.current?.click()}
              onSave={promptCharacters.save}
              onDelete={(character, done) => {
                promptCharacters.remove(character.id, done);
              }}
            />
          )}
          guidance={
            visibleNotices.find(
              (notice) => notice.blocking && notice.group === "Setup",
            ) ??
            (generationState.kind === "error"
              ? visibleNotices.find(
                  (notice) => notice.key === generationError?.key,
                )
              : undefined) ??
            (iterationNotice !== null && iterationNotice.model === values.model
              ? {
                  key: "iteration-model",
                  group: "Images",
                  tone: "warning",
                  short: "Model changed",
                  title: "Model changed",
                  detail: iterationNotice.message,
                  actions: [
                    {
                      label: "Dismiss",
                      run: () => {
                        setIterationNotice(null);
                      },
                    },
                  ],
                }
              : undefined)
          }
          commandApp={commandApp}
          footer={(controls, send, settings) => (
            <PrintsFooter
              settings={settings}
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
          referenceImages={composerImages}
        />
      </div>
      <PrintsFolderDialog folder={folder} />
    </main>
  );
}
