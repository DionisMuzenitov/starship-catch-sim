# MPC guidance service — FastAPI + CVXPY/Clarabel (ADR-007, SLS-26).
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

WORKDIR /app

# Dependency layer first for build caching.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-install-project --no-dev

COPY src ./src
RUN uv sync --frozen --no-dev

EXPOSE 8100
CMD ["uv", "run", "--no-dev", "uvicorn", "mpc.server:app", "--host", "0.0.0.0", "--port", "8100"]
