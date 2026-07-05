/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Base URL of the MPC guidance service. Unset → local dev default
   * (`http://localhost:8100`); empty string → service declared absent
   * (the public static demo, flies PID). See `sim/mpcService.ts`.
   */
  readonly VITE_MPC_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
