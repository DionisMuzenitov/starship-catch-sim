/**
 * Deterministic-frame harness for the visual regression goldens (SLS-108).
 *
 * A WebGL frame has many more ways to differ than a DOM snapshot, and the
 * app was not written with pixel-diffing in mind. Everything here exists
 * because it was measured to move pixels between two otherwise identical
 * runs; each item says what it is suppressing so a future reader can tell
 * paranoia from necessity.
 *
 * What is NOT handled here, deliberately:
 *
 * - **Star field.** Was `Math.random()` per page load — 1500 stars
 *   re-scattering, far beyond any diff tolerance. Fixed at the source with a
 *   seeded PRNG (`apps/web/src/scene/Sky.tsx`) rather than hidden by a mask,
 *   because a sky that reshuffles every visit was a (small) real bug.
 * - **Terrain.** `isSoftwareRenderer()` disables the draped heightfield
 *   whenever `navigator.webdriver` is set, so every Playwright frame shows
 *   the flat `<Ground/>`. That is stable, hence golden-able — but it means
 *   these goldens do NOT cover terrain rendering. Stated plainly rather than
 *   worked around: forcing terrain on (`?terrain=force`) would add async
 *   heightfield loads and trade the flake we just removed back in.
 */
import { expect, type Page } from "@playwright/test";

/** localStorage keys the app reads once at mount. Mirrors:
 *  - `apps/web/src/state/helpStore.ts` (TUTORIAL_STORAGE_KEY)
 *  - `apps/web/src/state/qualityStore.ts` (TIER_KEY / PERF_KEY) */
const STORAGE = {
  tutorialDismissed: "sls:tutorial-dismissed",
  qualityTier: "sls.qualityTier",
  perfHud: "sls.perfHud",
} as const;

/**
 * Wall-clock settle budget for the tower chopstick arms.
 *
 * On mount the arms are commanded open from 0 and track with a first-order
 * lag of tau = 0.5 s driven by REAL dt — so they run even though the sim is
 * paused, and being exponential they converge without ever arriving. 3 s is
 * 6 tau (within ~0.25% of target, sub-pixel at these framings); the residual
 * motion is what `maxDiffPixelRatio` in playwright.config.ts absorbs.
 */
const ARM_SETTLE_MS = 3_000;

/**
 * Seed localStorage BEFORE the app boots.
 *
 * Must be `addInitScript`, not a post-load write: every one of these is read
 * once at mount, so setting them after `goto` would have no effect on the
 * frame being captured.
 */
export async function seedDeterministicState(page: Page): Promise<void> {
  await page.addInitScript((storage) => {
    // The perf HUD defaults to ON and prints live `fps 60 · 16.7 ms
    // (worst 33.2)` plus camera coordinates, sampled from performance.now().
    // This alone makes every frame differ.
    window.localStorage.setItem(storage.perfHud, "false");
    // The first-run tutorial card covers the centre of the viewport on the
    // clean browser context Playwright hands us — it would be baked into
    // every golden, hiding the scene the goldens exist to watch.
    window.localStorage.setItem(storage.tutorialDismissed, "1");
    // Pin the quality tier: it drives render scale and post-processing, and
    // is otherwise persisted per-profile.
    window.localStorage.setItem(storage.qualityTier, "medium");
  }, STORAGE);
}

/**
 * Wait for the scene to reach the frame we actually mean to capture.
 *
 * The load path is the subtle part. Vehicle, tower and terrain each render
 * behind a Suspense boundary whose fallback is a DIFFERENT visual (the
 * procedural model), not a blank — and each has an error boundary that
 * silently falls back the same way. So "the canvas is visible" and even
 * "the page finished loading" are both satisfied while the procedural stand-in
 * is on screen. Capturing there would golden the fallback and, worse, a
 * genuine GLB load failure would look like a passing test.
 *
 * Hence: assert the GLB responses land, then let the arms settle.
 */
export async function waitForStableScene(page: Page): Promise<void> {
  await expect(page.locator("canvas")).toBeVisible({ timeout: 20_000 });

  // The status banner is the only DOM-visible sim-time signal. Asserting
  // t = 0.00 s pins the physics state of the frame: the sim boots paused,
  // and nothing here presses Space.
  await expect(page.getByTestId("hud-status-banner")).toContainText("PAUSED", {
    timeout: 20_000,
  });
  await expect(page.getByTestId("hud-status-banner")).toContainText(
    "t = 0.00 s",
  );

  // Fail loudly if the GLBs never arrive, instead of quietly golden-ing the
  // procedural fallback.
  await page.waitForFunction(
    () =>
      performance
        .getEntriesByType("resource")
        .filter((e) => e.name.endsWith(".glb")).length > 0,
    undefined,
    { timeout: 20_000 },
  );

  await page.waitForTimeout(ARM_SETTLE_MS);
}

/** Full setup: seed storage, load, wait for a capture-ready frame. */
export async function gotoStableScene(page: Page, url = "/"): Promise<void> {
  await seedDeterministicState(page);
  await page.goto(url);
  await waitForStableScene(page);
}
