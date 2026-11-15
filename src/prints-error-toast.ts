import { toast } from "@fungi.computer/caps/components/toaster";

/**
 * Say why an action failed as one toast in Prints' own Toaster, so the failure
 * never takes layout room from the control that caused it. A repeated `id`
 * replaces its earlier toast instead of stacking.
 */
export function notifyPrintsError(message: string, id: string): void {
  toast.error(message, { id, toasterId: "prints-generation-notices" });
}
