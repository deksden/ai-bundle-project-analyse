---
file: .memorybank/docs/workflows/research-structure.md
description: 'Stage 1 workflow: research-structure — подготовка окружения и структурный “снимок” проекта (SQLite + артефакты)'
purpose: 'Читать, чтобы понимать контракт Stage 1: inputs, структура стадий/лейнов, какие скрипты выполняются и где искать результаты'
version: 1.0.0
date: 2025-12-17
status: ACTIVE
c4_level: L3
implementation_files:
  - workflows/research-structure.yaml
  - packages/research-scripts/workflow/bootstrap.mjs
  - analysis/config.json
tags: [workflow, research-structure, stage-1, sqlite, scripts]
parent: .memorybank/docs/workflows/index.md
related_files:
  - docs/development.md
  - scripts/
  - packages/research-scripts/
  - .memorybank/docs/workflows/adr-015-implementation-map.md
history:
  - version: 1.0.0
    date: 2025-12-17
    changes: Initial Stage 1 specification for external bundle repo.
---

# `(project-analyse)/research-structure` (Stage 1)

## 🎯 Цель

Собрать воспроизводимый “структурный срез” анализируемого проекта и подготовить данные/артефакты для следующих стадий ADR‑015:
- инициализация SQLite (WAL),
- построение списков файлов,
- индексирование/обработка кода и документации (лейны),
- консолидация и экспорт артефактов/отчётов.

## ✅ Предпосылки

- Должен быть поднят runtime AI‑KOD (Redis + Server + Worker).
- В PATH: `pnpm`, `tsx`, `sqlite3`.
- Для запуска TS‑скриптов через `pnpm exec tsx …` нужен доступ к pnpm workspace: **обязателен `AI_KOD_PROJECT_ROOT`** (обычно это монорепо `ai-kod`).

## 🔌 Inputs (контракт верхнего уровня)

См. `workflows/research-structure.yaml`.

Минимально:
- `project_root` (required) — путь к анализируемому репозиторию (рекомендуется абсолютный).

Опционально:
- `git_sha` (string)
- `remarks` (array)

Шаблоны inputs:
- `workflows/research-structure.inputs.example.yaml`
- `workflows/local.inputs.sample.yaml.example`

## 🧱 Структура стадий (high level)

Фактическая детализация — в `workflows/research-structure.yaml`, здесь — смысловая схема:

1) **prepare/bootstrap**
   - готовит директории `TASK/global/*`,
   - материализует runtime‑конфиг `TASK/global/analysis/config.runtime.json`,
   - готовит shared путь под SQLite.

2) **lanes (code/docs)**
   - параллельные дорожки обработки кода и документации.

3) **fan-in / consolidate**
   - сбор результатов лейнов,
   - экспорт JSON артефактов и генерация отчёта.

## 🧰 Скрипты и точки входа

Stage 1 использует две категории кода:

### A) Script package: `packages/research-scripts` (entrypoints `workflow/*.mjs`)

Ключевой entrypoint:
- `packages/research-scripts/workflow/bootstrap.mjs`

Он отвечает за:
- вычисление путей внутри task workspace,
- подготовку runtime config на основе `analysis/config.json`,
- запуск TS‑скриптов пайплайна через `pnpm exec tsx …`,
- sanity-check SQLite (наличие таблиц и т.п.).

### B) Pipeline scripts: `scripts/*.ts`

Эти TS‑скрипты запускаются из `bootstrap.mjs` и формируют артефакты (листы файлов, выгрузки, отчёты и т.д.).

## 📤 Артефакты и где их искать

Типовые результаты внутри `TASK/global/*`:
- `global/analysis/config.runtime.json` — runtime‑конфиг прогона.
- `global/analysis/exports/*.json` — выгрузки сущностей/связей/метрик/интеграций (по стадиям).
- `global/reports/structure.md` — отчёт.
- `global/shared/research-structure/shared-resources/analysis.db` — SQLite база (shared между прогонами).

## 🧭 Неймспейсы bundle‑контекста

Воркфлоу использует namespaced `context_from`, например:
- `bundle.project-analyse.scripts`
- `bundle.project-analyse.workflows`
- `bundle.project-analyse.fixtures`

Это нужно, чтобы bundle мог существовать рядом с другими bundles без конфликтов имён.

