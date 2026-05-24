import { useEffect, useState } from "react";

import { SandboxModels } from "./sandbox/SandboxModels";
import { SandboxTower } from "./sandbox/SandboxTower";
import { Scene } from "./scene/Scene";

function currentPath(): string {
  return window.location.pathname.replace(/\/+$/, "") || "/";
}

export function App() {
  const [path, setPath] = useState(currentPath);

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
      return <Scene />;
  }
}
