import { usePrintNavigation } from "./print-navigation.js";
import {
  galleryImageKey,
  useGalleryMedia,
  type GalleryImage,
  type MediaConnection,
} from "./media-gallery.js";
import { useMediaGeneration } from "./media-generation.js";
import type { AppRoot } from "@fungi.computer/agar";
import { useForm, useSelector } from "@tanstack/react-form";
import {
  AudioLines,
  ChevronDown,
  ChevronUp,
  Image as ImageIcon,
  Maximize2,
  SlidersHorizontal,
  Upload,
  X,
} from "lucide-react";

import { IconButton } from "@fungi.computer/caps/components/icon-button";
import { Button } from "@fungi.computer/caps/components/button";
import { KeycapButton } from "@fungi.computer/caps/components/keycap";
import { ScrollArea } from "@fungi.computer/caps/components/scroll-area";
import { Input } from "@fungi.computer/caps/components/input";
import { Toaster, toast } from "@fungi.computer/caps/components/toaster";
import { notifyPrintsError } from "./prints-error-toast.js";
import { Field } from "@fungi.computer/caps/components/field";
import { Select } from "@fungi.computer/caps/components/select";
import { Switch } from "@fungi.computer/caps/components/switch";
import { EmptyState } from "@fungi.computer/caps/blocks/empty-state";
import { LoadingState } from "@fungi.computer/caps/blocks/loading-state";
import {
  useAppContext,
  useHostNavigation,
  useWindowStatus,
} from "@fungi.computer/agar/react";
import { describeAppError } from "@fungi.computer/agar/errors";
import {
  ComposerResizeHandle,
  useComposerLayout,
} from "./media-composer-size.js";
import { LibraryBar, SelectBar } from "./library-select.js";
import { isBareLibrary } from "./library-view.js";
import { useLibrary } from "./use-library.js";
import { folderStatusItem } from "./folder-status.js";
import { ComposerShell } from "@fungi.computer/parakeet";
import {
  AudioLengthMenu,
  AudioModeControl,
  AudioModelMenu,
  AudioVoiceMenu,
  audioModeOfModel,
  audioOptionsOf,
  availableAudioModes,
  modelsForAudioMode,
} from "./audio-composer-mode.js";
import { GenerationModelKey } from "./generation-model-key.js";
import { useMediaFolder } from "./media-folder.js";
import { activityStatusItem, type PrintsNotice } from "./prints-activity.js";
import { noticesFor } from "./prints-notices.js";
import { useNoticeDismissals } from "./notice-dismissals.js";
import { generationLimitReason } from "./generation-limit.js";
import { reportCatchFailure } from "./log-event.js";
import type { UploadQueueProps } from "@fungi.computer/caps/blocks/upload-queue";

import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  MediaMosaic,
  type MediaFocus,
  type MediaMasonryItem,
} from "./media-masonry.js";
import { isAudioPath } from "./audio-media.js";
import { galleryWithSlots } from "./gallery-slots.js";
import {
  MediaComposerTextarea,
  promptOverMessage,
  MediaMentionSheet,
  MediaMentionTokens,
  MediaSlashSheet,
  mentionTokens,
  usePromptMentions,
  useReferenceLabels,
  useMediaSlashSheet,
  GenerateButton,
} from "./media-composer-pieces.js";
import {
  mentionedReferenceNumbers,
  referenceLabel,
} from "./reference-mentions.js";
import type { ReferenceSlide } from "./reference-lightbox.js";
import { quoteSettingsFor, useGenerationQuote } from "./generation-quote.js";
import { usePromptCharacters } from "./use-prompt-characters.js";
import {
  addedPromptLength,
  expandCharacters,
  type PromptCharacter,
  type ReferenceOption,
} from "./prompt-characters.js";
import { normalizeUploadFilename } from "./upload-path.js";
import {
  DEFAULT_MODEL_ID,
  audioModelsOf,
  pictureModels,
  type GenerationDraft,
  type MediaModel,
  defaultGenerationDraft,
  draftForModel,
  generateActionLabel,
  generationPendingLabel,
  isReferenceOnComputer,
  modelFor,
  nextReferenceRole,
  REFERENCE_ROLE_LABELS,
  referenceRolesFor,
  resolveReferenceRoles,
  matchReferenceSize,
  type PixelSize,
  ratioLabel,
  sizeChoicesFor,
  sizeLabel,
  shortSizeLabel,
  type SizeChoice,
  sizeForModel,
  SIZE_PRESETS,
  GENERATION_FAILED_TILE,
} from "./generation-model.js";
import { registerGenerationCommands } from "./generation-commands.js";
import { usePromptCommands } from "./prompt-commands.js";
import { usePromptStyles } from "./use-prompt-styles.js";
import { animateModelFor, iterationDraft } from "./print-iteration.js";
import { PromptStyleSelect } from "./prompt-style-controls.js";

import { DeferredPanel } from "./deferred-panel.js";

const PrintsActivityTray = lazy(async () => {
  const module = await import("./prints-activity-tray.js");
  return { default: module.PrintsActivityTray };
});

const PromptStylesDialog = lazy(async () => {
  const module = await import("./prompt-styles-dialog.js");
  return { default: module.PromptStylesDialog };
});

const PromptCharactersDialog = lazy(async () => {
  const module = await import("./prompt-character-controls.js");
  return { default: module.PromptCharactersDialog };
});

const ReferenceLightbox = lazy(async () => {
  const module = await import("./reference-lightbox.js");
  return { default: module.ReferenceLightbox };
});

const MoveDialog = lazy(async () => {
  const module = await import("./library-dialogs.js");
  return { default: module.MoveDialog };
});

const NewFolderDialog = lazy(async () => {
  const module = await import("./library-dialogs.js");
  return { default: module.NewFolderDialog };
});

const LibraryFoldersDialog = lazy(async () => {
  const module = await import("./library-folders-dialog.js");
  return { default: module.LibraryFoldersDialog };
});

const LibraryRail = lazy(async () => {
  const module = await import("./library-rail.js");
  return { default: module.LibraryRail };
});

const PrintViewer = lazy(async () => {
  const module = await import("./print-viewer.js");
  return { default: module.PrintViewer };
});

const PrintsFolderDialog = lazy(async () => {
  const module = await import("./prints-folder-dialog.js");
  return { default: module.PrintsFolderDialog };
});

const PrintInfoDrawer = lazy(async () => {
  const module = await import("./print-info-drawer.js");
  return { default: module.PrintInfoDrawer };
});

/** Starting points for an empty gallery; choosing one prepares an editable prompt. */
const promptSuggestions = [
  "a mushroom knight",
  "moss on a keyboard",
  "a tiny house made of mushrooms",
] as const;

type GenerationSubmit = (draft: GenerationDraft) => Promise<boolean>;

/** One generation-failure surface, using the existing Caps/Sonner owner. */
function notifyGenerationFailure(message: string) {
  toast.error(message, {
    id: "prints-generation-error",
    toasterId: "prints-generation-notices",
  });
}

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

/** Menu groups in first-seen order; a model with one kind of size gets a flat list. */
function sizeGroups(
  choices: readonly SizeChoice[],
): readonly { group: SizeChoice["group"]; choices: readonly SizeChoice[] }[] {
  const groups = [...new Set(choices.map((choice) => choice.group))];
  if (groups.length < 2) return [{ group: undefined, choices }];
  return groups.map((group) => ({
    group,
    choices: choices.filter((choice) => choice.group === group),
  }));
}

/** A Computer image the composer can attach, with its decoded pixel size. */
type ReferenceImage = Readonly<{
  path: string;
  url: string;
  width: number;
  height: number;
}>;

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
  match,
  onEditStyles,
  onEditCharacters,
}: {
  form: ReturnType<typeof useGenerationForm>;
  selected: MediaModel | undefined;
  stylePicker: ReactNode;
  sizeChoices: readonly SizeChoice[];
  sizeMode: string;
  onCustomSize: (custom: boolean) => void;
  match: Readonly<{
    offered: boolean;
    /** The size the first reference resolves to, or undefined with none attached. */
    size: PixelSize | undefined;
    onChange: (on: boolean) => void;
  }>;
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
            match.onChange(value === "match");
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
              {match.offered ? (
                <option value="match" disabled={match.size === undefined}>
                  {match.size === undefined
                    ? "Match first reference: attach an image first"
                    : `Match first reference · ${sizeLabel(match.size.width, match.size.height)}`}
                </option>
              ) : null}
              {catalogSized &&
              sizeMode !== "match" &&
              !sizeChoices.some((choice) => choice.value === sizeMode) ? (
                <option value={sizeMode} disabled>
                  Choose a supported resolution
                </option>
              ) : null}
              {sizeGroups(sizeChoices).map(({ group, choices }) =>
                group === undefined ? (
                  choices.map((choice) => (
                    <option key={choice.value} value={choice.value}>
                      {choice.label}
                    </option>
                  ))
                ) : (
                  <optgroup key={group} label={group}>
                    {choices.map((choice) => (
                      <option key={choice.value} value={choice.value}>
                        {choice.label}
                      </option>
                    ))}
                  </optgroup>
                ),
              )}
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
              <Field label="Sound" orientation="horizontal">
                <Select
                  aria-label="Video sound"
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
              <Field label="Sound" orientation="horizontal">
                <Switch
                  aria-label="Video sound"
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

/** One sentence for a notice shown beside or inside the prompt. */
function guidanceText(notice: PrintsNotice): string {
  if (notice.detail === undefined) return notice.title;
  return notice.group === "Images"
    ? notice.detail
    : `${notice.title}. ${notice.detail}`;
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
  generateLimitReason,
  values,
  computerId,
  mediaDirectory,
  referenceImages,
  referenceLabels,
  price,
  characters,
  characterDialog,
  onSubmit,
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
  actions: ReactNode;
  guidance: PrintsNotice | undefined;
  commandApp: AppRoot | undefined;
  form: ReturnType<typeof useGenerationForm>;
  models: readonly MediaModel[];
  modelsLoading: boolean;
  mediaCapability: boolean;
  /** Why generating is off until the person connects a model; shown on the controls. */
  submitting: boolean;
  /** Set while the person is at the in-flight limit: why Generate is off. */
  generateLimitReason: string | undefined;
  values: GenerationDraft;
  computerId: string | null;
  mediaDirectory: string | null;
  referenceImages: readonly ReferenceImage[];
  /** Label number of each attached reference, as `@imageN` names it. */
  referenceLabels: readonly number[];
  /** The host's estimate for this draft, such as "$1.16"; null shows none. */
  price: string | null;
  onSubmit: () => Promise<boolean>;
}): React.JSX.Element {
  const selected = modelFor(models, values.model);
  const composerDisabled =
    !mediaCapability || modelsLoading || models.length === 0;
  // A blocking setup notice explains the empty, disabled prompt: it speaks in
  // the placeholder, so it takes no row of its own.
  const placeholderGuidance =
    composerDisabled &&
    guidance?.group === "Setup" &&
    guidance.blocking === true
      ? guidance
      : undefined;
  const typedLength = values.prompt.trim().length;
  const promptOver =
    selected !== undefined &&
    typedLength > 0 &&
    typedLength + addedLength > selected.maxPromptLength;
  const roles = referenceRolesFor(selected);
  const video = selected?.video ?? null;
  const namesReferences = mentionedReferenceNumbers(values.prompt).length > 0;
  const shownReferences = resolveReferenceRoles(
    values.references,
    selected,
    namesReferences,
  );
  const referenceLimit = selected?.input.maxReferences ?? 0;
  const referencesOver = values.references.length > referenceLimit;
  const promptRef = useRef<HTMLDivElement>(null);
  const regionId = useId();
  const layout = useComposerLayout(promptRef);
  const [overflowing, setOverflowing] = useState(false);
  const promptLength = promptOver ? typedLength + addedLength : 0;
  const promptOverReason =
    selected !== undefined && promptOver
      ? promptOverMessage({
          addedLength,
          length: promptLength,
          maxLength: selected.maxPromptLength,
        })
      : undefined;
  const [customSize, setCustomSize] = useState(false);
  // "Match reference": the output takes the first attached image's shape.
  const [matchReference, setMatchReference] = useState(false);
  const firstReference = values.references.find(
    (reference) =>
      computerId !== null && isReferenceOnComputer(reference, computerId),
  );
  const referenceImage = referenceImages.find(
    (image) => image.path === firstReference?.path,
  );
  const matched =
    referenceImage === undefined
      ? undefined
      : matchReferenceSize(
          selected,
          referenceImage.width,
          referenceImage.height,
        );
  const setFormValue = form.setFieldValue;
  const sizeNow = useRef({ width: values.width, height: values.height });
  sizeNow.current = { width: values.width, height: values.height };
  useEffect(() => {
    if (!matchReference) return;
    if (matched === undefined) {
      // The reference or the model went away; keep the size, leave the mode,
      // and say so, since the next image would otherwise come out at a size
      // the person did not knowingly pick.
      setMatchReference(false);
      toast(
        `Size kept at ${String(sizeNow.current.width)} × ${String(sizeNow.current.height)}; Match first reference turned off`,
        { toasterId: "prints-generation-notices" },
      );
      return;
    }
    setFormValue("width", matched.width);
    setFormValue("height", matched.height);
  }, [matchReference, matched?.width, matched?.height, setFormValue]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Catalog-sized models offer only their sizes; others add presets and custom.
  const catalogSized = selected !== undefined && selected.sizes !== null;
  const sizeChoices = sizeChoicesFor(selected);
  const sizeMode = matchReference
    ? "match"
    : catalogSized
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
        setMatchReference(false);
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
  const referenceOptions = values.references.map(
    (reference, index): ReferenceOption => ({
      number: referenceLabels[index] ?? index + 1,
      name: reference.path.split("/").at(-1) ?? reference.path,
      url:
        computerId !== null && isReferenceOnComputer(reference, computerId)
          ? referenceImages.find((image) => image.path === reference.path)?.url
          : undefined,
    }),
  );
  const mentions = usePromptMentions(
    characters,
    referenceOptions,
    values.prompt,
  );
  const mentionedTokens = mentionTokens(
    values.prompt,
    characters,
    referenceOptions,
    referenceImages,
  );
  const slash = useMediaSlashSheet(promptCommands.items, values.prompt);
  const promptId = useId();
  const slashListId = `${promptId}-commands`;
  const mentionListId = `${promptId}-characters`;
  const mentioned = expandCharacters(values.prompt, characters).characters;
  const pickSlash = (index: number) => {
    const item = slash.slashMatches.at(index);
    if (!item) return;
    slash.resetSlash();
    promptCommands.run(item.command);
  };
  const style = styleControls({
    open: stylesOpen,
    onOpenChange: setStylesOpen,
  });
  // The tray's chip reads back what the hidden choices are set to.
  const summary = [
    values.style,
    matchReference
      ? `Match · ${ratioLabel(values.width, values.height)}`
      : shortSizeLabel(selected, values.width, values.height),
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
      match={{
        offered:
          selected?.kind === "image" && selected.input.dimensions === "own",
        size: matched,
        onChange: setMatchReference,
      }}
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
  /** Switch the draft to another model, carrying over only what that model takes. */
  const applyModel = (next: MediaModel) => {
    const touched = form.store.state.fieldMeta;
    const nextDraft = draftForModel(values, next);
    const size = sizeForModel(values, next, selected);
    form.setFieldValue("model", next.id);
    if (next.input.dimensions === "none" || next.sizes !== null)
      setCustomSize(false);
    form.setFieldValue("width", size.width);
    form.setFieldValue("height", size.height);
    form.setFieldValue("durationSeconds", nextDraft.durationSeconds);
    form.setFieldValue("voiceId", nextDraft.voiceId);
    form.setFieldValue("generateAudio", nextDraft.generateAudio);
    // Audio takes no references; leaving pictures for it drops them.
    if (next.kind === "audio") form.setFieldValue("references", []);
    if (next.input.steps === "fixed" || !touched.steps?.isTouched)
      form.setFieldValue("steps", nextDraft.steps);
  };
  const isAudio = selected?.kind === "audio";
  const [lightboxKey, setLightboxKey] = useState<string | null>(null);
  const referenceTray = useRef<HTMLDivElement>(null);
  const referenceCount = isAudio ? 0 : values.references.length;
  const audioChoices = audioOptionsOf(audioModelsOf(models));
  // The picture model to return to when the Audio key is pressed again.
  const lastPicture = useRef<string | null>(null);
  if (selected !== undefined && selected.kind !== "audio")
    lastPicture.current = selected.id;
  const toggleAudio = () => {
    const target = isAudio
      ? (modelFor(models, lastPicture.current ?? "") ??
        modelFor(models, DEFAULT_MODEL_ID) ??
        pictureModels(models).at(0))
      : modelFor(models, audioChoices.at(0)?.id ?? "");
    if (target) applyModel(target);
  };
  const audioMode = selected !== undefined ? audioModeOfModel(selected) : null;
  const audioInMode =
    audioMode === null ? [] : modelsForAudioMode(audioChoices, audioMode);
  const audioControls =
    selected?.audio == null || audioMode === null ? null : (
      <>
        <AudioModeControl
          disabled={submitting}
          modes={availableAudioModes(audioChoices)}
          value={audioMode}
          onChange={(mode) => {
            const next = modelFor(
              models,
              modelsForAudioMode(audioChoices, mode).at(0)?.id ?? "",
            );
            if (next) applyModel(next);
          }}
        />
        {audioInMode.length > 1 ? (
          <AudioModelMenu
            disabled={submitting}
            models={audioInMode}
            value={selected.id}
            onChange={(id) => {
              const next = modelFor(models, id);
              if (next) applyModel(next);
            }}
          />
        ) : null}
        {selected.audio.mode === "speech" ? (
          <AudioVoiceMenu
            disabled={submitting}
            voices={selected.audio.voices}
            value={values.voiceId ?? selected.audio.defaultVoiceId ?? ""}
            onChange={(voiceId) => {
              form.setFieldValue("voiceId", voiceId);
            }}
          />
        ) : null}
        {selected.audio.seconds === null ? null : (
          <AudioLengthMenu
            disabled={submitting}
            seconds={selected.audio.seconds}
            value={values.durationSeconds ?? selected.audio.seconds.default}
            onChange={(seconds) => {
              form.setFieldValue("durationSeconds", seconds);
            }}
          />
        )}
      </>
    );
  const referenceKey = (reference: (typeof values.references)[number]) =>
    JSON.stringify([reference.computerId ?? computerId, reference.path]);
  const referenceThumbnail = (reference: (typeof values.references)[number]) =>
    computerId !== null && isReferenceOnComputer(reference, computerId)
      ? referenceImages.find((image) => image.path === reference.path)
      : undefined;
  // The slot a reference fills: its video role, else the name `@imageN` gives it.
  const slotLabel = (index: number) => {
    const role = shownReferences[index]?.role;
    return role === undefined
      ? `@${referenceLabel(referenceLabels[index] ?? index + 1)}`
      : REFERENCE_ROLE_LABELS[role];
  };
  const lightboxSlides = values.references.flatMap(
    (reference, index): ReferenceSlide[] => {
      const thumbnail = referenceThumbnail(reference);
      return thumbnail === undefined
        ? []
        : [
            {
              key: referenceKey(reference),
              label: slotLabel(index),
              name: reference.path.split("/").at(-1) ?? reference.path,
              url: thumbnail.url,
            },
          ];
    },
  );
  const lightboxIndex = lightboxSlides.findIndex(
    (slide) => slide.key === lightboxKey,
  );
  return (
    <ComposerShell
      aria-label={isAudio ? "Audio generation" : "Image generation"}
      data-generation-form
      data-composer-collapsed={layout.collapsed ? "" : undefined}
      data-composer-fullscreen={layout.fullscreen ? "" : undefined}
      attachments={
        !isAudio && values.references.length > 0 ? (
          <>
            <div
              ref={referenceTray}
              className="prints-reference-tray"
              aria-label="Image references"
              data-over-limit={referencesOver ? "" : undefined}
              title={`${String(values.references.length)} / ${String(referenceLimit)} references`}
            >
              {values.references.map((reference, index) => {
                const thumbnail = referenceThumbnail(reference);
                const role = shownReferences[index]?.role;
                const next = nextReferenceRole(roles, shownReferences, index);
                return (
                  <div
                    className="prints-reference-tile"
                    data-reference-chip
                    key={referenceKey(reference)}
                    title={
                      reference.computerId === undefined
                        ? reference.path
                        : `${reference.computerId}:${reference.path}`
                    }
                  >
                    {thumbnail ? (
                      <button
                        type="button"
                        className="prints-reference-face prints-reference-open mask mask-squircle"
                        aria-label={`Enlarge ${slotLabel(index)}: ${reference.path.split("/").at(-1) ?? reference.path}`}
                        aria-haspopup="dialog"
                        data-reference-key={referenceKey(reference)}
                        onClick={() => {
                          setLightboxKey(referenceKey(reference));
                        }}
                      >
                        <img
                          src={thumbnail.url}
                          alt={reference.path.split("/").at(-1)}
                        />
                      </button>
                    ) : (
                      <div className="prints-reference-face mask mask-squircle">
                        <span>
                          {referenceLabel(referenceLabels[index] ?? index + 1)}
                        </span>
                      </div>
                    )}
                    <span
                      className="prints-reference-label"
                      data-reference-label
                    >
                      {referenceLabel(referenceLabels[index] ?? index + 1)}
                    </span>
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
                          values.references.filter((_item, at) => at !== index),
                        );
                      }}
                    />
                  </div>
                );
              })}
            </div>
            <DeferredPanel active={lightboxIndex >= 0}>
              <ReferenceLightbox
                slides={lightboxSlides}
                index={lightboxIndex < 0 ? null : lightboxIndex}
                onIndexChange={(next) => {
                  setLightboxKey(lightboxSlides[next]?.key ?? null);
                }}
                onClose={() => {
                  setLightboxKey(null);
                }}
                returnFocusTo={(key) =>
                  [
                    ...(referenceTray.current?.querySelectorAll<HTMLElement>(
                      "[data-reference-key]",
                    ) ?? []),
                  ].find(
                    (thumbnail) => thumbnail.dataset.referenceKey === key,
                  ) ?? null
                }
              />
            </DeferredPanel>
          </>
        ) : undefined
      }
      input={
        <>
          <form
            aria-busy={submitting}
            onSubmit={(event) => {
              event.preventDefault();
              void onSubmit();
            }}
          >
            <form.Field name="prompt">
              {(field) => (
                <div
                  className="prints-prompt"
                  data-guidance-placeholder={
                    placeholderGuidance ? "" : undefined
                  }
                  id={regionId}
                  ref={promptRef}
                >
                  {slash.slashOpen ? (
                    <MediaSlashSheet
                      index={slash.slashIndex}
                      listId={slashListId}
                      matches={slash.slashMatches}
                      onHighlight={slash.highlightSlash}
                      onPick={pickSlash}
                    />
                  ) : null}
                  {!slash.slashOpen && mentions.matches.length > 0 ? (
                    <MediaMentionSheet
                      images={referenceImages}
                      index={mentions.index}
                      listId={mentionListId}
                      matches={mentions.matches}
                      onHighlight={mentions.highlight}
                      onPick={(at) => {
                        const next = mentions.complete(at);
                        if (next !== null) field.handleChange(next);
                      }}
                    />
                  ) : null}
                  <MediaComposerTextarea
                    caretRequest={mentions.caretRequest}
                    layout={layout}
                    onOver={notifyGenerationFailure}
                    onOverflow={setOverflowing}
                    menu={
                      slash.slashOpen
                        ? {
                            open: slash.slashMatches.length > 0,
                            listId: slashListId,
                            selected: slash.slashIndex,
                          }
                        : {
                            open: mentions.matches.length > 0,
                            listId: mentionListId,
                            selected: mentions.index,
                          }
                    }
                    mentionCount={slash.slashOpen ? 0 : mentions.matches.length}
                    onCaret={mentions.setCaret}
                    onMentionDismiss={mentions.dismiss}
                    onMentionMove={mentions.move}
                    onMentionPick={() => {
                      const next = mentions.complete(mentions.index);
                      if (next !== null) field.handleChange(next);
                    }}
                    disabled={composerDisabled || submitting}
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
                    placeholder={
                      placeholderGuidance
                        ? guidanceText(placeholderGuidance)
                        : selected?.audio?.mode === "speech"
                          ? "What should it say?"
                          : selected?.audio?.mode === "music"
                            ? "Describe the music"
                            : "What are we making?"
                    }
                    slashCount={slash.slashMatches.length}
                    value={field.state.value}
                  />
                  {mentioned.length > 0 || mentionedTokens.length > 0 ? (
                    <div className="prints-composer-notes">
                      <MediaMentionTokens tokens={mentionedTokens} />
                      {mentioned.length > 0 ? (
                        <span
                          className="prints-reference-count"
                          data-generation-characters
                        >
                          {`Characters: ${mentioned.map((entry) => entry.name).join(", ")}`}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              )}
            </form.Field>
          </form>
          {guidance && !placeholderGuidance ? (
            <div
              className="prints-composer-guidance"
              role="status"
              data-composer-guidance
            >
              <span>{guidanceText(guidance)}</span>
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
        </>
      }
      row={{
        controls: (
          <>
            {layout.fullscreen ? null : (
              <KeycapButton
                aria-controls={regionId}
                aria-expanded={!layout.collapsed}
                aria-label={
                  layout.collapsed ? "Expand composer" : "Collapse composer"
                }
                data-composer-collapse
                icon={layout.collapsed ? <ChevronUp /> : <ChevronDown />}
                label={null}
                onClick={() => {
                  layout.setCollapsed(!layout.collapsed);
                }}
                onMouseDown={(event) => {
                  // Keep the caret in the prompt when the key is clicked.
                  event.preventDefault();
                }}
                title={
                  layout.collapsed ? "Expand composer" : "Collapse composer"
                }
              />
            )}
            {layout.collapsed && referenceCount > 0 ? (
              <span
                aria-label={`${String(referenceCount)} ${referenceCount === 1 ? "reference" : "references"} attached`}
                className="prints-composer-count"
                data-composer-count
                role="img"
                title={`${String(referenceCount)} ${referenceCount === 1 ? "reference" : "references"} attached`}
              >
                <ImageIcon aria-hidden="true" />
                {referenceCount}
              </span>
            ) : null}
            {layout.coarse && overflowing && !layout.collapsed ? (
              <KeycapButton
                aria-label="Open full-screen editor"
                data-composer-expand
                icon={<Maximize2 />}
                label={null}
                onClick={() => {
                  layout.setFullscreen(true);
                  promptRef.current?.querySelector("textarea")?.focus();
                }}
                title="Open full-screen editor"
              />
            ) : null}
            {placeholderGuidance
              ? placeholderGuidance.actions?.map((action) => (
                  <Button
                    key={action.label}
                    variant="ghost"
                    size="xs"
                    onClick={action.run}
                  >
                    {action.label}
                  </Button>
                ))
              : null}
            {isAudio ? null : actions}
            {audioChoices.length > 0 ? (
              <KeycapButton
                aria-label="Audio"
                data-generation-audio-key
                icon={<AudioLines />}
                label={null}
                pressed={isAudio}
                tone={isAudio ? "accent" : "neutral"}
                title={isAudio ? "Back to pictures" : "Make audio"}
                disabled={modelsLoading || !mediaCapability}
                onClick={toggleAudio}
              />
            ) : null}
            {isAudio ? (
              audioControls
            ) : (
              <form.Field name="model">
                {(field) => (
                  <GenerationModelKey
                    compact={layout.coarse}
                    models={pictureModels(models)}
                    emptyLabel={
                      computerId === null
                        ? "Choose a Computer"
                        : modelsLoading
                          ? "Loading models…"
                          : "Models unavailable"
                    }
                    disabled={modelsLoading || !mediaCapability}
                    onChange={(id) => {
                      const next = modelFor(models, id);
                      if (next) applyModel(next);
                    }}
                    value={field.state.value}
                  />
                )}
              </form.Field>
            )}
            {computerId && mediaDirectory ? (
              <span
                className="sr-only"
                data-generation-computer
                title="Where new prints are saved"
              >
                Saved in your Prints folder
              </span>
            ) : null}
          </>
        ),
        action: (
          <span className="prints-generate-action">
            {price === null ? null : (
              <span
                className="prints-generate-price"
                data-generation-price
                title="Estimated price"
              >
                {price.startsWith("<") ? price : `≈ ${price}`}
              </span>
            )}
            <GenerateButton
              busy={submitting}
              draft={values.prompt}
              disabled={
                !mediaCapability ||
                modelsLoading ||
                models.length === 0 ||
                submitting ||
                generateLimitReason !== undefined
              }
              disabledReason={generateLimitReason ?? promptOverReason}
              label={generateActionLabel(selected)}
              onGenerate={() => {
                void onSubmit();
              }}
              promptOver={promptOver}
            />
          </span>
        ),
        items: isAudio
          ? []
          : [
              {
                id: "settings",
                accessibleLabel: "Generation settings",
                title: "Settings",
                label: (
                  <span className="prints-settings-chip">
                    <SlidersHorizontal
                      aria-hidden="true"
                      className="size-[var(--stipe-icon-size-sm)]"
                    />
                    <span className="prints-settings-chip-text">
                      {summary.length > 0 ? summary.join(" · ") : "Settings"}
                    </span>
                  </span>
                ),
                content: settings,
              },
            ],
        openId: settingsOpen ? "settings" : null,
        onOpenChange: (id) => {
          setSettingsOpen(id === "settings");
        },
      }}
    >
      <ComposerResizeHandle layout={layout} />
      <div className="prints-composer-editor-bar" data-composer-editor-bar>
        <span>Prompt</span>
        <KeycapButton
          data-composer-done
          label="Done"
          onClick={() => {
            layout.setFullscreen(false);
            promptRef.current?.querySelector("textarea")?.focus();
          }}
        />
      </div>
      {style.dialog}
      {characterDialog({
        open: charactersOpen,
        onOpenChange: setCharactersOpen,
      })}
    </ComposerShell>
  );
}

export function MediaPane({
  connection,
}: {
  connection: MediaConnection | null;
}): React.JSX.Element {
  const pane = useRef<HTMLElement>(null);
  const connectionRef = useRef(connection);
  connectionRef.current = connection;
  const folder = useMediaFolder(connection?.app ?? null);
  // The host says up front whether a provider is connected; no send is wasted finding out.
  const mediaSetupMissing =
    useAppContext(connection?.app ?? null)?.setup?.media === "missing";
  const [setupWaiting, setSetupWaiting] = useState(false);
  const [setupUnavailable, setSetupUnavailable] = useState(false);
  const openMediaSetup = () => {
    const app = connection?.app;
    if (!app) return;
    setSetupWaiting(true);
    setSetupUnavailable(false);
    app.ui.openSetup("media").then(
      (outcome) => {
        setSetupWaiting(false);
        setSetupUnavailable(outcome === "unavailable");
      },
      (cause: unknown) => {
        setSetupWaiting(false);
        setSetupUnavailable(true);
        reportCatchFailure("open-media-setup", cause);
      },
    );
  };
  const setupCause = setupUnavailable ? (
    <>
      Image setup couldn’t open.{" "}
      <a
        href="https://github.com/fungi-computer/oyster#deploy-to-cloudflare"
        target="_blank"
        rel="noreferrer"
      >
        Open the image setup guide
      </a>
      .
    </>
  ) : (
    "Image generation isn’t set up yet."
  );
  const [noticesOpen, setNoticesOpen] = useState(false);
  const [activityInset, setActivityInset] = useState<number | undefined>();
  const dismissed = useNoticeDismissals(
    connection?.app ?? null,
    folder.computerId,
  );
  const [infoImage, setInfoImage] = useState<GalleryImage | null>(null);
  const [viewerKey, setViewerKey] = useState<string | null>(null);
  const [viewerFocus, setViewerFocus] = useState<MediaFocus>();
  const viewerCloseSequence = useRef(0);
  useEffect(() => {
    setInfoImage(null);
    setViewerKey(null);
    setViewerFocus(undefined);
  }, [connection, folder.computerId, folder.path]);
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
    addComputerFile,
    retryFile,
    uploads,
    uploadFiles,
  } = galleryMedia;
  const libraryVisible =
    connection !== null && folder.destination !== null && canBrowse && canRead;
  const library = useLibrary({
    app: connection?.app ?? null,
    destination: folder.destination,
    view: folder.view,
    setView: folder.setView,
    entries: gallery.entries,
    canWrite,
  });
  const [foldersOpen, setFoldersOpen] = useState(false);
  // Nothing to select in an empty library; Select lives in the window header.
  const selectable =
    library.selecting ||
    gallery.entries.length > 0 ||
    galleryMedia.gallery.folders.length > 0;
  // A library with no prints and no folders has nothing to switch between or
  // open: the bar would only push the invitation down.
  const bareLibrary = isBareLibrary({
    selectable,
    atFolderRoot: folder.view.kind === "folder" && !library.up,
    loading: loading || gallery.loading,
    failed: Boolean(gallery.error),
  });
  useHostNavigation(libraryVisible ? connection.app.window.navigation : null, {
    canGoBack: library.history.canGoBack,
    canGoForward: library.history.canGoForward,
    crumbs: library.crumbs,
    primary: selectable
      ? [{ id: "select", label: "Select", variant: "outline" }]
      : [],
    onAction: (id) => {
      if (id === "select") library.setSelecting(!library.selecting);
    },
    onBack: library.history.back,
    onForward: library.history.forward,
    onCrumb: (id) => {
      library.history.open(
        id === "all" || id === "favorites"
          ? { kind: id }
          : { kind: "folder", folder: id === "" ? undefined : id },
      );
    },
  });
  const [progressNow, setProgressNow] = useState(Date.now);
  const hasVideoSlot = gallerySlots.some(
    (slot) => slot.startedAt !== undefined && !slot.resolved && !slot.error,
  );
  useEffect(() => {
    if (!hasVideoSlot) return;
    const timer = setInterval(() => {
      setProgressNow(Date.now());
    }, 1_000);
    return () => {
      clearInterval(timer);
    };
  }, [hasVideoSlot]);
  const printNavigation = usePrintNavigation(
    connection,
    (path, selectedConnection, computerId) => {
      gallery.refresh();
      return addComputerFile(path, selectedConnection, computerId);
    },
  );
  useLayoutEffect(() => {
    setViewerFocus(undefined);
    if (printNavigation.target) {
      // Reset before Mosaic's passive focus callback opens a cached output.
      setInfoImage(null);
      setViewerKey(null);
    }
  }, [printNavigation.target]);
  useEffect(() => {
    if (printNavigation.error)
      notifyPrintsError(
        "Could not open this print. It may no longer be available on this Computer.",
        "prints-navigation-error",
      );
  }, [printNavigation.error]);
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
  const promptStyles = usePromptStyles(connection?.app ?? null);
  const promptCharacters = usePromptCharacters(connection?.app ?? null);
  /** Slots whose run saved and now wait for the picture to decode. */
  const [previewLoading, setPreviewLoading] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const generation = useMediaGeneration({
    connection,
    folder,
    styles: promptStyles.styles,
    characters: promptCharacters.characters,
    effects: {
      reserve: (slot) => {
        setPreviewLoading((keys) => {
          if (!keys.has(slot.key)) return keys;
          const next = new Set(keys);
          next.delete(slot.key);
          return next;
        });
        reserveSlot(slot);
      },
      failed: failSlot,
      release: removeSlot,
      notifyFailure: notifyGenerationFailure,
      saved: ({ result }, selectedConnection) => {
        setPreviewLoading((keys) =>
          new Set(keys).add(
            `${result.destination.computerId}:${result.destination.path}`,
          ),
        );
        if (canRead)
          void addComputerFile(
            result.destination.path,
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
  const referenceLabelsRef = useRef<readonly number[]>([]);
  const generationSubmit = useRef<GenerationSubmit>((draft) =>
    generation.submit(draft, referenceLabelsRef.current),
  );
  generationSubmit.current = async (draft) => {
    const accepted = await generation.submit(draft, referenceLabelsRef.current);
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
  const referenceLabels = useReferenceLabels(
    values.references,
    values.prompt,
    folder.computerId,
  );
  referenceLabelsRef.current = referenceLabels;
  // What the host would charge for this draft, asked while the form settles.
  const price = useGenerationQuote(
    generation.session,
    quoteSettingsFor({
      draft: values,
      model: modelFor(generation.models, values.model),
      styleText: promptStyles.styles.find(
        (entry) => entry.name === values.style,
      )?.text,
      characters: promptCharacters.characters,
      labels: referenceLabels,
      computerId: folder.computerId,
    }),
  );
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
          generationRef.current.atLimit
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
      models.find((model) => model.id === DEFAULT_MODEL_ID) ??
      pictureModels(models).at(0) ??
      models[0];
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
    addComputerFile,
    retryPath: generation.retryPath,
    uploads,
  });
  galleryActions.current = {
    addComputerFile,
    retryPath: generation.retryPath,
    uploads,
  };
  const selectedImageKey = navigationImage
    ? galleryImageKey(navigationImage)
    : null;
  const items = useMemo<MediaMasonryItem[]>(
    () =>
      images.map((image) => ({
        key: galleryImageKey(image),
        selected: galleryImageKey(image) === selectedImageKey,
        path:
          image.source.kind === "computer"
            ? image.source.path
            : image.file.name,
        referenced: references.some(
          (reference) =>
            image.source.kind === "computer" &&
            isReferenceOnComputer(reference, image.source.computerId) &&
            reference.path === image.source.path,
        ),
        referenceDisabled:
          references.length >= referenceLimit &&
          !references.some(
            (reference) =>
              image.source.kind === "computer" &&
              isReferenceOnComputer(reference, image.source.computerId) &&
              reference.path === image.source.path,
          ),
        onToggleReference:
          image.source.kind === "computer" &&
          referenceLimit > 0 &&
          !isAudioPath(image.source.path)
            ? () => {
                if (image.source.kind !== "computer") return;
                const path = image.source.path;
                const computerId = image.source.computerId;
                const referenced = references.some(
                  (reference) =>
                    isReferenceOnComputer(reference, computerId) &&
                    reference.path === path,
                );
                form.setFieldValue(
                  "references",
                  referenced
                    ? references.filter(
                        (reference) =>
                          !isReferenceOnComputer(reference, computerId) ||
                          reference.path !== path,
                      )
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
          setInfoImage(null);
          setViewerKey(galleryImageKey(image));
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
    const listed = gallery.entries;
    const rows = listed.map((entry) => {
      const key = `${computerId}:${entry.path}`;
      const row = ready.get(key) ?? {
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
        error: failed.includes(entry.name)
          ? "Could not load this print."
          : undefined,
      };
      return {
        ...row,
        onRetry: () => {
          retryFile(entry.path);
        },
      };
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
    retryFile,
    failed,
    folder.computerId,
    selectedImageKey,
  ]);
  // An empty folder, All or Favorites says so, instead of inviting a first print.
  const libraryEmpty =
    libraryVisible && !(folder.view.kind === "folder" && !library.up)
      ? folder.view.kind === "all"
        ? {
            title: "No prints yet",
            description: "Prints in any folder of the library appear here.",
          }
        : folder.view.kind === "favorites"
          ? {
              title: "No favorites yet",
              description:
                "Tap the heart on a print to keep it here for your whole Team.",
            }
          : {
              title: `Nothing in ${library.title} yet`,
              description:
                "New prints you make here land in it. You can also drop in images or move prints from another folder.",
            }
      : null;
  const activeRuns = [...activeGenerations].sort().join("|");
  const failedSlots = gallerySlots.filter(
    (slot) => slot.error !== undefined,
  ).length;
  // A remembered command with no run behind it did not finish. It stays on the
  // wall as a failed tile, across reloads, until it is retried or dismissed.
  const interruptedItems = useMemo(
    () =>
      pendingGenerations
        .filter(
          (record) =>
            record.reference.computerId === folder.computerId &&
            !activeRuns.split("|").includes(record.reference.requestId) &&
            !gallerySlots.some(
              (slot) =>
                slot.computerId === record.reference.computerId &&
                slot.path === record.input.destination.path,
            ),
        )
        .map((record): MediaMasonryItem => ({
          key: `${record.reference.computerId}:${record.input.destination.path}`,
          path: record.input.destination.path,
          width: 1024,
          // A failed tile is at least 4:5, so its reason and buttons fit.
          height: 1280,
          url: "",
          pending: true,
          // The remembered reason stays in Activity; the tile keeps it quiet.
          error:
            record.failure === undefined
              ? "Stopped when Prints closed. Retry to run it again."
              : GENERATION_FAILED_TILE,
          prompt: record.typed.prompt,
          onOpen: () => undefined,
          onRetry: () => {
            generationRef.current.resume(record);
          },
          onDismiss: () => {
            generationRef.current.discard(record);
          },
        })),
    [pendingGenerations, folder.computerId, activeRuns, gallerySlots],
  );
  const wallItems = useMemo(
    () => [
      ...interruptedItems,
      ...galleryWithSlots(listedItems, gallerySlots, (slot) => {
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
          height:
            error === undefined
              ? slot.height
              : Math.max(slot.height, slot.width * 1.25),
          url: "",
          pending: true,
          error,
          prompt:
            pendingGenerations.find(
              (record) =>
                record.reference.computerId === slot.computerId &&
                record.input.destination.path === slot.path,
            )?.typed.prompt ?? generation.promptAt(slot.path),
          pendingLabel:
            upload?.status === "complete" || previewLoading.has(slot.key)
              ? "Loading preview…"
              : slot.uploadId
                ? "Uploading image…"
                : slot.startedAt !== undefined
                  ? generationPendingLabel(
                      models.find((model) => model.kind === "video"),
                      progressNow - slot.startedAt,
                      slot.resumed,
                    )
                  : slot.pendingLabel,
          onOpen: () => undefined,
          onStop:
            error === undefined && slot.uploadId === undefined
              ? () => {
                  generationRef.current.stopPath(slot.path);
                }
              : undefined,
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
                    void galleryActions.current.addComputerFile(
                      slot.path,
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
    ],
    [
      interruptedItems,
      pendingGenerations,
      failedSlots,
      generation.promptAt,
      previewLoading,
      listedItems,
      gallerySlots,
      uploads.items,
      canRead,
      models,
      progressNow,
    ],
  );
  const startersEnabled =
    !mediaSetupMissing &&
    mediaCapability &&
    canGenerate &&
    canWrite &&
    mediaDirectory !== null &&
    generationState.kind === "ready" &&
    !modelsLoading &&
    models.length > 0;
  const currentUploads = uploads.items.filter(
    (item) => item.computerId === folder.computerId,
  );
  const openBilling = () => {
    if (!connection) return;
    void connection.app.ui.openTeamBilling().catch((cause: unknown) => {
      reportCatchFailure("open-team-billing", cause);
      if (connectionRef.current === connection)
        generation.reportRecoveryError(cause);
    });
  };
  // A refused admission, then one entry per failed run so none hides another.
  const generationErrors = [
    ...(generationState.kind === "error" && modelsError === null
      ? [
          {
            key: "generation:draft",
            mediaKind: generationState.mediaKind,
            message: generationState.message,
            billing:
              generationState.action === "billing" ? openBilling : undefined,
          },
        ]
      : []),
    ...generation.failures.map((failure) => ({
      key: failure.key,
      mediaKind: failure.mediaKind,
      message: failure.message,
      billing: failure.action === "billing" ? openBilling : undefined,
      prompt: failure.prompt,
      retry: failure.retry,
      dismiss: () => {
        // The tile and the Activity row go together with the remembered run.
        for (const slot of gallerySlots)
          if (slot.path === failure.path) removeSlot(slot.key);
        failure.dismiss();
      },
    })),
  ];
  const notices = noticesFor({
    connected: connection !== null,
    mediaCapability,
    modelsError,
    retryModels: generation.retryModels,
    modelsLoading,
    models,
    canGenerate,
    mediaSetupMissing,
    canWrite,
    generationErrors,
    recoveryError,
    pendingGenerations,
    activeGenerations,
    atGenerationLimit: generation.atLimit,
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
  const activityItem = activityStatusItem(
    visibleNotices,
    activity,
    noticesOpen,
  );
  useWindowStatus(
    connection?.app,
    [
      ...(folder.available
        ? [
            folderStatusItem(folder.landingPath ?? folder.path, {
              checking: folder.busy && folder.path === null,
              editing: folder.editing,
            }),
          ]
        : []),
      ...(activityItem === null ? [] : [activityItem]),
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
      if (action.itemId === "activity") {
        // The tray opens above the key the person used in the window's bar.
        setActivityInset(action.anchor?.start);
        setNoticesOpen((open) => !open);
        return true;
      }
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
  const composerImages = images.flatMap((image) =>
    image.source.kind === "computer"
      ? [
          {
            path: image.source.path,
            url: image.url,
            width: image.width,
            height: image.height,
          },
        ]
      : [],
  );
  const closeViewer = (lastKey: string) => {
    setViewerKey(null);
    viewerCloseSequence.current += 1;
    setViewerFocus({
      key: lastKey,
      requestId: `viewer-close-${String(viewerCloseSequence.current)}`,
      onFocus: () => undefined,
    });
  };
  const renderPrintInfo = (
    image: GalleryImage,
    onClose: () => void,
    download?: ReactNode,
  ) => (
    <Suspense fallback={null}>
      <PrintInfoDrawer
        key={image.url}
        image={image}
        app={connection?.app ?? null}
        referenceImages={composerImages}
        models={models}
        canAnimate={animateModelFor(models) !== undefined}
        operations={{
          session: generation.session,
          atLimit: generation.atLimit,
          onRun: async (operation, megapixels) => {
            if (image.source.kind !== "computer") return;
            const reason = await generation.operate(
              {
                computerId: image.source.computerId,
                path: image.source.path,
                width: image.width,
                height: image.height,
              },
              operation,
              megapixels,
            );
            if (reason !== null) {
              notifyGenerationFailure(reason);
              return;
            }
            setInfoImage(null);
            if (viewerKey !== null) closeViewer(galleryImageKey(image));
          },
        }}
        download={download}
        library={
          libraryVisible &&
          image.source.kind === "computer" &&
          folder.destination !== null &&
          image.source.path.startsWith(`${folder.destination}/`)
            ? (() => {
                const path = image.source.path;
                const favorite = library.isFavorite(path);
                return {
                  favorite,
                  onToggleFavorite: () => {
                    library.toggleFavorite([path], !favorite);
                  },
                  onMove: canWrite
                    ? () => {
                        library.setMoving([path]);
                      }
                    : undefined,
                };
              })()
            : undefined
        }
        onIterate={(action, lineage) => {
          if (image.source.kind !== "computer") return null;
          const outcome = iterationDraft(action, {
            lineage,
            printComputerId: image.source.computerId,
            printPath: image.source.path,
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
          if (viewerKey !== null) closeViewer(galleryImageKey(image));
          return null;
        }}
        onClose={onClose}
      />
    </Suspense>
  );
  const uploadAction = {
    label: "Upload images",
    onSelect: () => uploadInput.current?.click(),
    disabled: !canWrite || mediaDirectory === null,
    disabledReason: "Choose a writable Computer and folder to upload images.",
  };
  // First run with no folder yet: the invitation itself opens the picker.
  const chooseFolder =
    !mediaSetupMissing &&
    folder.failure === null &&
    libraryEmpty === null &&
    folder.computerId !== null &&
    folder.available &&
    mediaDirectory === null;
  const chooseFolderAction = {
    label: "Choose folder",
    onSelect: () => {
      folder.setEditing(true);
    },
  };
  const imageSetupAction = (
    <Button variant="ghost" loading={setupWaiting} onClick={openMediaSetup}>
      Set up image generation
    </Button>
  );
  return (
    <main
      ref={pane}
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
      <Toaster id="prints-generation-notices" />
      <div
        className="prints-library"
        data-library={libraryVisible || undefined}
      >
        {libraryVisible && folder.destination ? (
          <Suspense
            fallback={
              <nav
                className="prints-rail"
                aria-label="Library"
                aria-busy="true"
              />
            }
          >
            <LibraryRail
              app={connection.app}
              root={folder.destination}
              view={folder.view}
              onView={library.history.open}
              canWrite={canWrite}
              version={library.version}
              onNewFolder={(parent) => {
                library.setNewFolder({ parent });
              }}
              onDrop={(paths, target) => {
                void library.move(paths, target);
              }}
              onRename={(path, name) => {
                void library.move(
                  [path],
                  library.folderOf(folder.destination ?? "", path),
                  { name },
                );
              }}
              onMoveRows={library.setMoving}
            />
          </Suspense>
        ) : null}
        <div
          className="prints-library-main"
          data-selecting={library.selecting || undefined}
        >
          {libraryVisible ? (
            <>
              {bareLibrary ? null : (
                <LibraryBar
                  view={folder.view}
                  lastFolder={library.lastFolder}
                  onOpen={library.history.open}
                  onFolders={() => {
                    setFoldersOpen(true);
                  }}
                  subfolders={
                    folder.view.kind === "folder"
                      ? galleryMedia.gallery.folders
                      : []
                  }
                  onOpenSubfolder={(name) => {
                    library.history.open({
                      kind: "folder",
                      folder:
                        folder.view.kind === "folder" && folder.view.folder
                          ? `${folder.view.folder}/${name}`
                          : name,
                    });
                  }}
                />
              )}
              {library.selecting ? (
                <SelectBar
                  count={library.selected.size}
                  total={gallery.entries.length}
                  canWrite={canWrite}
                  onToggleAll={() => {
                    library.selectAll(
                      library.selected.size === gallery.entries.length
                        ? []
                        : gallery.entries.map((entry) => entry.path),
                    );
                  }}
                  onMove={() => {
                    library.setMoving([...library.selected]);
                  }}
                  onFavorite={() => {
                    library.toggleFavorite([...library.selected], true);
                  }}
                  onDone={() => {
                    library.setSelecting(false);
                  }}
                />
              ) : null}
            </>
          ) : null}
          <div className="prints-gallery-region">
            <ScrollArea
              screen
              ref={scrollRef}
              className="prints-gallery-scroll flex-1 min-h-0"
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
                    items={
                      libraryVisible ? wallItems.map(library.enrich) : wallItems
                    }
                    scrollRef={scrollRef}
                    focus={
                      viewerKey !== null
                        ? undefined
                        : (viewerFocus ??
                          (navigationImage && printNavigation.target
                            ? {
                                key: `${printNavigation.target.computerId}:${printNavigation.target.path}`,
                                requestId: printNavigation.target.requestId,
                                onFocus: () => {
                                  setInfoImage(null);
                                  setViewerKey(
                                    galleryImageKey(navigationImage),
                                  );
                                },
                              }
                            : undefined))
                    }
                  />
                ) : !(loading || gallery.loading) && folder.failure !== null ? (
                  // A failed folder read is not an empty library: say why and
                  // offer the retry in place, never the first-print invitation.
                  <EmptyState
                    aria-live="polite"
                    data-media-failure
                    role="status"
                    variant="speech"
                    className="prints-invitation"
                    visual="blobs"
                    title={describeAppError(folder.failure).title}
                    description={describeAppError(folder.failure).message}
                    primaryAction={{
                      label: "Retry",
                      onSelect: folder.recheck,
                    }}
                    actions={
                      folder.available ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            folder.setEditing(true);
                          }}
                        >
                          Choose folder
                        </Button>
                      ) : undefined
                    }
                  />
                ) : !(loading || gallery.loading) ? (
                  <EmptyState
                    aria-live="polite"
                    data-absence
                    data-media-empty
                    role="status"
                    variant="speech"
                    className="prints-invitation"
                    visual="blobs"
                    title={
                      mediaSetupMissing
                        ? "Make and collect images"
                        : (libraryEmpty?.title ?? "Make your first print")
                    }
                    description={
                      mediaSetupMissing
                        ? "Upload images to start your collection. Open any image to view or download it."
                        : libraryEmpty !== null
                          ? libraryEmpty.description
                          : folder.computerId === null
                            ? "Your images will appear here."
                            : chooseFolder
                              ? "Choose where Prints saves, then describe something."
                              : "Describe something and it lands here, or drop in images from your Computer."
                    }
                    primaryAction={
                      mediaSetupMissing
                        ? uploadAction
                        : chooseFolder
                          ? chooseFolderAction
                          : undefined
                    }
                    actions={
                      chooseFolder ? undefined : mediaSetupMissing ? (
                        <div className="prints-image-setup">
                          <span>{setupCause}</span>
                          {imageSetupAction}
                        </div>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={!canWrite || mediaDirectory === null}
                          onClick={() => uploadInput.current?.click()}
                        >
                          Upload images
                        </Button>
                      )
                    }
                    suggestions={
                      mediaSetupMissing || chooseFolder
                        ? undefined
                        : promptSuggestions.map((prompt) => ({
                            label: prompt,
                            disabled: !startersEnabled,
                            onSelect: () => {
                              form.setFieldValue("prompt", prompt);
                              pane.current
                                ?.querySelector<HTMLTextAreaElement>(
                                  "[data-generation-prompt]",
                                )
                                ?.focus();
                            },
                          }))
                    }
                  />
                ) : (
                  <LoadingState
                    data-media-loading
                    framed={false}
                    message="Loading prints…"
                    detail="Your library is on its way."
                    variant="wander"
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
            {infoImage &&
            (infoImage.source.kind === "local" ||
              (infoImage.source.connection === connection &&
                infoImage.source.computerId === folder.computerId))
              ? renderPrintInfo(infoImage, () => {
                  setInfoImage(null);
                })
              : null}
          </div>
        </div>
      </div>
      {libraryVisible && folder.destination ? (
        <>
          <DeferredPanel active={library.moving !== null}>
            <MoveDialog
              app={connection.app}
              root={folder.destination}
              from={
                folder.view.kind === "folder"
                  ? { folder: folder.view.folder }
                  : null
              }
              canWrite={canWrite}
              count={library.moving?.length ?? 0}
              open={library.moving !== null}
              version={library.version}
              onClose={() => {
                library.setMoving(null);
              }}
              onMove={(target, create) => {
                const paths = library.moving ?? [];
                library.setMoving(null);
                library.setSelecting(false);
                void library.move(paths, target, { create });
              }}
            />
          </DeferredPanel>
          <DeferredPanel active={library.newFolder !== null}>
            <NewFolderDialog
              parent={library.newFolder?.parent}
              open={library.newFolder !== null}
              onClose={() => {
                library.setNewFolder(null);
              }}
              onCreate={(name) =>
                library.createFolder(library.newFolder?.parent, name)
              }
            />
          </DeferredPanel>
          <DeferredPanel active={foldersOpen}>
            <LibraryFoldersDialog
              open={foldersOpen}
              onOpenChange={setFoldersOpen}
              app={connection.app}
              root={folder.destination}
              view={folder.view}
              onView={(next) => {
                library.history.open(next);
                setFoldersOpen(false);
              }}
              canWrite={canWrite}
              version={library.version}
              onNewFolder={(parent) => {
                setFoldersOpen(false);
                library.setNewFolder({ parent });
              }}
              onMoveRows={library.setMoving}
            />
          </DeferredPanel>
        </>
      ) : null}
      {viewerKey !== null ? (
        <Suspense fallback={null}>
          <PrintViewer
            items={wallItems}
            images={images}
            viewerKey={viewerKey}
            app={connection?.app ?? null}
            onNavigate={setViewerKey}
            onClose={closeViewer}
            renderInfo={(image, onClose) =>
              renderPrintInfo(image, onClose, null)
            }
          />
        </Suspense>
      ) : null}
      {mediaSetupMissing && wallItems.length > 0 ? (
        <div className="prints-library-actions">
          <Button
            size="sm"
            onClick={uploadAction.onSelect}
            disabled={uploadAction.disabled}
          >
            Upload images
          </Button>
          {imageSetupAction}
          {setupUnavailable ? (
            <div className="prints-image-setup">{setupCause}</div>
          ) : null}
        </div>
      ) : null}
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
        {mediaSetupMissing ? null : (
          <GenerationComposer
            addedLength={
              selectedModel?.kind === "audio"
                ? 0
                : addedPromptLength(
                    values.prompt,
                    promptStyles.styles.find(
                      (style) => style.name === values.style,
                    )?.text,
                    promptCharacters.characters,
                  )
            }
            styleControls={(dialog) => ({
              picker: (
                <PromptStyleSelect
                  styles={promptStyles.styles}
                  selected={values.style}
                  disabled={!mediaCapability || modelsLoading || submitting}
                  onSelect={(name) => {
                    form.setFieldValue("style", name);
                  }}
                />
              ),
              dialog: (
                <DeferredPanel active={dialog.open}>
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
                </DeferredPanel>
              ),
            })}
            characters={promptCharacters.characters}
            characterDialog={(dialog) => (
              <DeferredPanel active={dialog.open}>
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
              </DeferredPanel>
            )}
            guidance={
              visibleNotices.find(
                (notice) => notice.blocking && notice.group === "Setup",
              ) ??
              (iterationNotice !== null &&
              iterationNotice.model === values.model
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
            submitting={submitting}
            generateLimitReason={
              generation.atLimit ? generationLimitReason : undefined
            }
            values={values}
            computerId={folder.computerId}
            mediaDirectory={mediaDirectory}
            referenceImages={composerImages}
            referenceLabels={referenceLabels}
            price={price}
          />
        )}
        {/* The host tray has no footer row; its anchor must not add a pane gap. */}
        {activityItem === null ? null : (
          <DeferredPanel active={noticesOpen}>
            <PrintsActivityTray
              notices={visibleNotices}
              uploads={uploadQueueProps}
              open={noticesOpen}
              inset={activityInset}
              onOpenChange={setNoticesOpen}
              onDismiss={dismissed.dismiss}
              onDismissAll={() => {
                dismissed.dismissAll(notices);
              }}
              onLoadMore={generation.hasMore ? generation.loadMore : undefined}
            />
          </DeferredPanel>
        )}
      </div>
      {folder.editing ? (
        <Suspense fallback={null}>
          <PrintsFolderDialog folder={folder} />
        </Suspense>
      ) : null}
    </main>
  );
}
