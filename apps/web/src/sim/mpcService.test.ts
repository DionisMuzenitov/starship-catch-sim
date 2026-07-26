import { describe, expect, it, vi } from "vitest";

import {
  pingMpcHealth,
  resolveMpcServiceUrl,
  shouldFlagUnreachable,
} from "./mpcService";

describe("resolveMpcServiceUrl (SLS-49)", () => {
  it("falls back to the local dev service when unset", () => {
    expect(resolveMpcServiceUrl(undefined)).toBe("http://localhost:8100");
  });

  it("treats an empty string as service-absent (static host signal)", () => {
    expect(resolveMpcServiceUrl("")).toBeNull();
    expect(resolveMpcServiceUrl("   ")).toBeNull();
  });

  it("passes through an explicit URL (custom host / tunnel)", () => {
    expect(resolveMpcServiceUrl("https://mpc.example.com")).toBe(
      "https://mpc.example.com",
    );
  });
});

describe("pingMpcHealth (SLS-92)", () => {
  const URL = "http://localhost:8100";

  it("returns true and GETs /health when the service answers ok", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(null, { status: 200 }),
    );
    await expect(pingMpcHealth(URL, fetchImpl)).resolves.toBe(true);
    const [calledUrl, init] = fetchImpl.mock.calls[0]!;
    expect(calledUrl).toBe("http://localhost:8100/health");
    expect((init as RequestInit | undefined)?.method).toBe("GET");
  });

  it("returns false on a rejected fetch (connection refused — the dev case)", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(pingMpcHealth(URL, fetchImpl)).resolves.toBe(false);
  });

  it("returns false on a non-2xx response", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 503 }));
    await expect(pingMpcHealth(URL, fetchImpl)).resolves.toBe(false);
  });

  it("returns false when the request times out (abort)", async () => {
    // A fetch that never resolves until aborted → the AbortSignal.timeout
    // fires and rejects; pingMpcHealth swallows it to `false`.
    const fetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    await expect(pingMpcHealth(URL, fetchImpl as typeof fetch, 5)).resolves.toBe(
      false,
    );
  });

  it("never throws, whatever the transport does", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("boom");
    });
    await expect(pingMpcHealth(URL, fetchImpl)).resolves.toBe(false);
  });
});

describe("shouldFlagUnreachable (SLS-92 reconciliation)", () => {
  it("flags only when unreachable AND still on the fallback AND not cancelled", () => {
    expect(
      shouldFlagUnreachable({
        cancelled: false,
        reachable: false,
        usingFallback: true,
      }),
    ).toBe(true);
  });

  it("does not flag when the ping was reachable", () => {
    expect(
      shouldFlagUnreachable({
        cancelled: false,
        reachable: true,
        usingFallback: true,
      }),
    ).toBe(false);
  });

  it("does not flag when MPC is already steering (proof the service is up)", () => {
    // Slow / 404 /health resolves unreachable, but a solve has landed — the
    // service is demonstrably up, so no false banner.
    expect(
      shouldFlagUnreachable({
        cancelled: false,
        reachable: false,
        usingFallback: false,
      }),
    ).toBe(false);
  });

  it("does not flag a cancelled (torn-down / re-selected) session", () => {
    // A stale ping from a prior mount must not clobber the fresh session.
    expect(
      shouldFlagUnreachable({
        cancelled: true,
        reachable: false,
        usingFallback: true,
      }),
    ).toBe(false);
  });
});
