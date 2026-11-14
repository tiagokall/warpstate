/** Production stand-in for `@warpstate/react`, swapped in by `@warpstate/vite`. */
import type * as Real from "./index";

export type * from "./index";

const inert: Real.WarpContextValue = {
  status: "idle",
  isWarping: false,
  snapshot: null,
  error: undefined,
  capture: () => {
    throw new Error("[warpstate] capture is not available in production builds.");
  },
  download: () => {
    throw new Error("[warpstate] download is not available in production builds.");
  },
  copy: async () => false,
  load: async () => undefined,
};

export const WarpProvider: typeof Real.WarpProvider = ({ children }) => <>{children}</>;
export const useWarp: typeof Real.useWarp = () => inert;
