"""Vec3 / Quat / Mat3 helpers, numpy float64, matching the TS physics core
EXACTLY (packages/physics/src/math/*). Conventions:

- Vec3: np.ndarray shape (3,).
- Quat: np.ndarray shape (4,) ordered [x, y, z, w] (w scalar), Hamilton algebra.
- Mat3: np.ndarray shape (9,) row-major.

Operation order mirrors the TS so the numpy port matches to float tolerance
(SLS-28 / R1 — verified by services/rl/tests/test_equivalence.py).
"""

from __future__ import annotations

import math

import numpy as np

Vec3 = np.ndarray
Quat = np.ndarray
Mat3 = np.ndarray

IDENTITY_QUAT = np.array([0.0, 0.0, 0.0, 1.0])


def cross(a: Vec3, b: Vec3) -> Vec3:
    return np.array(
        [
            a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0],
        ]
    )


def quat_multiply(a: Quat, b: Quat) -> Quat:
    """Hamilton product a*b — exact formula from math/quat.ts:multiply."""
    ax, ay, az, aw = a
    bx, by, bz, bw = b
    return np.array(
        [
            aw * bx + ax * bw + ay * bz - az * by,
            aw * by - ax * bz + ay * bw + az * bx,
            aw * bz + ax * by - ay * bx + az * bw,
            aw * bw - ax * bx - ay * by - az * bz,
        ]
    )


def quat_conjugate(q: Quat) -> Quat:
    return np.array([-q[0], -q[1], -q[2], q[3]])


def quat_rotate(q: Quat, v: Vec3) -> Vec3:
    """Rotate v by unit quaternion q — the optimised form from
    math/quat.ts:rotateVec3 (t = 2·(qv×v); v + w·t + qv×t)."""
    qv = q[:3]
    t = 2.0 * cross(qv, v)
    return v + q[3] * t + cross(qv, t)


def quat_from_axis_angle(axis: Vec3, angle: float) -> Quat:
    half = angle * 0.5
    s = np.sin(half)
    return np.array([axis[0] * s, axis[1] * s, axis[2] * s, np.cos(half)])


def quat_normalize(q: Quat, eps: float = 1e-12) -> Quat:
    len2 = float(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3])
    if len2 < eps * eps:
        return IDENTITY_QUAT.copy()
    inv = 1.0 / np.sqrt(len2)
    return q * inv


def mat3_mul_vec(m: Mat3, v: Vec3) -> Vec3:
    return np.array(
        [
            m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
            m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
            m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
        ]
    )


def mat3_inverse(m: Mat3, eps: float = 1e-12) -> Mat3:
    """Adjugate-formula inverse — exact from math/mat3.ts:inverse."""
    det = (
        m[0] * (m[4] * m[8] - m[5] * m[7])
        - m[1] * (m[3] * m[8] - m[5] * m[6])
        + m[2] * (m[3] * m[7] - m[4] * m[6])
    )
    if abs(det) < eps:
        raise ValueError("Mat3.inverse: matrix is singular")
    inv = 1.0 / det
    return np.array(
        [
            (m[4] * m[8] - m[5] * m[7]) * inv,
            (m[2] * m[7] - m[1] * m[8]) * inv,
            (m[1] * m[5] - m[2] * m[4]) * inv,
            (m[5] * m[6] - m[3] * m[8]) * inv,
            (m[0] * m[8] - m[2] * m[6]) * inv,
            (m[2] * m[3] - m[0] * m[5]) * inv,
            (m[3] * m[7] - m[4] * m[6]) * inv,
            (m[1] * m[6] - m[0] * m[7]) * inv,
            (m[0] * m[4] - m[1] * m[3]) * inv,
        ]
    )


def clamp(v: float, lo: float, hi: float) -> float:
    return lo if v < lo else hi if v > hi else v


def vlen(v: Vec3) -> float:
    """Vector length as TS Vec3.length does it — sqrt(x²+y²+z²) in that exact
    order. (np.linalg.norm uses a scaled/BLAS path that differs in the last
    bits, which accumulates on high-speed trajectories — SLS-28 parity.)"""
    return math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])


# --- batched variants (SLS-29 training throughput) ---------------------------
# Same math as the scalar helpers above, over a leading batch axis. Elementwise
# formulas are identical; only the order of float additions in reductions
# differs (~1e-16 rel), far inside the SLS-28 parity gate (rtol 1e-6).


def quat_from_axis_angle_batch(axes: np.ndarray, angles: np.ndarray) -> np.ndarray:
    """(N,3) unit axes + (N,) angles -> (N,4) quats [x,y,z,w]."""
    half = angles * 0.5
    s = np.sin(half)
    return np.concatenate([axes * s[:, None], np.cos(half)[:, None]], axis=1)


def quat_multiply_batch(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """Hamilton product over (N,4) x (N,4) -> (N,4)."""
    ax, ay, az, aw = a[:, 0], a[:, 1], a[:, 2], a[:, 3]
    bx, by, bz, bw = b[:, 0], b[:, 1], b[:, 2], b[:, 3]
    return np.stack(
        [
            aw * bx + ax * bw + ay * bz - az * by,
            aw * by - ax * bz + ay * bw + az * bx,
            aw * bz + ax * by - ay * bx + az * bw,
            aw * bw - ax * bx - ay * by - az * bz,
        ],
        axis=1,
    )


def quat_rotate_batch(q: np.ndarray, v: np.ndarray) -> np.ndarray:
    """Rotate (N,3) vectors by (N,4) unit quats — optimised form, batched."""
    qv = q[:, :3]
    t = 2.0 * np.cross(qv, v)
    return v + q[:, 3:4] * t + np.cross(qv, t)
