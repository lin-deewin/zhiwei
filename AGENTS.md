# Repository Guidelines

## Project Structure & Module Organization

`readme.md` contains the original requirements; `prompt.md` is the expanded development brief; `DESIGN.md` defines the architecture; and `IMPLEMENTATION.md` gives the coding sequence. The application lives in `backend/app/` (FastAPI and SQLite) and `frontend/src/` (React + TypeScript). User documentation is in `docs/`; private article files and the SQLite library belong in the configured data directory, never in source control.

## Build, Test, and Development Commands

Install backend dependencies with `cd backend && python3 -m venv .venv && .venv/bin/pip install -e .`; start the API locally with `.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8010`; LAN access requires `ZHILIB_ALLOW_REMOTE=1` and `--host 0.0.0.0` (private networks only). Install and run the frontend with `cd frontend && npm install && npm run dev -- --host 127.0.0.1 --port 5173`. Build production assets with `npm run build`. The frontend dev server proxies `/api` to port 8010. Scan-to-login works without a desktop. Install Playwright Chromium with `cd backend && .venv/bin/python -m playwright install chromium` only for optional browser login. Update these commands when ports or package scripts change.

## Coding Style & Naming Conventions

Use Python type hints and 4-space indentation; Ruff is configured in `backend/pyproject.toml`. Use TypeScript strict mode and 2-space indentation. React components use PascalCase; service modules and Python functions use snake_case. Keep user-facing product documentation in Simplified Chinese and repository contributor guidance in English. Keep `readme.md` as the source of original requirements; update design and implementation docs as actual behavior changes.

## Testing Guidelines

Pytest is configured for `backend/tests/` and currently includes coverage for AI, API fallback, classification, content deletion, knowledge, knowledge graph, library listing, login, Markdown sync, questions, research workspace, semantic search, sync, and workspace APIs. Run the complete suite with `cd backend && .venv/bin/pytest -q`. Frontend type-checking and production compilation are verified with `cd frontend && npm ci && npm run build`. The V3 GitHub Actions workflow runs both gates on pushes to `main` and `refactor/**`, and pull requests targeting `main`. Continue adding focused regression coverage for sync resumability, filesystem boundaries, classification validation, reading progress, annotation anchoring, and citation provenance.

## Commit & Pull Request Guidelines

Git history is not available in this checkout, so no established commit convention can be inferred. Use short, imperative commit subjects, optionally prefixed by scope (for example, `docs: clarify sync behavior`). Pull requests should explain the user-facing change, list validation performed, link related issues when available, and include screenshots for visual changes.

## Security & Configuration

Never commit Zhihu credentials, session cookies, API keys, or personal article exports. Use local environment configuration for secrets, provide a safe example configuration with placeholders, and ensure logs do not reveal credentials or private content.
