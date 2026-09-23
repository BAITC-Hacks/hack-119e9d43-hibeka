"""Validated, versioned settings for the reproducible analysis."""
import json
from pathlib import Path
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, model_validator

Unit = Annotated[float, Field(ge=0, le=1, allow_inf_nan=False)]
Positive = Annotated[float, Field(gt=0, allow_inf_nan=False)]
Count = Annotated[int, Field(gt=0, strict=True)]


class Settings(BaseModel):
    model_config = ConfigDict(extra="forbid")


class RoleSettings(Settings):
    consolidator_min_in: Count = 3
    consolidator_scale_in: Count = 8
    consolidator_weights: tuple[Unit, Unit, Unit, Unit] = (.45, .25, .20, .10)
    consolidator_q: Unit = .90
    consolidator_boundary_q: Unit = .60
    distributor_min_out: Count = 10
    distributor_scale_out: Count = 20
    distributor_weights: tuple[Unit, Unit, Unit] = (.50, .30, .20)
    distributor_q: Unit = .90
    transit_min_ratio: Unit = .8
    transit_max_ratio: Positive = 1.2
    transit_balance_width: Positive = .2
    transit_scale_tx: Count = 3
    transit_scale_kzt: Positive = 100000
    transit_weights: tuple[Unit, Unit, Unit] = (.60, .20, .20)
    transit_q: Unit = .75
    terminal_base: Unit = .60
    terminal_days_weight: Unit = .40
    terminal_observation_days: Count = 7
    terminal_q: Unit = .65
    coordinator_quantile: Unit = .95
    coordinator_min_clusters: Count = 2
    coordinator_scale_clusters: Count = 3
    coordinator_weights: tuple[Unit, Unit, Unit] = (.50, .30, .20)
    coordinator_q: Unit = .80
    seed_scale: Count = 3

    @model_validator(mode="after")
    def valid_formulas(self):
        for role in ("consolidator", "distributor", "transit", "coordinator"):
            if abs(sum(getattr(self, role + "_weights")) - 1) > 1e-10:
                raise ValueError(f"{role}: сумма весов должна быть 1")
        if abs(self.terminal_base + self.terminal_days_weight - 1) > 1e-10:
            raise ValueError("terminal: сумма весов должна быть 1")
        if self.transit_min_ratio > self.transit_max_ratio:
            raise ValueError("Некорректный диапазон transit")
        return self


class RankingSettings(Settings):
    betweenness: Unit = .30
    pagerank: Unit = .20
    activity_kzt: Unit = .20
    n_seed_upstream: Unit = .15
    neighbor_count: Unit = .15

    @model_validator(mode="after")
    def normalized(self):
        if abs(sum(self.model_dump().values()) - 1) > 1e-10:
            raise ValueError("Сумма весов рейтинга должна быть 1")
        return self


class AnalysisConfig(Settings):
    schema_version: str = "1.0"
    role_version: str = "1.1"
    ranking_version: str = "1.1"
    boundary_depth: Count = 4
    pagerank_alpha: Annotated[float, Field(gt=0, lt=1)] = .85
    pagerank_max_iter: Count = 1000
    pagerank_tol: Positive = 1e-8
    louvain_resolution: Positive = 1
    random_seed: int = 42
    top_n: Annotated[int, Field(ge=20, strict=True)] = 50
    roles: RoleSettings = Field(default_factory=RoleSettings)
    ranking: RankingSettings = Field(default_factory=RankingSettings)


DEFAULT_CONFIG_PATH = Path(__file__).resolve().parents[3] / "config.json"


def load_config(path: Path = DEFAULT_CONFIG_PATH) -> AnalysisConfig:
    return AnalysisConfig.model_validate(json.loads(path.read_text(encoding="utf-8")))
