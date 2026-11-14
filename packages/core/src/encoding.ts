import { WarpError } from "./errors";
import { parseSnapshot, type ParseOptions } from "./parse";
import type { WarpSnapshot } from "./schema";

/**
 * Compact text encoding: `warp1.` + base64url(deflate-raw(JSON)).
 *
 * Meant for transport (clipboard, agents, URLs, chat). Commit `.warp.json` files
 * instead: they diff and review well. Uses the platform `CompressionStream`, so
 * it adds no dependencies (browsers, Node 18+, Deno, Bun).
 */
export const ENCODED_PREFIX = "warp1.";

export function isEncodedSnapshot(value: unknown): value is string {
  return typeof value === "string" && value.trimStart().startsWith(ENCODED_PREFIX);
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  const reader = source.pipeThrough(stream as TransformStream<Uint8Array, Uint8Array>).getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    length += value.length;
  }
  const out = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array {
  const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Encodes a snapshot into the compact `warp1.` text form. */
export async function encodeSnapshot(snapshot: WarpSnapshot): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(snapshot));
  return ENCODED_PREFIX + toBase64Url(await pipe(json, new CompressionStream("deflate-raw")));
}

/**
 * Decodes and validates a snapshot given as an object, a JSON string or a
 * compact `warp1.` string.
 */
export async function decodeSnapshot(input: unknown, options?: ParseOptions): Promise<WarpSnapshot> {
  if (!isEncodedSnapshot(input)) return parseSnapshot(input, options);
  let json: string;
  try {
    const bytes = fromBase64Url(input.trim().slice(ENCODED_PREFIX.length));
    json = new TextDecoder().decode(await pipe(bytes, new DecompressionStream("deflate-raw")));
  } catch (cause) {
    throw new WarpError(
      "INVALID_SNAPSHOT",
      `Snapshot${options?.source ? ` (${options.source})` : ""} is not a valid compact warpstate string.`,
      { cause },
    );
  }
  return parseSnapshot(json, options);
}
