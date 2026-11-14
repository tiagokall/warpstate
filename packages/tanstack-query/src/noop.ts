/** Production stand-in for `@warpstate/tanstack-query`, swapped in by `@warpstate/vite`. */
import type * as Real from "./index";

export type * from "./index";

export const queryAdapter: typeof Real.queryAdapter = () => ({
  name: "query",
  capture: () => ({ queries: [] }),
  restore: () => undefined,
});
