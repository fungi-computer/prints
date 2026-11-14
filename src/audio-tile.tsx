import { createContext, useContext } from "react";
import { Pause, Play } from "lucide-react";
import { IconButton } from "@fungi.computer/caps/components/icon-button";
import type { AudioMode } from "./audio-composer-mode.js";
import { notifyPlaybackFailure } from "./audio-media.js";
import { useAudioPlayback, type AudioPlayback } from "./audio-playback.js";
import { AudioWaveformView } from "./audio-waveform-view.js";

/** Facts the viewer shows about a finished audio print. */
export type AudioTileFacts = Readonly<{
  url: string;
  /** Voice or Music when known; the viewer says "Audio" otherwise. */
  mode?: AudioMode | undefined;
  /** Known length; the decoded clip's own length is used when absent. */
  durationSeconds?: number | undefined;
}>;

const PlaybackContext = createContext<AudioPlayback | null>(null);

function useTilePlayback(): AudioPlayback {
  const playback = useContext(PlaybackContext);
  if (playback === null)
    throw new Error("An audio tile part must sit inside an AudioTileScope");
  return playback;
}

/**
 * One playback shared by a tile's face and its play key. The face sits inside
 * the tile's opener and the key beside it, since a button cannot hold one.
 */
export function AudioTileScope({
  url,
  children,
}: {
  url: string;
  children: React.ReactNode;
}): React.JSX.Element {
  const playback = useAudioPlayback(url, notifyPlaybackFailure);
  return (
    <PlaybackContext.Provider value={playback}>
      {children}
    </PlaybackContext.Provider>
  );
}

/**
 * The tile's face: its waveform. Type and length belong to the wall's source
 * badge below it. The face holds no controls; the play key is
 * `AudioTilePlay`, laid beside the waveform's start.
 */
export function AudioTileFace({ url }: { url: string }): React.JSX.Element {
  const { progress } = useTilePlayback();
  return (
    <span className="prints-audio-tile">
      <AudioWaveformView progress={progress} url={url} />
    </span>
  );
}

/** The tile's play key, laid over the face at the waveform's start. */
export function AudioTilePlay({ title }: { title: string }): React.JSX.Element {
  const playback = useTilePlayback();
  return (
    <IconButton
      aria-label={`${playback.playing ? "Pause" : "Play"} ${title}`}
      className="prints-audio-tile-play"
      icon={playback.playing ? <Pause /> : <Play />}
      iconSize="sm"
      size="sm"
      variant="accent"
      onClick={playback.toggle}
    />
  );
}
