/**
 * Where a composer menu is portalled: the Prints pane, which already contains
 * its overlays (`contain: layout`). The composer dock scrolls and caps its
 * height, and a menu inside it would be clipped to what the dock leaves.
 */
export function menuContainerFor(
  scope: HTMLElement | null,
): HTMLElement | null {
  return scope?.closest<HTMLElement>('[data-app-pane="media"]') ?? scope;
}
