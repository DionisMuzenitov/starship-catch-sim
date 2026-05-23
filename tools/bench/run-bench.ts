// Perf harness stub — times a no-op loop so the wiring works end-to-end.
// Real physics-step benchmarks land in SLS-13 once the integrator exists.

const STEPS = Number(process.env.BENCH_STEPS ?? 1_000_000);

const start = performance.now();
let acc = 0;
for (let i = 0; i < STEPS; i++) {
  acc += i;
}
const elapsedMs = performance.now() - start;
const nsPerStep = (elapsedMs * 1e6) / STEPS;

console.log(
  `bench(no-op): ${STEPS.toLocaleString()} steps in ${elapsedMs.toFixed(2)} ms ` +
    `(${nsPerStep.toFixed(1)} ns/step) — acc=${acc}`,
);
