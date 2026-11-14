export interface ParsedShortcut {
  key: string;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
}

/** Parses strings like `"ctrl+shift+s"` or `"meta+alt+k"`. `mod` means meta on macOS, ctrl elsewhere. */
export function parseShortcut(shortcut: string): ParsedShortcut {
  const parts = shortcut.toLowerCase().split("+").map((p) => p.trim()).filter(Boolean);
  const isMac = typeof navigator !== "undefined" && /mac|iphone|ipad/i.test(navigator.platform);
  const parsed: ParsedShortcut = { key: "", ctrl: false, shift: false, alt: false, meta: false };
  for (const part of parts) {
    if (part === "ctrl" || part === "control") parsed.ctrl = true;
    else if (part === "shift") parsed.shift = true;
    else if (part === "alt" || part === "option") parsed.alt = true;
    else if (part === "meta" || part === "cmd" || part === "command") parsed.meta = true;
    else if (part === "mod") parsed[isMac ? "meta" : "ctrl"] = true;
    else parsed.key = part;
  }
  if (!parsed.key) throw new Error(`Invalid shortcut "${shortcut}": missing a key.`);
  return parsed;
}

export function matchesShortcut(event: KeyboardEvent, shortcut: ParsedShortcut | string): boolean {
  const s = typeof shortcut === "string" ? parseShortcut(shortcut) : shortcut;
  // `event.code` keeps letters stable when Shift/Alt change `event.key` (e.g. "S" or "ß").
  const code = event.code?.toLowerCase() ?? "";
  const key = event.key?.toLowerCase() ?? "";
  const keyMatches = key === s.key || code === `key${s.key}` || code === `digit${s.key}` || code === s.key;
  return (
    keyMatches &&
    event.ctrlKey === s.ctrl &&
    event.shiftKey === s.shift &&
    event.altKey === s.alt &&
    event.metaKey === s.meta
  );
}
