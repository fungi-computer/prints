import type { MediaMasonryItem } from "./media-masonry.js";

/** Session-local display reservations, not another transfer/job lifecycle. */
export type GallerySlot = {
  key: string;
  path: string;
  computerId: string;
  width: number;
  height: number;
  previewFile?: File;
  resolved?: boolean;
  uploadId?: string;
  error?: string;
};

/** Preserve admission order and replace a reservation with its decoded file. */
export function galleryWithSlots(
  ready: MediaMasonryItem[],
  slots: GallerySlot[],
  pending: (slot: GallerySlot) => MediaMasonryItem,
): MediaMasonryItem[] {
  const byKey = new Map(ready.map((item) => [item.key, item]));
  const reserved = new Set(slots.map((slot) => slot.key));
  return [
    ...slots
      .filter((slot) => !slot.resolved || byKey.has(slot.key))
      .map((slot) => {
        const image = byKey.get(slot.key);
        return image && slot.resolved ? image : pending(slot);
      }),
    ...ready.filter((item) => !reserved.has(item.key)),
  ];
}
