/** Production stand-in for `@warpstate/zustand`, swapped in by `@warpstate/vite`. */
import type * as Real from "./index";

export type * from "./index";

export const zustandAdapter: typeof Real.zustandAdapter = (name) => ({
  name,
  capture: () => undefined as never,
  restore: () => undefined,
});
