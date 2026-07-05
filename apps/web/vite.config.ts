import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// GitHub Pages serves a project repo under `/<repo>/`, so the deploy
// workflow sets VITE_BASE_PATH=/starship-catch-sim/ (SLS-49). Dev,
// `vite preview`, and the e2e job leave it unset → root `/`, so local
// tooling and Playwright's baseURL are unaffected.
export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? "/",
  plugins: [react(), tailwindcss()],
});
