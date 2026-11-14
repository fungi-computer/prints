import { formatMoney } from "@fungi.computer/caps/lib/format-money";

/** Milliunits of a cent: 100,000 to the dollar. */
const MILLIUNITS_PER_DOLLAR = 100_000;

/**
 * A price in dollars, or null when nothing was charged or recorded: a free
 * generation shows no cost rather than "$0.00". Cents, like every other
 * meter in the app: under a cent reads `<$0.01`, otherwise `$1.16`. The
 * drawer's recorded cost and the composer's estimate share this one rule.
 */
export function formatPrintCost(costMilliunits: number): string | null {
  if (!Number.isFinite(costMilliunits) || costMilliunits <= 0) return null;
  return formatMoney(costMilliunits / MILLIUNITS_PER_DOLLAR);
}
