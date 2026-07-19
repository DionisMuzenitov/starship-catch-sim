/**
 * Small always-visible link to the documentation site (SLS-32).
 *
 * In production the docs are deployed as a nested Pages site at `<app-base>docs/`
 * (e.g. /starship-catch-sim/docs/), so the href is host-relative off Vite's
 * BASE_URL. In dev/preview the app server doesn't serve /docs/ (the docs run on
 * their own VitePress server), so we point at the deployed docs site instead —
 * a working destination either way.
 *
 * Anchored on the free right-edge middle: clear of the fuel readout (top-right),
 * the tower-proximity / PID tuning panels (bottom-right, which are wide + tall),
 * and the replay bar (bottom-centre). Once the SLS-55 help overlay lands on main
 * this can fold into it; kept standalone so SLS-32 doesn't depend on that branch.
 */

const DEPLOYED_DOCS_URL =
  "https://dionismuzenitov.github.io/starship-catch-sim/docs/";

const DOCS_URL = import.meta.env.PROD
  ? `${import.meta.env.BASE_URL}docs/`
  : DEPLOYED_DOCS_URL;

export function DocsLink() {
  return (
    <a
      href={DOCS_URL}
      target="_blank"
      rel="noreferrer"
      title="Open the documentation site"
      className="absolute right-3 top-1/2 z-20 -translate-y-1/2 select-none rounded-md border border-white/15 bg-black/60 px-2 py-1 font-mono text-[11px] text-white/90 shadow-lg hover:bg-white/20"
      data-testid="docs-link"
    >
      Docs ↗
    </a>
  );
}
