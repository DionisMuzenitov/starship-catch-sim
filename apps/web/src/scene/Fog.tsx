import { FOG_DENSITY, HORIZON_COLOR } from "./constants";

export function Fog() {
  return <fogExp2 attach="fog" args={[HORIZON_COLOR, FOG_DENSITY]} />;
}
