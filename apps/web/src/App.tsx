import { useEffect, useState } from "react";

import { SandboxModels } from "./sandbox/SandboxModels";
import { SandboxTower } from "./sandbox/SandboxTower";
import { Scene } from "./scene/Scene";
import { useScenarioStore } from "./state/scenarioStore";

function currentPath(): string {
  return window.location.pathname.replace(/\/+$/, "") || "/";
}

export function App() {
  const [path, setPath] = useState(currentPath);
  const scenarioId = useScenarioStore((s) => s.currentScenarioId);
  const epoch = useScenarioStore((s) => s.epoch);

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
    default:
      // Keying Scene on (scenarioId, epoch) forces a full remount when
      // the user picks a new scenario OR clicks "Reset" on the outcome
      // overlay — `useSimRunner` then constructs a fresh runner.
      return <Scene key={`${scenarioId}-${epoch}`} />;
  }
}
