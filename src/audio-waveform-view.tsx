import { cn } from "@fungi.computer/caps/lib/cn";
import { useWaveform, WAVEFORM_BARS } from "./audio-waveform.js";

/**
 * Bars for the decoded clip at `url`. While it decodes, or if it cannot be
 * decoded, a flat baseline holds the space: no shape is ever drawn that the
 * audio does not have. Bars before `progress` take the accent.
 */
export function AudioWaveformView({
  url,
  progress = 0,
  bars = WAVEFORM_BARS,
  className,
}: {
  url: string;
  progress?: number;
  bars?: number;
  className?: string;
}): React.JSX.Element {
  const waveform = useWaveform(url, bars);
  const peaks = waveform.status === "ready" ? waveform.peaks : null;
  return (
    <span
      aria-hidden="true"
      className={cn("prints-waveform", className)}
      data-waveform={waveform.status}
    >
      {Array.from({ length: bars }, (_unused, at) => (
        <span
          className="prints-waveform-bar"
          data-played={at / bars < progress ? "" : undefined}
          key={at}
          style={{ height: `max(2px, ${String((peaks?.[at] ?? 0) * 100)}%)` }}
        />
      ))}
    </span>
  );
}
