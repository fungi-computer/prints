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
