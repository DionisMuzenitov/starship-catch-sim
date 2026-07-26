// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useControllerStore } from "../state/controllerStore";
import { useMpcStore } from "../state/mpcStore";

import { MpcFallbackBadge } from "./MpcFallbackBadge";

afterEach(() => {
  cleanup();
  useControllerStore.setState({ kind: "manual" });
  useMpcStore.setState({
    usingFallback: true,
    serviceDisabled: false,
    serviceUnreachable: false,
  });
});

function mpcActiveReachable() {
  useControllerStore.setState({ kind: "mpc" });
  useMpcStore.setState({ serviceDisabled: false, serviceUnreachable: false });
}

describe("MpcFallbackBadge (SLS-92)", () => {
  it("reads 'steering' when MPC is actually flying the plan", () => {
    mpcActiveReachable();
    useMpcStore.setState({ usingFallback: false });
    render(<MpcFallbackBadge />);
    const badge = screen.getByTestId("mpc-fallback-badge");
    expect(badge.getAttribute("data-steering")).toBe("true");
    expect(badge.textContent).toContain("steering");
  });

  it("reads 'PID fallback' when the plan is not steering", () => {
    mpcActiveReachable();
    useMpcStore.setState({ usingFallback: true });
    render(<MpcFallbackBadge />);
    const badge = screen.getByTestId("mpc-fallback-badge");
    expect(badge.getAttribute("data-steering")).toBe("false");
    expect(badge.textContent).toContain("PID fallback");
  });

  it("stays hidden for non-MPC controllers", () => {
    useControllerStore.setState({ kind: "rl" });
    render(<MpcFallbackBadge />);
    expect(screen.queryByTestId("mpc-fallback-badge")).toBeNull();
  });

  it("stays hidden when the service is disabled (banner owns that case)", () => {
    useControllerStore.setState({ kind: "mpc" });
    useMpcStore.setState({ serviceDisabled: true, usingFallback: true });
    render(<MpcFallbackBadge />);
    expect(screen.queryByTestId("mpc-fallback-badge")).toBeNull();
  });

  it("stays hidden when the service is unreachable (banner owns that case)", () => {
    useControllerStore.setState({ kind: "mpc" });
    useMpcStore.setState({ serviceUnreachable: true, usingFallback: true });
    render(<MpcFallbackBadge />);
    expect(screen.queryByTestId("mpc-fallback-badge")).toBeNull();
  });
});
