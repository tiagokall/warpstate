/**
 * A minimal browser-side "agent" that talks to Chrome's real WebMCP
 * implementation through the DevTools Protocol `WebMCP` domain, the same way a
 * browser-integrated agent does: it sees tools as pages register them and calls
 * them with `WebMCP.invokeTool`.
 *
 * Requires Chromium launched with `--enable-features=WebMCP`
 * (chrome://flags/#enable-webmcp-testing in a regular Chrome).
 */
import type { CDPSession, Page } from "@playwright/test";

export interface CdpTool {
  toolId: string;
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  annotations?: { readOnly?: boolean; consequential?: boolean; untrustedContent?: boolean; debugging?: boolean };
  frameId: string;
}

export interface ToolResponse {
  invocationId: string;
  status: string;
  output?: { content?: Array<{ type: string; text: string }>; structuredContent?: Record<string, unknown>; isError?: boolean };
  errorText?: string;
  [key: string]: unknown;
}

export class WebMcpAgent {
  readonly tools = new Map<string, CdpTool>();
  private readonly responses = new Map<string, ToolResponse>();
  private readonly waiters = new Set<() => void>();

  private constructor(private readonly cdp: CDPSession) {
    cdp.on("WebMCP.toolsAdded", ({ tools }: { tools: CdpTool[] }) => {
      for (const tool of tools) this.tools.set(tool.name, tool);
      this.notify();
    });
    cdp.on("WebMCP.toolsRemoved", ({ tools }: { tools: Array<{ toolId?: string; name?: string }> }) => {
      for (const removed of tools) {
        for (const [name, tool] of this.tools) {
          if (tool.toolId === removed.toolId || name === removed.name) this.tools.delete(name);
        }
      }
      this.notify();
    });
    cdp.on("WebMCP.toolResponded", (response: ToolResponse) => {
      this.responses.set(response.invocationId, response);
      this.notify();
    });
  }

  /** Attach before navigating so no `toolsAdded` event is missed. */
  static async attach(page: Page): Promise<WebMcpAgent> {
    const cdp = await page.context().newCDPSession(page);
    const agent = new WebMcpAgent(cdp);
    await cdp.send("WebMCP.enable");
    return agent;
  }

  private notify() {
    for (const wake of this.waiters) wake();
  }

  private async until<T>(check: () => T | undefined, timeoutMs: number, what: string): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const value = check();
      if (value !== undefined) return value;
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error(`Timed out after ${timeoutMs}ms waiting for ${what}`);
      await new Promise<void>((resolve) => {
        const wake = () => {
          this.waiters.delete(wake);
          clearTimeout(timer);
          resolve();
        };
        const timer = setTimeout(wake, Math.min(remaining, 100));
        this.waiters.add(wake);
      });
    }
  }

  /** Waits until all named tools are registered; returns them. */
  async waitForTools(names: string[], timeoutMs = 10_000): Promise<CdpTool[]> {
    return this.until(
      () => (names.every((n) => this.tools.has(n)) ? names.map((n) => this.tools.get(n)!) : undefined),
      timeoutMs,
      `tools ${names.join(", ")}`,
    );
  }

  /** Forgets known tools, e.g. right before an action that reloads the page. */
  forgetTools() {
    this.tools.clear();
  }

  /** Calls a tool through Chrome and waits for its response. */
  async invoke(name: string, input: Record<string, unknown> = {}, timeoutMs = 10_000): Promise<ToolResponse> {
    const tool = await this.waitForTools([name], timeoutMs).then(([t]) => t!);
    const { invocationId } = (await this.cdp.send("WebMCP.invokeTool" as never, {
      frameId: tool.frameId,
      toolName: name,
      input,
    } as never)) as { invocationId: string };
    return this.until(() => this.responses.get(invocationId), timeoutMs, `response to ${name}`);
  }
}

/** The tool's structured result (what an MCP client would hand the model). */
export function structured(response: ToolResponse): Record<string, unknown> {
  const output = response.output;
  if (output?.structuredContent) return output.structuredContent;
  const text = output?.content?.[0]?.text;
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}
