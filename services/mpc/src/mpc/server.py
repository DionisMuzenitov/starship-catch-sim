"""FastAPI wrapper around the parametric PDG SOCP (ADR-007).

One endpoint: POST /solve. The web client (packages/controllers/src/
mpcController.ts) calls it at the re-plan cadence, applies the first
control, and renders the predicted trajectory.
"""

from __future__ import annotations

import numpy as np
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from typing import Literal

from .coast import CoastBurnResult, solve_coast_burn
from .problem import SolveInput, SolveResult, VehicleParams, solve_pdg
from .scvx import SCvxResult, solve_scvx

app = FastAPI(title="SLS MPC guidance", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:4173",  # vite preview (e2e)
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)


class Vec3Model(BaseModel):
    x: float
    y: float
    z: float

    def to_np(self) -> np.ndarray:
        return np.array([self.x, self.y, self.z])

    @staticmethod
    def from_np(a: np.ndarray) -> "Vec3Model":
        return Vec3Model(x=float(a[0]), y=float(a[1]), z=float(a[2]))


class VehicleModel(BaseModel):
    dryMassKg: float = Field(gt=0)
    maxThrustN: float = Field(gt=0)
    minThrustN: float = Field(ge=0)
    ispS: float = Field(gt=0)


class SolveRequest(BaseModel):
    position: Vec3Model
    velocity: Vec3Model
    massKg: float = Field(gt=0)
    vehicle: VehicleModel
    tFHintS: float | None = None
    # Remaining-coast hint for coast+burn re-plans (SLS-47).
    coastHintS: float | None = None
    # Optional exogenous drag acceleration profile, one entry per horizon
    # interval (N=60). Missing/short profiles are zero-padded.
    dragAccel: list[Vec3Model] | None = None
    # "linear": single lossless SOCP (SLS-26 behaviour, default).
    # "scvx": successive convexification — iteratively re-linearizes the
    # drag term about the previous trajectory (SLS-27).
    # "coast+burn": ballistic-coast ignition search + SCvx burn (SLS-47).
    mode: Literal["linear", "scvx", "coast+burn"] = "linear"


class SolveResponse(BaseModel):
    status: str
    tFS: float
    solveTimeMs: float
    fuelKg: float
    terminalSlack: float
    predictedPositions: list[Vec3Model]
    predictedVelocities: list[Vec3Model]
    thrustAccel: list[Vec3Model]
    throttle: list[float]
    # SCvx-only diagnostics; null for mode="linear".
    iterations: int | None = None
    converged: bool | None = None
    # coast+burn only (SLS-47): seconds from the REQUEST state until the
    # planned ignition, plus the decimated ballistic coast trajectory
    # (last sample = ignition state = burn node 0). Null otherwise.
    ignitionTimeS: float | None = None
    coastPositions: list[Vec3Model] | None = None
    coastVelocities: list[Vec3Model] | None = None


def _drag_matrix(entries: list[Vec3Model] | None, n: int) -> np.ndarray | None:
    if not entries:
        return None
    mat = np.zeros((n, 3))
    for i, e in enumerate(entries[:n]):
        mat[i] = e.to_np()
    return mat


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/solve", response_model=SolveResponse)
def solve(req: SolveRequest) -> SolveResponse:
    from .problem import N

    inp = SolveInput(
        position=req.position.to_np(),
        velocity=req.velocity.to_np(),
        mass_kg=req.massKg,
        vehicle=VehicleParams(
            dry_mass_kg=req.vehicle.dryMassKg,
            max_thrust_n=req.vehicle.maxThrustN,
            min_thrust_n=req.vehicle.minThrustN,
            isp_s=req.vehicle.ispS,
        ),
        t_f_hint_s=req.tFHintS,
        drag_accel=_drag_matrix(req.dragAccel, N),
        coast_hint_s=req.coastHintS,
    )
    res: SolveResult | SCvxResult
    iterations: int | None = None
    converged: bool | None = None
    ignition_time_s: float | None = None
    coast_positions: list[Vec3Model] | None = None
    coast_velocities: list[Vec3Model] | None = None
    solve_ms_total: float | None = None
    if req.mode == "coast+burn":
        cb: CoastBurnResult = solve_coast_burn(inp)
        res = cb.burn
        res.status = cb.status  # infeasible coast search overrides
        solve_ms_total = cb.solve_time_ms
        if cb.status == "optimal":
            ignition_time_s = cb.ignition_time_s
            coast_positions = [Vec3Model.from_np(p) for p in cb.coast_positions]
            coast_velocities = [Vec3Model.from_np(v) for v in cb.coast_velocities]
            iterations = cb.burn.iterations
            converged = cb.burn.converged
    elif req.mode == "scvx":
        scvx_res = solve_scvx(inp)
        res = scvx_res
        iterations = scvx_res.iterations
        converged = scvx_res.converged
    else:
        res = solve_pdg(inp)
    return SolveResponse(
        status=res.status,
        tFS=res.t_f_s,
        solveTimeMs=solve_ms_total if solve_ms_total is not None else res.solve_time_ms,
        fuelKg=res.fuel_kg,
        terminalSlack=res.terminal_slack,
        predictedPositions=[Vec3Model.from_np(p) for p in res.positions],
        predictedVelocities=[Vec3Model.from_np(v) for v in res.velocities],
        thrustAccel=[Vec3Model.from_np(u) for u in res.thrust_accel],
        throttle=[float(t) for t in res.throttle],
        iterations=iterations,
        converged=converged,
        ignitionTimeS=ignition_time_s,
        coastPositions=coast_positions,
        coastVelocities=coast_velocities,
    )
