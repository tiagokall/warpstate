import {
  captureSnapshotWithReport,
  copySnapshot,
  downloadSnapshot,
  encodeSnapshot,
  getActiveSnapshot,
  getWarpGlobal,
  initWarp,
  isProductionEnv,
  loadSnapshot,
  matchesShortcut,
  parseShortcut,
  serializeSnapshot,
  type WarpSnapshot,
  type WarpStatus,
} from "@warpstate/core";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

export type CopyFormat = "json" | "compact";

export interface WarpContextValue {
  /** Hydration status of the current page. */
  status: WarpStatus;
  /** True when the page booted from a snapshot. */
  isWarping: boolean;
  /** The snapshot the page booted from, if any. */
  snapshot: WarpSnapshot | null;
  /** Error message when the snapshot was rejected. */
  error: string | undefined;
  /** Captures the current state. */
  capture: (meta?: WarpSnapshot["meta"]) => WarpSnapshot;
  /** Captures and downloads a `.warp.json` file. */
  download: (meta?: WarpSnapshot["meta"]) => WarpSnapshot;
  /** Captures and copies to the clipboard (pretty JSON or the compact `warp1.` form). */
  copy: (meta?: WarpSnapshot["meta"], format?: CopyFormat) => Promise<boolean>;
  /** Loads a snapshot (object, JSON or compact string) and reloads the page into it. */
  load: (input: unknown) => Promise<void>;
}

export interface WarpProviderProps {
  children?: ReactNode;
  /** Keyboard shortcut that captures a snapshot. `false` disables it. Default: `"ctrl+shift+s"`. */
  shortcut?: string | false;
  /** Download a `.warp.json` file on capture. Default: `true`. */
  download?: boolean;
  /** Copy the snapshot to the clipboard on capture. Default: `"json"`. */
  copy?: CopyFormat | false;
  /** Ask for a scenario name before capturing. Default: `false`. */
  promptForName?: boolean;
  /** Show a small floating capture button and status badge. Default: `false`. */
  overlay?: boolean;
  /** Called after every shortcut/overlay capture. */
  onCapture?: (snapshot: WarpSnapshot, warnings: string[]) => void;
}

const WarpContext = createContext<WarpContextValue | null>(null);

function useWarpStatus(): Pick<WarpContextValue, "status" | "error"> {
  const [state, setState] = useState(() => {
    const global = getWarpGlobal();
    return { status: global?.status ?? "idle", error: global?.error?.message };
  });
  useEffect(() => {
    const global = getWarpGlobal();
    if (!global) return;
    let active = true;
    const sync = () => {
      if (active) setState({ status: global.status, error: global.error?.message });
    };
    sync();
    global.ready.then(sync, sync);
    return () => {
      active = false;
    };
  }, []);
  return state;
}

/**
 * Provides `useWarp()` and installs the capture shortcut (development only).
 * Place it anywhere above the parts of the app that call `useWarp()`.
 */
export function WarpProvider({
  children,
  shortcut = "ctrl+shift+s",
  download: shouldDownload = true,
  copy: copyFormat = "json",
  promptForName = false,
  overlay = false,
  onCapture,
}: WarpProviderProps) {
  const enabled = !isProductionEnv();
  const { status, error } = useWarpStatus();
  const [snapshot] = useState(() => {
    initWarp();
    return getActiveSnapshot();
  });
  const [flash, setFlash] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const capture = useCallback((meta?: WarpSnapshot["meta"]) => captureSnapshotWithReport(meta).snapshot, []);

  const download = useCallback(
    (meta?: WarpSnapshot["meta"]) => {
      const captured = capture(meta);
      downloadSnapshot(captured);
      return captured;
    },
    [capture],
  );

  const copy = useCallback(
    async (meta?: WarpSnapshot["meta"], format: CopyFormat = "json") => {
      const captured = capture(meta);
      if (format === "json") return copySnapshot(captured);
      try {
        await navigator.clipboard.writeText(await encodeSnapshot(captured));
        return true;
      } catch {
        return false;
      }
    },
    [capture],
  );

  const load = useCallback(async (input: unknown) => {
    await loadSnapshot(input);
  }, []);

  const runCapture = useCallback(async () => {
    let name: string | undefined;
    if (promptForName) {
      const answer = window.prompt("Scenario name");
      if (answer === null) return;
      name = answer.trim() || undefined;
    }
    const { snapshot: captured, warnings } = captureSnapshotWithReport(name ? { name } : undefined);
    if (warnings.length) {
      console.warn(`[warpstate] Non-serializable values in snapshot:\n${warnings.map((w) => `  - ${w}`).join("\n")}`);
    }
    if (shouldDownload) downloadSnapshot(captured);
    let copied = false;
    if (copyFormat === "json") copied = await copySnapshot(captured);
    else if (copyFormat === "compact") {
      try {
        await navigator.clipboard.writeText(await encodeSnapshot(captured));
        copied = true;
      } catch {
        copied = false;
      }
    }
    const size = serializeSnapshot(captured).length;
    console.info(
      `[warpstate] Captured "${captured.meta?.name ?? captured.router.entries[captured.router.index]}" ` +
        `(${(size / 1024).toFixed(1)} KB)${copied ? ", copied to clipboard" : ""}.`,
    );
    onCapture?.(captured, warnings);
    setFlash(copied ? "Snapshot captured & copied" : "Snapshot captured");
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 2000);
  }, [copyFormat, onCapture, promptForName, shouldDownload]);

  useEffect(() => {
    if (!enabled || shortcut === false) return;
    const parsed = parseShortcut(shortcut);
    const onKeyDown = (event: KeyboardEvent) => {
      if (!matchesShortcut(event, parsed)) return;
      event.preventDefault();
      void runCapture();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [enabled, shortcut, runCapture]);

  useEffect(() => () => clearTimeout(flashTimer.current), []);

  const value = useMemo<WarpContextValue>(
    () => ({ status, error, isWarping: snapshot !== null, snapshot, capture, download, copy, load }),
    [status, error, snapshot, capture, download, copy, load],
  );

  return (
    <WarpContext.Provider value={value}>
      {children}
      {enabled && overlay ? (
        <WarpOverlay status={status} snapshot={snapshot} error={error} flash={flash} onCapture={runCapture} />
      ) : null}
    </WarpContext.Provider>
  );
}

/** Access warpstate from components. Must be used under `<WarpProvider>`. */
export function useWarp(): WarpContextValue {
  const value = useContext(WarpContext);
  if (!value) throw new Error("useWarp() must be used inside <WarpProvider>.");
  return value;
}

const overlayStyle: CSSProperties = {
  position: "fixed",
  right: 12,
  bottom: 12,
  zIndex: 2147483647,
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "6px 10px",
  borderRadius: 8,
  background: "rgba(17, 17, 17, 0.88)",
  color: "#fafafa",
  font: "12px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace",
  boxShadow: "0 2px 8px rgba(0,0,0,.25)",
};

const buttonStyle: CSSProperties = {
  all: "unset",
  cursor: "pointer",
  padding: "2px 8px",
  borderRadius: 6,
  background: "#fafafa",
  color: "#111",
};

function WarpOverlay(props: {
  status: WarpStatus;
  snapshot: WarpSnapshot | null;
  error: string | undefined;
  flash: string | null;
  onCapture: () => void;
}) {
  const label =
    props.flash ??
    (props.status === "error"
      ? `warp error: ${props.error ?? "unknown"}`
      : props.snapshot
        ? `warped: ${props.snapshot.meta?.name ?? "snapshot"} (${props.status})`
        : "warpstate");
  return (
    <div style={overlayStyle} data-warpstate-overlay="" role="status" aria-live="polite">
      <span title={props.error}>{label}</span>
      <button type="button" style={buttonStyle} onClick={props.onCapture} title="Capture snapshot (Ctrl+Shift+S)">
        capture
      </button>
    </div>
  );
}
