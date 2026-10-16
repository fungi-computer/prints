import { statusText, type AppStatusItem } from "@fungi.computer/agar";

/** The Prints library key opens its folder dialog; the title names the real path. */
export function folderStatusItem(
  path: string | null,
  state: Readonly<{ checking: boolean; editing: boolean }>,
): AppStatusItem {
  return {
    kind: "button",
    id: "folder",
    text: state.checking ? "Checking…" : "prints",
    icon: "folder",
    title:
      path === null
        ? "Choose where Prints saves images"
        : statusText(`Save prints to ${path}`, 1_024),
    opens: "dialog",
    expanded: state.editing,
  };
}
