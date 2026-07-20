import { useEffect, useState } from "react";

import { ArmColliderLab } from "./sandbox/ArmColliderLab";
import { BoosterColliderLab } from "./sandbox/BoosterColliderLab";
import { EnginePlumeLab } from "./sandbox/EnginePlumeLab";
import { SandboxModels } from "./sandbox/SandboxModels";
import { SandboxTower } from "./sandbox/SandboxTower";
import { Scene } from "./scene/Scene";
import { useControllerStore } from "./state/controllerStore";
import { useScenarioStore } from "./state/scenarioStore";

function currentPath(): string {
  return window.location.pathname.replace(/\/+$/, "") || "/";
}

export function App() {
  const [path, setPath] = useState(currentPath);
  const scenarioId = useScenarioStore((s) => s.currentScenarioId);
  const epoch = useScenarioStore((s) => s.epoch);
  const controllerKind = useControllerStore((s) => s.kind);

  useEffect(() => {
    const handler = () => setPath(currentPath());
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, []);

  switch (path) {
    case "/sandbox/models":
      return <SandboxModels />;
    case "/sandbox/tower":
      return <SandboxTower />;
    case "/sandbox/arm":
      return <ArmColliderLab />;
    case "/sandbox/booster":
      return <BoosterColliderLab />;
    case "/sandbox/plumes":
      return <EnginePlumeLab />;
    default:
      // Keying Scene on (scenarioId, epoch, controllerKind) forces a full
      // remount when the user picks a new scenario, swaps Manual ↔ PID,
      // or clicks "Reset" on the outcome overlay — `useSimRunner` then
      // constructs a fresh runner with the chosen controller.
      return <Scene key={`${scenarioId}-${epoch}-${controllerKind}`} />;
  }
}
