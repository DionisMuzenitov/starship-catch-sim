// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useControllerStore } from "../state/controllerStore";
import { useMpcStore } from "../state/mpcStore";

import { MpcServiceBanner } from "./MpcServiceBanner";

afterEach(() => {
  cleanup();
  useControllerStore.setState({ kind: "manual" });
  useMpcStore.setState({ serviceDisabled: false, serviceUnreachable: false });
});

describe("MpcServiceBanner (SLS-49 / SLS-92)", () => {
  it("shows the static-host message when MPC is active AND the service is disabled", () => {
    useControllerStore.setState({ kind: "mpc" });
    useMpcStore.setState({ serviceDisabled: true });
    render(<MpcServiceBanner />);
    const banner = screen.getByTestId("mpc-service-banner");
    expect(banner.textContent).toContain("needs the local Python service");
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toContain("#running-mpc-locally");
  });

  it("shows the unreachable message when the health-ping failed (dev, SLS-92)", () => {
    useControllerStore.setState({ kind: "mpc" });
    useMpcStore.setState({ serviceUnreachable: true });
    render(<MpcServiceBanner />);
    const banner = screen.getByTestId("mpc-service-banner");
    expect(banner.textContent).toContain("unreachable");
    expect(banner.textContent).toContain("pnpm dev:full");
  });

  it("prefers the disabled message when both flags are set", () => {
    useControllerStore.setState({ kind: "mpc" });
    useMpcStore.setState({ serviceDisabled: true, serviceUnreachable: true });
    render(<MpcServiceBanner />);
    expect(screen.getByTestId("mpc-service-banner").textContent).toContain(
      "needs the local Python service",
    );
  });

  it("hides when the service is reachable (dev / configured build)", () => {
    useControllerStore.setState({ kind: "mpc" });
    useMpcStore.setState({ serviceDisabled: false, serviceUnreachable: false });
    render(<MpcServiceBanner />);
    expect(screen.queryByTestId("mpc-service-banner")).toBeNull();
  });

  it("hides for non-MPC controllers even when a flag is set", () => {
    useControllerStore.setState({ kind: "pid" });
    useMpcStore.setState({ serviceDisabled: true, serviceUnreachable: true });
    render(<MpcServiceBanner />);
    expect(screen.queryByTestId("mpc-service-banner")).toBeNull();
  });
});
