// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useControllerStore } from "../state/controllerStore";
import { useMpcStore } from "../state/mpcStore";

import { MpcServiceBanner } from "./MpcServiceBanner";

afterEach(() => {
  cleanup();
  useControllerStore.setState({ kind: "manual" });
  useMpcStore.setState({ serviceDisabled: false });
});

describe("MpcServiceBanner (SLS-49)", () => {
  it("shows when MPC is active AND the service is disabled", () => {
    useControllerStore.setState({ kind: "mpc" });
    useMpcStore.setState({ serviceDisabled: true });
    render(<MpcServiceBanner />);
    expect(screen.getByTestId("mpc-service-banner")).toBeTruthy();
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toContain("#running-mpc-locally");
  });

  it("hides when the service is available (dev / configured build)", () => {
    useControllerStore.setState({ kind: "mpc" });
    useMpcStore.setState({ serviceDisabled: false });
    render(<MpcServiceBanner />);
    expect(screen.queryByTestId("mpc-service-banner")).toBeNull();
  });

  it("hides for non-MPC controllers even when disabled", () => {
    useControllerStore.setState({ kind: "pid" });
    useMpcStore.setState({ serviceDisabled: true });
    render(<MpcServiceBanner />);
    expect(screen.queryByTestId("mpc-service-banner")).toBeNull();
  });
});
