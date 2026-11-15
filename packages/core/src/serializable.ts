/**
 * Walks a value and reports paths that will not survive `JSON.stringify` intact
 * (functions, Maps, Sets, Dates, class instances, bigint, undefined in arrays…).
 */
export function findNonSerializable(value: unknown, path = "$", seen = new WeakSet<object>()): string[] {
  const problems: string[] = [];

  const visit = (current: unknown, currentPath: string): void => {
    switch (typeof current) {
      case "function":
        problems.push(`${currentPath}: function (dropped)`);
        return;
      case "bigint":
        problems.push(`${currentPath}: bigint (JSON.stringify throws)`);
        return;
      case "symbol":
        problems.push(`${currentPath}: symbol (dropped)`);
        return;
      case "number":
        if (!Number.isFinite(current)) problems.push(`${currentPath}: ${current} (becomes null)`);
        return;
      case "object":
        break;
      default:
        return;
    }
    if (current === null) return;
    const obj = current as object;
    if (seen.has(obj)) {
      problems.push(`${currentPath}: circular reference`);
      return;
    }
    seen.add(obj);

    if (obj instanceof Date) {
      problems.push(`${currentPath}: Date (becomes a string)`);
      return;
    }
    if (obj instanceof Map || obj instanceof Set) {
      problems.push(`${currentPath}: ${obj instanceof Map ? "Map" : "Set"} (becomes {})`);
      return;
    }
    if (Array.isArray(obj)) {
      obj.forEach((item, index) => {
        if (item === undefined) problems.push(`${currentPath}[${index}]: undefined (becomes null)`);
        else visit(item, `${currentPath}[${index}]`);
      });
      return;
    }
    const proto = Object.getPrototypeOf(obj);
    if (proto !== Object.prototype && proto !== null) {
      const name = (proto as { constructor?: { name?: string } }).constructor?.name ?? "unknown";
      problems.push(`${currentPath}: instance of ${name} (prototype is lost)`);
    }
    for (const [key, child] of Object.entries(obj)) visit(child, `${currentPath}.${key}`);
  };

  visit(value, path);
  return problems;
}

/** Marker key for values JSON cannot represent natively. */
export const TYPE_TAG = "$warp";

type Tagged =
  | { [TYPE_TAG]: "Map"; entries: Array<[unknown, unknown]> }
  | { [TYPE_TAG]: "Set"; values: unknown[] }
  | { [TYPE_TAG]: "Date"; value: string | null }
  | { [TYPE_TAG]: "BigInt"; value: string };

const isPlainObject = (value: object): boolean => {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

/**
 * Makes captured data JSON-safe without losing types that data caches commonly
 * hold: Map, Set, Date and bigint become tagged objects (`{ "$warp": "Map", … }`)
 * that {@link decodeValue} turns back into the real thing. Anything else passes
 * through unchanged (and is reported by {@link findNonSerializable}).
 */
export function encodeValue(value: unknown): unknown {
  if (typeof value === "bigint") return { [TYPE_TAG]: "BigInt", value: value.toString() } satisfies Tagged;
  if (typeof value !== "object" || value === null) return value;
  if (value instanceof Map) {
    return { [TYPE_TAG]: "Map", entries: [...value].map(([k, v]) => [encodeValue(k), encodeValue(v)]) } satisfies Tagged;
  }
  if (value instanceof Set) return { [TYPE_TAG]: "Set", values: [...value].map(encodeValue) } satisfies Tagged;
  if (value instanceof Date) {
    return { [TYPE_TAG]: "Date", value: Number.isNaN(value.getTime()) ? null : value.toISOString() } satisfies Tagged;
  }
  if (Array.isArray(value)) return value.map(encodeValue);
  if (!isPlainObject(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) out[key] = encodeValue(child);
  return out;
}

/** Reverses {@link encodeValue}. */
export function decodeValue(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return value;
  if (Array.isArray(value)) return value.map(decodeValue);
  const record = value as Record<string, unknown>;
  switch (record[TYPE_TAG]) {
    case "Map":
      if (Array.isArray(record.entries)) {
        return new Map((record.entries as Array<[unknown, unknown]>).map(([k, v]) => [decodeValue(k), decodeValue(v)]));
      }
      break;
    case "Set":
      if (Array.isArray(record.values)) return new Set(record.values.map(decodeValue));
      break;
    case "Date":
      return new Date(typeof record.value === "string" ? record.value : Number.NaN);
    case "BigInt":
      if (typeof record.value === "string") return BigInt(record.value);
      break;
  }
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(record)) out[key] = decodeValue(child);
  return out;
}
