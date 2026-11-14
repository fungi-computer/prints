import type { StoryDefault } from "@ladle/react";
import { useState } from "react";
import { ComposerShell } from "@fungi.computer/parakeet";
import { Toaster } from "@fungi.computer/caps/components/toaster";
import { AUDIO_TILE_SIZE } from "../src/audio-media.js";
import { AudioReferenceChip } from "../src/audio-reference-chip.js";
import {
  AudioTileFace,
  AudioTilePlay,
  AudioTileScope,
  type AudioTileFacts,
} from "../src/audio-tile.js";
import { AudioViewerStage } from "../src/audio-viewer-stage.js";
import { synthClipUrl } from "./audio-fixtures.js";
import "../src/media.css";
import "./workbench.css";
import "./audio-stories.css";

export default { title: "Prints audio" } satisfies StoryDefault;

const finished: readonly AudioTileFacts[] = [
  { url: synthClipUrl(8, "music", 2), mode: "music" },
  { url: synthClipUrl(11, "speech", 3), mode: "voice" },
];

function AudioWallTile({ facts }: { facts: AudioTileFacts }) {
  return (
    <AudioTileScope url={facts.url}>
      <div
        className="prints-gallery-tile"
        data-media-tile
        style={{
          aspectRatio: `${String(AUDIO_TILE_SIZE.width)} / ${String(AUDIO_TILE_SIZE.height)}`,
        }}
      >
        <button
          className="block h-full w-full overflow-hidden bg-base-200 p-0 text-left"
          data-media-thumb-wrap
          type="button"
        >
          <AudioTileFace url={facts.url} />
        </button>
        <AudioTilePlay title="audio print" />
      </div>
    </AudioTileScope>
  );
}

/** The wall's audio tiles, level with the Library's source badge. */
export const FinishedTiles = () => (
  <div className="prints-study" data-app-pane="media">
    <Toaster id="prints-generation-notices" />
    <div className="prints-audio-story-wall">
      {finished.map((facts) => (
        <AudioWallTile facts={facts} key={facts.url} />
      ))}
    </div>
  </div>
);

/** An audio reference in the attachment tray, beside an image's. */
export function ReferenceChip() {
  const [present, setPresent] = useState(true);
  return (
    <div className="prints-study" data-app-pane="media">
      <Toaster id="prints-generation-notices" />
      <div className="prints-audio-story-spacer" />
      <ComposerShell
        aria-label="Image generation"
        attachments={
          <div className="prints-reference-tray" aria-label="References">
            <div className="prints-reference-tile">
              <div className="prints-reference-face mask mask-squircle prints-audio-story-image" />
              <span className="prints-reference-label">@image1</span>
            </div>
            {present ? (
              <AudioReferenceChip
                durationSeconds={8}
                name="Voice note.wav"
                url={synthClipUrl(8, "speech", 1)}
                onRemove={() => {
                  setPresent(false);
                }}
              />
            ) : null}
          </div>
        }
        input={
          <textarea
            aria-label="Prompt"
            className="caps-composer-input"
            placeholder="What are we making?"
            rows={2}
          />
        }
      />
    </div>
  );
}

/** An audio print in the viewer. */
export const Viewer = () => (
  <div className="prints-study">
    <Toaster id="prints-generation-notices" />
    <div className="prints-audio-story-viewer">
      <AudioViewerStage facts={finished[0]} />
    </div>
  </div>
);
