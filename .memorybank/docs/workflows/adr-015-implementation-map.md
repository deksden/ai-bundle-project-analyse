---
file: .memorybank/docs/workflows/adr-015-implementation-map.md
description: 'ADR-015 ↔ project-analyse: карта соответствия требований и текущей реализации (Stage 1/2+)'
purpose: 'Читать перед изменениями workflow/scripts/manifest: понимать “зачем” и какие части ADR-015 уже реализованы'
version: 1.0.0
date: 2025-12-17
status: ACTIVE
c4_level: L3
tags: [adr-015, implementation-map, workflow, roadmap, project-analyse]
parent: .memorybank/docs/workflows/index.md
related_files:
  - .memorybank/docs/adr/index.md
  - .memorybank/docs/workflows/research-structure.md
  - .memorybank/docs/workflows/research-analyse.md
  - .memorybank/docs/bundle/manifest.md
history:
  - version: 1.0.0
    date: 2025-12-17
    changes: Initial mapping for external bundle repo.
---

# 🧭 ADR‑015 Implementation Map — `project-analyse`

## 1) “Bundle как контейнер ассетов” ✅

**ADR идея:** analysis bundle содержит workflow, скрипты, shared storage, фикстуры/демо и т.д.  
**Реализация:** `.kod/manifest.json` + структура репозитория (`workflows/`, `scripts/`, `packages/`, `schemas/`, `shared/`, `tests/fixtures/`, `examples/`).

## 2) Stage 1: research/structure ✅ (основная реализация)

**ADR идея:** сначала собрать структуру и покрытие (код + документация), сохранить в storage и экспортировать артефакты.  
**Реализация:**
- workflow: `workflows/research-structure.yaml`
- entrypoints и bootstrap: `packages/research-scripts/workflow/bootstrap.mjs`
- pipeline scripts: `scripts/*.ts`
- runtime template config: `analysis/config.json`

**Сильная сторона сейчас:** Stage 1 — самый “боевой” и полезный для ежедневного анализа.

## 3) Stage 2+: research/analyse 🧱 (пока каркас)

**ADR идея:** поверх Stage 1 запускаются независимые “аспекты” (security/perf/arch), quality gates и отчёты full/diff.  
**Реализация сейчас:** `workflows/research-analyse.yaml` делает `wcall` в Stage 1.

**Roadmap:** добавлять новые стадии после `wcall` (аспекты/гейты/отчёты).

## 4) Shared storage (SQLite/WAL) ✅ (в репозитории — только структура)

**ADR идея:** единый storage (SQLite WAL) между прогонами.  
**Реализация:**
- runtime‑БД создаётся в task workspace (shared path),
- в git мы держим только папку‑контейнер: `shared/analysis/.gitkeep` + описание.

## 5) Контракты и воспроизводимость ✅

**ADR идея:** воспроизводимый прогон на фикстурах и демо‑проекте.  
**Реализация:**
- `tests/fixtures/*` — ingest + ожидаемые экспорты,
- `examples/research-structure-demo/*` — демо‑проект,
- `schemas/outputs/*` — схемы outputs для стадий.

## 6) Ограничения текущей реализации (важно для DX) ⚠️

- Stage 1 выполняет TS‑скрипты через `pnpm exec tsx …`, поэтому нужен доступ к pnpm workspace:
  - **обязателен `AI_KOD_PROJECT_ROOT`** (обычно путь до `ai-kod`).
- `sqlite3` CLI обязателен для sanity‑check БД (см. bootstrap).

