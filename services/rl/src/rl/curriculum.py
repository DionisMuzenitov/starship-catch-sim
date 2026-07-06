"""Curriculum over (start-altitude band × wind scenario) — SLS-29.

Two axes, promoted together as eval success crosses a threshold:

1. **Start altitude** (the axis the ticket missed): full descents are ~6000
   steps of mostly-ballistic coast that dilute the terminal-catch learning
   signal (SLS-47: the catch is the hard part). Early stages start episodes
   in terminal descent via `ballistic.sample_start`, then the band expands
   to the full 65 km scenario start.
2. **Wind scenario** (the ticket's axis): Calm → Standard → Stormy.

`CurriculumManager.update(success_rate)` returns True when a promotion
happened; the trainer then pushes the new stage into every worker env via
`vec_env.env_method("set_stage", ...)`.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Stage:
    name: str
    scenario_id: str
    # None → full scenario start (65 km IC); (lo, hi) tuple → ballistic
    # altitude band; dict {"kind": "corridor", ...} → catchable approach
    # corridor (see ballistic.corridor_start). Corridor stages come FIRST:
    # the nominal ballistic deliberately lands ~800 m past the tower
    # (SLS-49 safety offset), so every ballistic start embeds a large divert
    # — unlearnable as a first rung (SLS-29 diagnostic).
    start_alt_range: tuple[float, float] | dict | None
    promote_at: float  # eval success rate to advance past this stage


def _corridor(alt_above, lateral, vy) -> dict:
    return {"kind": "corridor", "alt_above": alt_above, "lateral": lateral, "vy": vy}


DEFAULT_STAGES: tuple[Stage, ...] = (
    # 1. terminal envelope: hover down into the arms from just above.
    Stage("dock-calm", "booster-descent-calm",
          _corridor((100.0, 500.0), 100.0, (-40.0, -5.0)), 0.8),
    # 2. steeper + faster + wider corridor.
    Stage("approach-calm", "booster-descent-calm",
          _corridor((500.0, 2_500.0), 400.0, (-120.0, -30.0)), 0.8),
    # 3. ballistic band: brake + the ~800 m divert.
    Stage("divert-calm", "booster-descent-calm", (2_000.0, 8_000.0), 0.8),
    # 4. high ballistic: fin steering matters.
    Stage("descent-calm", "booster-descent-calm", (8_000.0, 40_000.0), 0.8),
    # 5. full scenario.
    Stage("full-calm", "booster-descent-calm", None, 0.8),
    Stage("full-standard", "booster-descent-standard", None, 0.8),
    Stage("full-stormy", "booster-descent-stormy", None, 1.1),  # terminal stage
)


def stages_from_config(raw: list[dict] | None) -> tuple[Stage, ...]:
    if not raw:
        return DEFAULT_STAGES
    out = []
    for d in raw:
        rng = d.get("start_alt_range")
        if isinstance(rng, dict):
            spec = rng
        elif rng:
            spec = tuple(rng)
        else:
            spec = None
        out.append(
            Stage(
                name=d["name"],
                scenario_id=d["scenario_id"],
                start_alt_range=spec,
                promote_at=float(d.get("promote_at", 0.8)),
            )
        )
    return tuple(out)


class CurriculumManager:
    def __init__(self, stages: tuple[Stage, ...] = DEFAULT_STAGES):
        if not stages:
            raise ValueError("curriculum needs at least one stage")
        self.stages = stages
        self.index = 0

    @property
    def stage(self) -> Stage:
        return self.stages[self.index]

    @property
    def finished(self) -> bool:
        return self.index >= len(self.stages) - 1

    def update(self, success_rate: float) -> bool:
        """Advance one stage when the eval success rate clears the bar.
        Returns True if a promotion happened."""
        if not self.finished and success_rate >= self.stage.promote_at:
            self.index += 1
            return True
        return False
