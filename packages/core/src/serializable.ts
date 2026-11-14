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
