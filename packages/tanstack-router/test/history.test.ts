import { createBrowserHistory, createMemoryHistory } from "@tanstack/react-router";
import { beforeEach, describe, expect, it } from "vitest";
import { HISTORY_STORAGE_KEY, HistoryTracker, createSnapshotHistory } from "../src";

describe("createSnapshotHistory", () => {
  it.each([0, 1, 2])("starts at index %i", (index) => {
    const entries = ["/a", "/b?x=1", "/c#h"];
    const history = createSnapshotHistory({ entries, index });
    expect(history.location.href).toBe(entries[index]);
    expect(history.location.state.__TSR_index).toBe(index);
    expect(history.canGoBack()).toBe(index > 0);
  });

  it("keeps the forward stack", () => {
    const history = createSnapshotHistory({ entries: ["/a", "/b", "/c"], index: 0 });
    history.forward();
    expect(history.location.href).toBe("/b");
    history.forward();
    expect(history.location.href).toBe("/c");
  });

  it("does not mutate the snapshot", () => {
    const entries = ["/a", "/b"];
    const history = createSnapshotHistory({ entries, index: 1 });
    history.push("/c");
    expect(entries).toEqual(["/a", "/b"]);
  });
});

describe("HistoryTracker", () => {
  beforeEach(() => sessionStorage.clear());

  it("follows push, back, forward, replace and go", () => {
    const history = createMemoryHistory({ initialEntries: ["/"] });
    const tracker = new HistoryTracker(history);
    history.push("/a");
    history.push("/b");
    expect(tracker.snapshot()).toEqual({ entries: ["/", "/a", "/b"], index: 2 });
    history.back();
    expect(tracker.snapshot()).toEqual({ entries: ["/", "/a", "/b"], index: 1 });
    history.replace("/a2");
    expect(tracker.snapshot()).toEqual({ entries: ["/", "/a2", "/b"], index: 1 });
    history.go(-1);
    expect(tracker.snapshot()).toEqual({ entries: ["/", "/a2", "/b"], index: 0 });
    history.forward();
    history.push("/c");
    expect(tracker.snapshot()).toEqual({ entries: ["/", "/a2", "/c"], index: 2 });
    tracker.dispose();
  });

  it("is seeded from a snapshot", () => {
    const history = createSnapshotHistory({ entries: ["/a", "/b", "/c"], index: 1 });
    const tracker = new HistoryTracker(history, { seed: { entries: ["/a", "/b", "/c"], index: 1 } });
    expect(tracker.snapshot()).toEqual({ entries: ["/a", "/b", "/c"], index: 1 });
  });

  it("survives a reload through sessionStorage", () => {
    window.history.replaceState(null, "", "/start");
    const first = createBrowserHistory();
    const tracker = new HistoryTracker(first, { persist: true });
    first.push("/one");
    first.flush();
    first.push("/two");
    first.flush();
    expect(tracker.snapshot()).toEqual({ entries: ["/start", "/one", "/two"], index: 2 });
    tracker.dispose();
    first.destroy();

    // A reload keeps window.history.state (with __TSR_index) and sessionStorage.
    const reloadedHistory = createBrowserHistory();
    const reloaded = new HistoryTracker(reloadedHistory, { persist: true });
    expect(reloaded.snapshot()).toEqual({ entries: ["/start", "/one", "/two"], index: 2 });
    reloaded.dispose();
    reloadedHistory.destroy();
  });

  it("ignores persisted entries that disagree with the current location", () => {
    sessionStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify({ entries: [[0, "/elsewhere"]] }));
    window.history.replaceState({ __TSR_index: 0 }, "", "/here");
    const tracker = new HistoryTracker(createBrowserHistory(), { persist: true });
    expect(tracker.snapshot()).toEqual({ entries: ["/here"], index: 0 });
  });
});
