/** Production stand-in for `@warpstate/webmcp`, swapped in by `@warpstate/vite`. */
import type * as Real from "./index";

export type * from "./index";

export const registerWarpTools: typeof Real.registerWarpTools = () => () => undefined;
export const getModelContext: typeof Real.getModelContext = () => undefined;
