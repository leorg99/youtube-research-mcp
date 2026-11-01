import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { afterEach, expect, it, vi } from "vitest";
import { createYoutubeMcpServer } from "../src/server.js";
import { testAppConfig } from "./helpers.js";

afterEach(() => vi.unstubAllGlobals());

it.each([
  [400, "invalidPageToken", "INVALID_ARGUMENT", false, 1],
  [400, "API_KEY_INVALID", "AUTH_REQUIRED", false, 1],
  [401, "authError", "AUTH_REQUIRED", false, 1],
  [403, "forbidden", "AUTH_REQUIRED", false, 1],
  [403, "quotaExceeded", "RATE_LIMITED", false, 1],
  [404, "videoNotFound", "NOT_FOUND", false, 1],
  [408, "requestTimeout", "TIMEOUT", true, 1],
  [429, "rateLimitExceeded", "RATE_LIMITED", true, 3],
  [503, "backendError", "UPSTREAM_ERROR", true, 3],
] as const)("preserves HTTP %s/%s diagnostics through the MCP caller", async (status, reason, code, retryable, attempts) => {
  const apiKey = "test-key-never-return";
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify({
    error: {
      message: `Provider diagnostic containing ${apiKey}`,
      details: [{ reason, metadata: { key: apiKey } }],
    },
  }), { status, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fetchMock);
  const server = createYoutubeMcpServer(testAppConfig({ apiKey }));
  const client = new Client({ name: "api-error-regression", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const result = await client.callTool({ name: "youtube_search", arguments: {
      query: "*", filters: { channel_id: "UCp4CBeq4nzeg9smAvdjPrig", order: "date" },
    } });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      code, retryable,
      message: expect.stringContaining("Provider diagnostic containing [REDACTED]"),
      details: { resource: "search", status, reasons: [reason] },
    });
    expect(JSON.stringify(result)).not.toContain(apiKey);
    expect(fetchMock).toHaveBeenCalledTimes(attempts);
  } finally {
    await client.close();
    await server.close();
  }
});
