/**
 * Generic single-loop PID with:
 *  - back-calculation anti-windup (integrator unwound by the saturation
 *    deficit each step, scaled by `kAw`),
 *  - derivative-on-measurement (so step changes in the setpoint don't
 *    kick the derivative term), with a first-order low-pass filter
 *    `derivativeFilterTau` for noise rejection,
 *  - independent output and integral clamps,
 *  - explicit `reset()` for runner restarts and tuning-panel "Save".
 *
 * Call pattern (per tick):
 *   const out = pid.update(setpoint, measurement, dt);
 *
 * The signature takes (setpoint, measurement) rather than (error) so the
 * derivative-on-measurement path has access to the raw plant reading.
 */

export type PIDGains = {
  /** Proportional gain. */
  kp: number;
  /** Integral gain. */
  ki: number;
  /** Derivative gain. */
  kd: number;
  /** Output clamp: `[min, max]`. Both finite. */
  outputClamp: readonly [number, number];
  /** Integrator clamp: `[min, max]`. Both finite. */
  integralClamp: readonly [number, number];
  /** Derivative LP-filter time constant (s). 0 disables filtering. */
  derivativeFilterTau: number;
  /**
   * Back-calculation anti-windup gain. The integrator is decremented by
   * `kAw * (out_raw - out_clamped) * dt` whenever the output saturates.
   * A reasonable default is `1 / kp` (so a 1-unit saturation deficit
   * unwinds the integrator at the same rate it was being driven). Stored
   * separately so tuning the P-loop doesn't silently change anti-windup
   * behaviour.
   */
  kAw: number;
};

export class PID {
  gains: PIDGains;
  private integral = 0;
  private prevMeasurement: number | null = null;
  private filteredDerivative = 0;

  constructor(gains: PIDGains) {
    this.gains = gains;
  }

  /** Reset accumulator + derivative memory. Use on scenario reset. */
  reset(): void {
    this.integral = 0;
    this.prevMeasurement = null;
    this.filteredDerivative = 0;
  }

  /** Current integrator value (useful for tests / charts). */
  getIntegral(): number {
    return this.integral;
  }

  /** Current filtered derivative term (useful for tests / charts). */
  getDerivative(): number {
    return this.filteredDerivative;
  }

  update(setpoint: number, measurement: number, dt: number): number {
    if (dt <= 0) {
      // Defensive: no-op step. Don't pollute integrator or derivative on
      // a zero-time call (would happen on a paused tick that still pumps
      // the controller).
      return clampPair(
        this.gains.kp * (setpoint - measurement),
        this.gains.outputClamp,
      );
    }

    const error = setpoint - measurement;

    // Derivative on measurement: the rate-of-change of the *plant*, not
    // the error. This means a stepped setpoint doesn't produce a huge
    // transient via `kd * d/dt`. Sign is flipped at the kd term below
    // (since d(error)/dt = -d(measurement)/dt for fixed setpoint).
    const rawDerivative =
      this.prevMeasurement === null
        ? 0
        : (measurement - this.prevMeasurement) / dt;
    this.prevMeasurement = measurement;

    // First-order LP on the derivative term.
    const tau = this.gains.derivativeFilterTau;
    if (tau > 0) {
      const alpha = 1 - Math.exp(-dt / tau);
      this.filteredDerivative += (rawDerivative - this.filteredDerivative) * alpha;
    } else {
      this.filteredDerivative = rawDerivative;
    }

    // Pre-clamp integrator update.
    this.integral += this.gains.ki * error * dt;
    this.integral = clampPair(this.integral, this.gains.integralClamp);

    const rawOut =
      this.gains.kp * error +
      this.integral -
      this.gains.kd * this.filteredDerivative;

    const clamped = clampPair(rawOut, this.gains.outputClamp);

    // Back-calculation anti-windup: when the output is saturated, unwind
    // the integrator proportional to the saturation deficit. Skipped when
    // ki == 0 (P/PD controller — no integrator to unwind).
    if (this.gains.ki !== 0 && rawOut !== clamped) {
      const deficit = clamped - rawOut;
      this.integral += this.gains.kAw * deficit * dt;
      this.integral = clampPair(this.integral, this.gains.integralClamp);
    }

    return clamped;
  }
}

function clampPair(v: number, [lo, hi]: readonly [number, number]): number {
  return v < lo ? lo : v > hi ? hi : v;
}
