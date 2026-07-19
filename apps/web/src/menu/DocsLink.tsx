/**
 * Small always-visible link to the documentation site (SLS-32).
 *
 * The docs are deployed as a nested Pages site at `<app-base>docs/` (e.g.
 * /starship-catch-sim/docs/), so the href is derived from Vite's BASE_URL to
 * stay correct under the project sub-path in production and at root in dev.
 *
 * Anchored on the free right-edge middle so it clears the fuel readout (top) and
 * the tower-proximity / PID panels (bottom). Once the SLS-55 help overlay lands
 * on main this link can fold into it; kept standalone here so SLS-32 doesn't
 * depend on that branch.
 */

const DOCS_URL = `${import.meta.env.BASE_URL}docs/`;

export function DocsLink() {
  return (
    <a
      href={DOCS_URL}
      target="_blank"
      rel="noreferrer"
      title="Open the documentation site"
      className="absolute right-3 bottom-24 z-20 select-none rounded-md border border-white/15 bg-black/60 px-2 py-1 font-mono text-[11px] text-white/90 shadow-lg hover:bg-white/20"
      data-testid="docs-link"
    >
      Docs ↗
    </a>
  );
}
