import { describe, expect, it } from "vitest";

import { Mat3 } from "./math/mat3.js";
import { Quat } from "./math/quat.js";
import { Vec3 } from "./math/vec3.js";
import { createRigidBody } from "./state.js";

const unitInertia = Mat3.fromDiagonal(Vec3.of(1, 1, 1));

describe("createRigidBody", () => {
  it("fills motion defaults (rest at origin, identity attitude)", () => {
    const s = createRigidBody({ mass: 100, inertia: unitInertia });
    expect(s.position).toEqual(Vec3.ZERO);
    expect(s.velocity).toEqual(Vec3.ZERO);
    expect(s.attitude).toEqual(Quat.IDENTITY);
    expect(s.angularVelocity).toEqual(Vec3.ZERO);
    expect(s.mass).toBe(100);
    expect(s.inertia).toBe(unitInertia);
  });

  it("honours overrides", () => {
    const s = createRigidBody({
      mass: 1,
      inertia: unitInertia,
      position: Vec3.of(1, 2, 3),
      velocity: Vec3.of(4, 5, 6),
      attitude: Quat.fromAxisAngle(Vec3.of(0, 0, 1), Math.PI / 4),
      angularVelocity: Vec3.of(0.1, 0.2, 0.3),
    });
    expect(s.position).toEqual(Vec3.of(1, 2, 3));
    expect(s.velocity).toEqual(Vec3.of(4, 5, 6));
    expect(s.angularVelocity).toEqual(Vec3.of(0.1, 0.2, 0.3));
    expect(Math.abs(Quat.length(s.attitude) - 1)).toBeLessThan(1e-12);
  });
});
