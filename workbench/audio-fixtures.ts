const clips = new Map<string, string>();

/** A clip's object URL, made once per kind of clip. */
export function synthClipUrl(
  seconds: number,
  style: "speech" | "music",
  seed = 1,
): string {
  const key = `${style}:${String(seconds)}:${String(seed)}`;
  const known = clips.get(key);
  if (known !== undefined) return known;
  const url = URL.createObjectURL(synthClipBlob(seconds, style, seed));
  clips.set(key, url);
  return url;
}

/**
 * A real WAV, synthesised in the browser, so a waveform in a story or fixture
 * is the decoded samples of an actual file. `speech` is syllable-like bursts;
 * `music` is a slow chord with a swelling envelope. The browser decodes by
 * content, so a fixture may save these bytes under an `.mp3` name.
 */
export function synthClipBlob(
  seconds: number,
  style: "speech" | "music",
  seed = 1,
): Blob {
  const rate = 16_000;
  const frames = Math.round(seconds * rate);
  const samples = new Int16Array(frames);
  for (let at = 0; at < frames; at += 1) {
    const t = at / rate;
    let value: number;
    if (style === "speech") {
      const syllable = Math.max(0, Math.sin(t * (5.2 + seed * 0.7) * Math.PI));
      const phrase = 0.55 + 0.45 * Math.sin(t * 0.9 * seed + seed);
      value = syllable * phrase * Math.sin(2 * Math.PI * (140 + 30 * seed) * t);
    } else {
      const swell = Math.sin((t / seconds) * Math.PI) ** 0.6;
      const pulse =
        0.65 + 0.35 * Math.sin(2 * Math.PI * (0.5 + seed * 0.13) * t);
      value =
        (swell *
          pulse *
          (Math.sin(2 * Math.PI * 261.6 * t) +
            Math.sin(2 * Math.PI * 329.6 * t) +
            Math.sin(2 * Math.PI * 392 * t))) /
        3;
    }
    samples[at] = Math.round(value * 0.8 * 32_767);
  }
  const bytes = new ArrayBuffer(44 + samples.byteLength);
  const view = new DataView(bytes);
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1)
      view.setUint8(offset + i, value.charCodeAt(i));
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + samples.byteLength, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples.byteLength, true);
  new Int16Array(bytes, 44).set(samples);
  return new Blob([bytes], { type: "audio/wav" });
}
