/**
 * Proves the backend<->frontend seam: the typed `Journal` from
 * @priime-demo/journal-schema, populated with the two frozen samples in
 * schema/samples/. Imported from the repo-root schema/ dir (via the
 * `@schema/*` tsconfig alias) so schema/ stays the single source of truth
 * — no copy of the sample JSON lives in this app.
 */
import type { Journal } from "@priime-demo/journal-schema";

import strikeSettledRaw from "@schema/samples/strike-settled.json";
import strikeSabotageRaw from "@schema/samples/strike-sabotage.json";

export type { Journal };

export const strikeSettled = strikeSettledRaw as Journal;
export const strikeSabotage = strikeSabotageRaw as Journal;
