/** Browser-selected files remain local. The gallery never uploads their bytes. */
export type LocalImage = {
  file: File;
  url: string;
  width: number;
  height: number;
};

/** Prints saves video only as MP4; gallery decoding and tiles share this test. */
export function isVideoPath(path: string): boolean {
  return /\.mp4$/iu.test(path);
}

/** Intrinsic size of a print: images decode, MP4s report their metadata. */
export async function decodeLocalMedia(
  file: File,
  url: string,
): Promise<LocalImage> {
  if (isVideoPath(file.name)) {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    await new Promise<void>((resolve, reject) => {
      video.addEventListener(
        "loadedmetadata",
        () => {
          resolve();
        },
        { once: true },
      );
      video.addEventListener(
        "error",
        () => {
          reject(new Error("MP4 metadata could not be read"));
        },
        { once: true },
      );
      video.src = url;
    });
    return { file, url, width: video.videoWidth, height: video.videoHeight };
  }
  const image = new Image();
  image.src = url;
  await image.decode();
  return { file, url, width: image.naturalWidth, height: image.naturalHeight };
}
