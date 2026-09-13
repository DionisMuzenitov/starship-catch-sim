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
 * motion is what the per-capture `maxDiffPixelRatio` absorbs.
 */
const ARM_SETTLE_MS = 3_000;

/**
 * Models that must have loaded before a frame is worth capturing. Suffixes,
 * matched against the resource URL, so the `BASE_URL` prefix is irrelevant.
 * Mirrors `models/glb/stackAsset.ts` (STACK_GLB_URL) and
 * `scene/MechazillaTowerGLB.tsx` (TOWER_GLB_URL).
 */
const GLB_ASSETS: readonly string[] = [
  "assets/starship-stack.glb",
  "assets/mechazilla-tower.glb",
];

/**
 * Diff tolerance, as a fraction of the 1280×720 frame.
 *
 * **Size this against the SUBJECT, not the frame.** The first version used
 * 0.004 — 3,686 of 921,600 pixels — which sounds tight and is not: in the
 * default-scene golden only 27,558 pixels are non-black and the booster
 * itself is **921 pixels**. Deleting the vehicle outright, or silently
 * swapping it for the procedural fallback, changes fewer pixels than the
 * tolerance allowed and would have passed. That is the same
 * "cannot fail for the reason it was written" trap this suite rejects
 * elsewhere; it deserved to be caught here too.
 *
 * 0.0005 ≈ 460 px — half the booster — so any change to the subject trips
 * it, while leaving room for antialiasing jitter around the edges.
 *
 * Frames whose subject fills much more of the viewport can afford a looser
 * value; pass it explicitly and say why at the call site.
 */
const DEFAULT_MAX_DIFF_PIXEL_RATIO = 0.0005;

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
  //
  // Check `responseStatus`, not entry existence: a 404 produces a
  // PerformanceResourceTiming entry exactly like a 200 does, so counting
  // entries would pass while GLTFLoader rejected and the error boundary
  // rendered the procedural stand-in. That matters most in the REGENERATE
  // direction (`visual-goldens.yml` runs `--update-snapshots`), where a
  // missing asset would be baked into the golden with nothing to compare it
  // against. Both models are required — a tower-only failure is exactly the
  // regression class these goldens exist for.
  await page.waitForFunction(
    (urls: readonly string[]) =>
      urls.every((url) =>
        performance
          .getEntriesByType("resource")
          .some(
            (e) =>
              e.name.endsWith(url) &&
              (e as PerformanceResourceTiming).responseStatus === 200,
          ),
      ),
    GLB_ASSETS,
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

/**
 * Capture one frame and compare it to the committed golden.
 *
 * Deliberately NOT `expect(page).toHaveScreenshot()`. That helper first
 * screenshots the page repeatedly until two consecutive captures come back
 * byte-identical, and only then compares. This scene never satisfies that:
 * the chopstick arms track their target on a first-order lag, which
 * converges geometrically but never actually arrives, so consecutive frames
 * differ forever by a sub-pixel amount. In CI it burned the full 5 s budget
 * and failed with "generating new stable screenshot expectation" — before
 * ever writing an image to compare.
 *
 * Taking exactly one screenshot and comparing it with a pixel tolerance
 * matches what we actually want to assert: not "the renderer is frozen", but
 * "this frame looks like the frame we approved".
 *
 * The PNG is also written into `test-results/` so a CI failure artifact
 * always carries the actual frame, not just a diff percentage.
 *
 * The `animations` option is left at its default deliberately: measured
 * serially it changes nothing here (237,736 vs 237,737 bytes — there are no
 * CSS animations in the app), and the scene's only motion is a WebGL render
 * loop Playwright cannot freeze anyway. See the serial-execution note in
 * `visual-golden.spec.ts` for what DOES destroy the frame.
 */
export async function captureGolden(
  page: Page,
  name: string,
  maxDiffPixelRatio = DEFAULT_MAX_DIFF_PIXEL_RATIO,
): Promise<void> {
  const buffer = await page.screenshot({
    path: `test-results/actual-${name}`,
  });
  expect(buffer).toMatchSnapshot(name, {
    maxDiffPixelRatio,
    threshold: 0.15,
  });
}
