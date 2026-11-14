import { Pause, Play } from "lucide-react";
import { Badge } from "@fungi.computer/caps/components/badge";
import { IconButton } from "@fungi.computer/caps/components/icon-button";
import { AUDIO_MODE_LABELS } from "./audio-composer-mode.js";
import { useAudioPlayback } from "./audio-playback.js";
import { notifyPlaybackFailure } from "./audio-media.js";
import { formatDuration, useWaveform } from "./audio-waveform.js";
import { AudioWaveformView } from "./audio-waveform-view.js";
import type { AudioTileFacts } from "./audio-tile.js";

/**
 * An audio print in the viewer: its waveform at full width, a play key, the
 * time and length, and a seek by pressing the waveform.
 */
export function AudioViewerStage({
  facts,
}: {
  facts: AudioTileFacts;
}): React.JSX.Element {
  const playback = useAudioPlayback(facts.url, notifyPlaybackFailure);
  const waveform = useWaveform(facts.url, 96);
  const length =
    facts.durationSeconds ??
    (waveform.status === "ready" ? waveform.durationSeconds : undefined);
  const modeLabel =
    facts.mode === undefined ? "Audio" : AUDIO_MODE_LABELS[facts.mode];
  const elapsed = playback.progress * (length ?? 0);
  return (
    <section
      aria-label={`${modeLabel} print`}
      className="prints-audio-stage"
      data-audio-stage
    >
      <Badge size="sm" variant="quiet">
        {modeLabel}
      </Badge>
      <button
        aria-label="Seek"
        className="prints-audio-stage-seek"
        type="button"
        onClick={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          playback.seek((event.clientX - box.left) / box.width);
        }}
      >
        <AudioWaveformView
          bars={96}
          className="prints-audio-stage-waveform"
          progress={playback.progress}
          url={facts.url}
        />
      </button>
      <div className="prints-audio-stage-controls">
        <IconButton
          aria-label={playback.playing ? "Pause" : "Play"}
          icon={playback.playing ? <Pause /> : <Play />}
          iconSize="md"
          size="default"
          variant="accent"
          onClick={playback.toggle}
        />
        <span className="prints-audio-stage-time">
          {formatDuration(elapsed, "elapsed")}
          {length === undefined ? null : ` / ${formatDuration(length)}`}
        </span>
      </div>
    </section>
  );
}
