import { Pause, Play, X } from "lucide-react";
import { IconButton } from "@fungi.computer/caps/components/icon-button";
import { notifyPlaybackFailure } from "./audio-media.js";
import { useAudioPlayback } from "./audio-playback.js";
import { formatDuration } from "./audio-waveform.js";

/**
 * An audio reference in the attachment tray. It is the image reference's
 * squircle at the same size, carrying a play key and, where an image carries
 * its `@image` number, the clip's length, with the same remove key.
 */
export function AudioReferenceChip({
  name,
  url,
  durationSeconds,
  onRemove,
}: {
  /** Filename, shown as the tooltip and in the accessible names. */
  name: string;
  /** Where the clip can be read for playback. */
  url: string;
  durationSeconds: number;
  onRemove: () => void;
}): React.JSX.Element {
  const playback = useAudioPlayback(url, notifyPlaybackFailure);
  return (
    <div className="prints-reference-tile" data-audio-reference title={name}>
      <div className="prints-reference-face prints-audio-face mask mask-squircle">
        <IconButton
          aria-label={`${playback.playing ? "Pause" : "Play"} ${name}`}
          className="prints-audio-face-play"
          icon={playback.playing ? <Pause /> : <Play />}
          iconSize="sm"
          size="sm"
          variant="accent"
          onClick={playback.toggle}
        />
        {playback.progress > 0 ? (
          <span aria-hidden="true" className="prints-audio-face-progress">
            <span style={{ width: `${String(playback.progress * 100)}%` }} />
          </span>
        ) : null}
      </div>
      <span className="prints-reference-label" data-reference-label>
        {formatDuration(durationSeconds)}
      </span>
      <IconButton
        icon={<X />}
        className="prints-reference-remove prints-audio-remove"
        aria-label={`Remove ${name}`}
        onClick={onRemove}
      />
    </div>
  );
}
