import { useState } from "react";
import { ChevronDown, Clock, Mic } from "lucide-react";
import { cn } from "@fungi.computer/caps/lib/cn";
import { KeycapButton } from "@fungi.computer/caps/components/keycap";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@fungi.computer/caps/components/dropdown-menu";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@fungi.computer/caps/components/tabs";
import { modelName } from "./generation-model.js";
import { menuContainerFor } from "./menu-container.js";
import { formatDuration } from "./audio-waveform.js";

/** The three things the audio composer makes. */
export type AudioMode = "voice" | "sfx" | "music";

/**
 * The slice of Darkroom's `MediaAudioModel` the composer reads. The catalog's
 * own value satisfies it, so the host passes that through unchanged.
 */
export type AudioCapability = Readonly<{
  mode: "speech" | "music";
  voices: readonly Readonly<{ id: string; label: string }>[];
  defaultVoiceId: string | null;
  seconds: Readonly<{ min: number; max: number; default: number }> | null;
}>;

/** An audio model as the composer needs it: identity plus its audio facts. */
export type AudioModelOption = Readonly<{
  id: string;
  label: string;
  audio: AudioCapability;
}>;

/** What each mode is called on its segment. */
export const AUDIO_MODE_LABELS = {
  voice: "Voice",
  sfx: "Sound effects",
  music: "Music",
} as const satisfies Record<AudioMode, string>;

/**
 * The mode a model serves. Speech is Voice and music is Music; Darkroom's
 * catalog has no sound-effects model, so Sound effects appears only when one does.
 */
export function audioModeOf(model: AudioModelOption): AudioMode {
  return model.audio.mode === "speech" ? "voice" : "music";
}

/** Audio models from a host catalog, as the composer reads them; rows without audio facts are skipped. */
export function audioOptionsOf(
  models: readonly Readonly<{
    id: string;
    label: string;
    audio: AudioCapability | null;
  }>[],
): readonly AudioModelOption[] {
  return models.flatMap((model) =>
    model.audio === null
      ? []
      : [{ id: model.id, label: model.label, audio: model.audio }],
  );
}

/** The mode of a catalog model, or null for a picture or video model. */
export function audioModeOfModel(
  model: Readonly<{ audio: AudioCapability | null }>,
): AudioMode | null {
  return model.audio === null
    ? null
    : model.audio.mode === "speech"
      ? "voice"
      : "music";
}

/** Modes the catalog can serve, in the order the control shows them. */
export function availableAudioModes(
  models: readonly AudioModelOption[],
): readonly AudioMode[] {
  const served = new Set(models.map(audioModeOf));
  return (["voice", "sfx", "music"] as const).filter((mode) =>
    served.has(mode),
  );
}

/** Models serving one mode. */
export function modelsForAudioMode(
  models: readonly AudioModelOption[],
  mode: AudioMode,
): readonly AudioModelOption[] {
  return models.filter((model) => audioModeOf(model) === mode);
}

/** Voice, Sound effects and Music as one Caps segmented control for the composer row. */
export function AudioModeControl({
  modes,
  value,
  onChange,
  disabled = false,
}: {
  modes: readonly AudioMode[];
  value: AudioMode;
  onChange: (mode: AudioMode) => void;
  disabled?: boolean;
}): React.JSX.Element {
  return (
    <Tabs
      className="prints-audio-modes"
      value={value}
      onValueChange={(next) => {
        const mode = modes.find((candidate) => candidate === next);
        if (mode !== undefined) onChange(mode);
      }}
    >
      <TabsList
        aria-label="Audio type"
        className="prints-audio-modes-list"
        variant="segmented"
      >
        {modes.map((mode) => (
          <TabsTrigger
            data-audio-mode={mode}
            disabled={disabled}
            key={mode}
            value={mode}
          >
            {AUDIO_MODE_LABELS[mode]}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

/** A single-choice Caps menu on a composer key; the shape both pickers share. */
function ChoiceKey<Value extends string | number>({
  label,
  name,
  options,
  value,
  disabled,
  onChange,
  icon,
  compact = false,
}: {
  label: string;
  /** Accessible name of the key, and of its menu. */
  name: string;
  options: readonly Readonly<{ value: Value; label: string }>[];
  value: Value;
  disabled: boolean;
  onChange: (value: Value) => void;
  icon?: React.ReactNode;
  /** In a narrow composer the key keeps its icon and chevron and drops its label. */
  compact?: boolean;
}): React.JSX.Element {
  const [scope, setScope] = useState<HTMLSpanElement | null>(null);
  return (
    <span className="contents" ref={setScope}>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={name}
          disabled={disabled || options.length === 0}
          render={(props, state) => (
            <KeycapButton
              {...props}
              className={cn(
                "parakeet-composer-model-key",
                compact && "prints-audio-key-compact",
              )}
              expanded={state.open}
              icon={icon}
              label={label}
              readout={
                <ChevronDown
                  aria-hidden="true"
                  className="size-[var(--stipe-icon-size-sm)] shrink-0"
                />
              }
            />
          )}
        />
        <DropdownMenuContent
          align="start"
          aria-label={name}
          container={menuContainerFor(scope)}
          side="top"
        >
          {options.map((option) => (
            <DropdownMenuCheckboxItem
              checked={option.value === value}
              closeOnClick
              key={String(option.value)}
              onSelect={() => {
                onChange(option.value);
              }}
            >
              {option.label}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}

/** Which model of the mode makes the print, as a Caps menu in the composer row. */
export function AudioModelMenu({
  models,
  value,
  onChange,
  disabled = false,
}: {
  models: readonly AudioModelOption[];
  value: string;
  onChange: (modelId: string) => void;
  disabled?: boolean;
}): React.JSX.Element {
  const selected = models.find((model) => model.id === value);
  return (
    <ChoiceKey
      disabled={disabled}
      label={selected === undefined ? "Model" : modelName(selected)}
      name="Generation model"
      onChange={onChange}
      options={models.map((model) => ({ value: model.id, label: model.label }))}
      value={value}
    />
  );
}

/** The voice that reads a Voice print aloud, as a Caps menu in the composer row. */
export function AudioVoiceMenu({
  voices,
  value,
  onChange,
  disabled = false,
}: {
  voices: AudioCapability["voices"];
  value: string;
  onChange: (voiceId: string) => void;
  disabled?: boolean;
}): React.JSX.Element {
  const selected = voices.find((voice) => voice.id === value);
  return (
    <ChoiceKey
      disabled={disabled}
      compact
      icon={<Mic />}
      label={selected?.label ?? "Voice"}
      name="Voice"
      onChange={onChange}
      options={voices.map((voice) => ({ value: voice.id, label: voice.label }))}
      value={value}
    />
  );
}

/** Lengths offered for Music, trimmed to what the model accepts. */
const LENGTH_PRESETS = [10, 15, 30, 60, 90, 120, 180, 300, 600] as const;

/** Preset lengths inside the model's range, always including its default. */
export function audioLengthChoices(
  seconds: NonNullable<AudioCapability["seconds"]>,
): readonly number[] {
  const inside = LENGTH_PRESETS.filter(
    (length) => length >= seconds.min && length <= seconds.max,
  );
  return [...new Set([...inside, seconds.default])].sort((a, b) => a - b);
}

/** How long a Music print runs, as a Caps menu in the composer row. */
export function AudioLengthMenu({
  seconds,
  value,
  onChange,
  disabled = false,
}: {
  seconds: NonNullable<AudioCapability["seconds"]>;
  value: number;
  onChange: (seconds: number) => void;
  disabled?: boolean;
}): React.JSX.Element {
  return (
    <ChoiceKey
      disabled={disabled}
      compact
      icon={<Clock />}
      label={formatDuration(value)}
      name="Length"
      onChange={onChange}
      options={audioLengthChoices(seconds).map((length) => ({
        value: length,
        label: formatDuration(length),
      }))}
      value={value}
    />
  );
}
