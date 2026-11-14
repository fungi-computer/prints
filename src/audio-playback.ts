import { useCallback, useEffect, useRef, useState } from "react";
import { reportCatchFailure } from "./log-event.js";

/** Only one clip sounds at a time: starting another stops the one playing. */
let sounding: HTMLAudioElement | null = null;

/** Playback of the clip at `url`; `progress` runs 0..1 while it plays. */
export type AudioPlayback = Readonly<{
  playing: boolean;
  progress: number;
  toggle: () => void;
  /** Jump to a fraction of the clip, 0..1. */
  seek: (fraction: number) => void;
}>;

/**
 * Play, pause and seek one clip with a native audio element. `onFailure`
 * receives the reason a clip would not play (a blocked or unreadable file),
 * so the owner can raise one toast rather than leave a dead button.
 */
export function useAudioPlayback(
  url: string,
  onFailure: (message: string) => void,
): AudioPlayback {
  const element = useRef<HTMLAudioElement | null>(null);
  const failure = useRef(onFailure);
  failure.current = onFailure;
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(
    () => () => {
      const audio = element.current;
      if (audio === null) return;
      audio.pause();
      if (sounding === audio) sounding = null;
      element.current = null;
    },
    [url],
  );

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      const audio = element.current;
      if (audio !== null && audio.duration > 0)
        setProgress(Math.min(1, audio.currentTime / audio.duration));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [playing]);

  const audioFor = useCallback(() => {
    if (element.current !== null) return element.current;
    const audio = new Audio(url);
    audio.preload = "auto";
    audio.addEventListener("ended", () => {
      setPlaying(false);
      setProgress(0);
      if (sounding === audio) sounding = null;
    });
    audio.addEventListener("pause", () => {
      setPlaying(false);
    });
    audio.addEventListener("error", () => {
      setPlaying(false);
      failure.current("This audio could not be played.");
    });
    element.current = audio;
    return audio;
  }, [url]);

  const toggle = useCallback(() => {
    const audio = audioFor();
    if (!audio.paused) {
      audio.pause();
      return;
    }
    if (sounding !== null && sounding !== audio) sounding.pause();
    sounding = audio;
    setPlaying(true);
    audio.play().catch((cause: unknown) => {
      reportCatchFailure("play-audio", cause);
      setPlaying(false);
      failure.current("This audio could not be played.");
    });
  }, [audioFor]);

  const seek = useCallback(
    (fraction: number) => {
      const audio = audioFor();
      const known = Number.isFinite(audio.duration) && audio.duration > 0;
      if (!known) return;
      audio.currentTime = Math.min(1, Math.max(0, fraction)) * audio.duration;
      setProgress(Math.min(1, Math.max(0, fraction)));
    },
    [audioFor],
  );

  return { playing, progress, toggle, seek };
}
