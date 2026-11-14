import { captureSnapshot, initWarp } from "@warpstate/core";

export const snapshot = initWarp();
export const capture = captureSnapshot;
