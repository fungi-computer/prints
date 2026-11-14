import { useEffect, useState } from "react";
import { reportCatchFailure } from "./log-event.js";

/** Bars drawn for a tile or viewer; the decoded audio is folded into this many peaks. */
export const WAVEFORM_BARS = 64;

/**
 * Seconds as `m:ss`. A clip's length rounds up, so a 7.2s clip reads 0:08;
 * an elapsed time rounds down, so playback never reads ahead of the sound.
 */
export function formatDuration(
  seconds: number,
  rounding: "length" | "elapsed" = "length",
): string {
  const whole = Math.max(
    0,
    rounding === "length" ? Math.ceil(seconds) : Math.floor(seconds),
  );
  const minutes = Math.floor(whole / 60);
  return `${String(minutes)}:${String(whole % 60).padStart(2, "0")}`;
}

/**
 * Fold decoded channels into `bars` peaks in 0..1. Each bar is the loudest
 * sample in its slice across every channel, scaled so the loudest bar is 1.
 * Silence stays 0: nothing here invents shape the audio does not have.
 */
export function waveformPeaks(
  channels: readonly Float32Array[],
  bars: number = WAVEFORM_BARS,
): readonly number[] {
  const length = channels.reduce(
    (most, channel) => Math.max(most, channel.length),
    0,
  );
  if (length === 0 || bars <= 0)
    return Object.freeze(Array.from({ length: Math.max(bars, 0) }, () => 0));
  const peaks = Array.from({ length: bars }, () => 0);
  for (let bar = 0; bar < bars; bar += 1) {
    const start = Math.floor((bar * length) / bars);
    const end = Math.max(start + 1, Math.floor(((bar + 1) * length) / bars));
    let peak = 0;
    for (const channel of channels) {
      const stop = Math.min(end, channel.length);
      for (let at = start; at < stop; at += 1)
        peak = Math.max(peak, Math.abs(channel[at] ?? 0));
    }
    peaks[bar] = peak;
  }
  const loudest = peaks.reduce((most, peak) => Math.max(most, peak), 0);
  return Object.freeze(
    loudest === 0 ? peaks : peaks.map((peak) => peak / loudest),
  );
}

/** What decoding one clip with Web Audio yields. */
export type DecodedWaveform = Readonly<{
  peaks: readonly number[];
  durationSeconds: number;
}>;

/**
 * Decode a clip with the browser's own decoder and fold it into peaks. An
 * `OfflineAudioContext` decodes without opening an output device or waiting
 * for a user gesture. A file the browser cannot decode rejects.
 */
export async function decodeWaveform(
  bytes: ArrayBuffer,
  bars: number = WAVEFORM_BARS,
): Promise<DecodedWaveform> {
  const context = new OfflineAudioContext(1, 1, 44_100);
  const buffer = await context.decodeAudioData(bytes);
  const channels = Array.from(
    { length: buffer.numberOfChannels },
    (_unused, at) => buffer.getChannelData(at),
  );
  return {
    peaks: waveformPeaks(channels, bars),
    durationSeconds: buffer.duration,
  };
}

export type WaveformState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "failed" }>
  | (Readonly<{ status: "ready" }> & DecodedWaveform);

const decoded = new Map<string, Promise<DecodedWaveform>>();

async function readAndDecode(
  url: string,
  bars: number,
): Promise<DecodedWaveform> {
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`audio responded ${String(response.status)}`);
  return decodeWaveform(await response.arrayBuffer(), bars);
}

function decodeOnce(url: string, bars: number): Promise<DecodedWaveform> {
  const key = `${String(bars)}:${url}`;
  const known = decoded.get(key);
  if (known !== undefined) return known;
  const pending = readAndDecode(url, bars).catch((cause: unknown) => {
    // A failed read must not be cached: the clip may be there on the next look.
    decoded.delete(key);
    throw cause;
  });
  decoded.set(key, pending);
  return pending;
}

/** The waveform of the clip at `url`, drawn from its decoded samples. */
export function useWaveform(
  url: string,
  bars: number = WAVEFORM_BARS,
): WaveformState {
  const [state, setState] = useState<WaveformState>({ status: "loading" });
  useEffect(() => {
    if (url === "") {
      setState({ status: "failed" });
      return;
    }
    let current = true;
    setState({ status: "loading" });
    decodeOnce(url, bars).then(
      (waveform) => {
        if (current) setState({ status: "ready", ...waveform });
      },
      (cause: unknown) => {
        reportCatchFailure("decode-audio-waveform", cause);
        if (current) setState({ status: "failed" });
      },
    );
    return () => {
      current = false;
    };
  }, [url, bars]);
  return state;
}
