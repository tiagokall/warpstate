import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { getWarpGlobal, markWarpReady, registerAdapter, resetWarp, type WarpSnapshot } from "@warpstate/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WarpProvider, useWarp } from "../src";
import * as noop from "../src/noop";
import * as real from "../src";

let clipboard: string | undefined;

beforeEach(() => {
  resetWarp();
  clipboard = undefined;
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: async (text: string) => void (clipboard = text) },
  });
  URL.createObjectURL = vi.fn(() => "blob:fake");
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const pressShortcut = () =>
  act(async () => {
    fireEvent.keyDown(window, { key: "S", code: "KeyS", ctrlKey: true, shiftKey: true });
    await new Promise((r) => setTimeout(r, 0));
  });

describe("WarpProvider", () => {
  it("captures on Ctrl+Shift+S: downloads and copies JSON", async () => {
    registerAdapter({ name: "cart", capture: () => ({ items: 3 }), restore: () => {} });
    const onCapture = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(<WarpProvider onCapture={onCapture}>app</WarpProvider>);
    await pressShortcut();
    expect(onCapture).toHaveBeenCalledTimes(1);
    const snapshot = onCapture.mock.calls[0]![0] as WarpSnapshot;
    expect(snapshot.stores).toEqual({ cart: { items: 3 } });
    expect(click).toHaveBeenCalledTimes(1);
    expect(JSON.parse(clipboard!)).toEqual(snapshot);
  });

  it("can copy the compact form and skip the download", async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(<WarpProvider download={false} copy="compact">app</WarpProvider>);
    await pressShortcut();
    await waitFor(() => expect(clipboard).toMatch(/^warp1\./));
    expect(click).not.toHaveBeenCalled();
  });

  it("supports a custom shortcut and disabling it", async () => {
    const onCapture = vi.fn();
    const { unmount } = render(<WarpProvider shortcut={false} onCapture={onCapture} download={false} />);
    await pressShortcut();
    expect(onCapture).not.toHaveBeenCalled();
    unmount();
    render(<WarpProvider shortcut="alt+k" onCapture={onCapture} download={false} />);
    await act(async () => {
      fireEvent.keyDown(window, { key: "k", code: "KeyK", altKey: true });
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(onCapture).toHaveBeenCalledTimes(1);
  });

  it("uses the prompted scenario name", async () => {
    vi.spyOn(window, "prompt").mockReturnValue("Empty cart");
    const onCapture = vi.fn();
    render(<WarpProvider promptForName onCapture={onCapture} download={false} />);
    await pressShortcut();
    expect((onCapture.mock.calls[0]![0] as WarpSnapshot).meta?.name).toBe("Empty cart");
  });

  it("exposes hydration status through useWarp", async () => {
    window.__WARPSTATE__ = {
      snapshot: { warpstate: 1, meta: { name: "promo" }, router: { entries: ["/"], index: 0 } },
    } as never;
    function Status() {
      const warp = useWarp();
      return <p>{`${warp.status}:${warp.isWarping}:${warp.snapshot?.meta?.name}`}</p>;
    }
    render(
      <WarpProvider overlay>
        <Status />
      </WarpProvider>,
    );
    expect(screen.getByText("hydrating:true:promo")).toBeTruthy();
    await act(async () => {
      await markWarpReady();
      await getWarpGlobal()!.ready;
    });
    expect(screen.getByText("ready:true:promo")).toBeTruthy();
    expect(screen.getByText("warped: promo (ready)")).toBeTruthy();
  });

  it("captures from the overlay button", async () => {
    const onCapture = vi.fn();
    render(<WarpProvider overlay download={false} onCapture={onCapture} />);
    await act(async () => {
      screen.getByText("capture").click();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(onCapture).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Snapshot captured & copied")).toBeTruthy();
  });

  it("requires the provider for useWarp", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    function Orphan() {
      useWarp();
      return null;
    }
    expect(() => render(<Orphan />)).toThrow(/inside <WarpProvider>/);
  });
});

describe("noop build", () => {
  it("matches the real exports and renders children only", () => {
    expect(Object.keys(noop).sort()).toEqual(Object.keys(real).sort());
    render(
      <noop.WarpProvider overlay>
        <span>child</span>
      </noop.WarpProvider>,
    );
    expect(screen.getByText("child")).toBeTruthy();
    expect(document.querySelector("[data-warpstate-overlay]")).toBeNull();
  });
});
