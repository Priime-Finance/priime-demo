/**
 * The scoped shelf count, computed once from the kit's own totals.
 *
 * `lib/demo-scope.ts` owns the sentence and is a leaf, so it cannot read the
 * module definitions; this file hands it the two totals it needs. Bay 02 and
 * the dock head both print this string (`shelfCountLabel`, GhostSlot.tsx).
 */

import { shelfCountScoped } from "@/lib/demo-scope";

import { STRATEGIES } from "./graph-ops";
import { DISPLAY_ORDER } from "./modules";

/** `1 source, 2 modules, 1 strategy · 10 coming soon`, never typed. */
export const SHELF_COUNT_SCOPED = shelfCountScoped(DISPLAY_ORDER.length, STRATEGIES.length);
