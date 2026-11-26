import { IconButton } from "@fungi.computer/caps/components/icon-button";
import { Ellipsis } from "lucide-react";
import { forwardRef, type ComponentPropsWithoutRef } from "react";

/** The tile menu's key. The menu's trigger renders it, and so does first paint before the menu code loads. */
export const TileMenuButton = forwardRef<
  HTMLButtonElement,
  Omit<ComponentPropsWithoutRef<"button">, "children" | "title"> & {
    path: string;
  }
>(function TileMenuButton({ path, ...props }, ref) {
  return (
    <IconButton
      {...props}
      ref={ref}
      aria-label={`More actions: ${path}`}
      title="More actions"
      icon={<Ellipsis />}
    />
  );
});
