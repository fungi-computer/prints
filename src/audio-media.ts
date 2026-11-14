import { toast } from "@fungi.computer/caps/components/toaster";

/** Prints saves audio only as MP3; gallery decoding, tiles and the viewer share this test. */
export function isAudioPath(path: string): boolean {
  return /\.mp3$/iu.test(path);
}

/** Shape an audio print takes in the wall, which lays tiles out by width and height. */
export const AUDIO_TILE_SIZE = Object.freeze({ width: 4, height: 3 });

const PRINTS_NOTICES = "prints-generation-notices";

/** One playback-failure surface: a toast on the Prints notices Toaster, never inline text. */
export function notifyPlaybackFailure(message: string): void {
  toast.error(message, {
    id: "prints-playback-error",
    toasterId: PRINTS_NOTICES,
  });
}
