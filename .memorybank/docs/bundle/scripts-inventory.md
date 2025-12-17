---
file: .memorybank/docs/bundle/scripts-inventory.md
description: 'Инвентаризация scripts/ и packages/research-scripts: что критично для runtime, что dev-утилиты, что legacy'
purpose: 'Читать перед изменениями в scripts/ и packages/: понимать какие файлы должны быть self-contained и что можно удалять'
version: 1.0.0
date: 2025-12-17
status: ACTIVE
c4_level: L3
tags: [scripts, inventory, runtime, dev-tools, research-scripts]
parent: .memorybank/docs/bundle/index.md
related_files:
  - .memorybank/docs/bundle/manifest.md
  - packages/research-scripts/package.json
  - workflows/research-structure.yaml
history:
  - version: 1.0.0
    date: 2025-12-17
    changes: Initial classification and duplication cleanup plan.
---

# 🧾 Scripts inventory

## 🎯 Главный принцип

- **`packages/research-scripts/`** — self-contained **script package**, который исполняется в workflow как `script.package`.
- **`scripts/`** — TS‑скрипты пайплайна, которые запускаются из package (через `pnpm exec tsx …`) и/или используются как dev‑утилиты.

## ✅ Runtime‑критично (нужно для выполнения workflow)

### A) Script package (исполняется в стадиях)

Папка: `packages/research-scripts/`

- `packages/research-scripts/workflow/bootstrap.mjs` — Stage `start`
- `packages/research-scripts/workflow/code/*` — code lane
- `packages/research-scripts/workflow/docs/*` — docs lane
- `packages/research-scripts/workflow/lanes/*` — lanes summary
- `packages/research-scripts/workflow/report/*` — финальный отчёт

Package‑модули, которые импортируются из workflow entrypoints:
- `packages/research-scripts/utils/*` (hash/tree-sitter/jsdoc-parser)
- `packages/research-scripts/code/index.js` (опции code extraction)
- `packages/research-scripts/docs/index.js`
- `packages/research-scripts/lanes/index.js`
- `packages/research-scripts/cli/index.js`

### B) TS pipeline scripts, которые package вызывает через `pnpm exec tsx`

Папка: `scripts/`

Используются из `packages/research-scripts/workflow/*` через `path.join(bundleRoot, "scripts/<name>.ts")`:
- `scripts/init-db.ts`
- `scripts/generate-file-lists.ts`
- `scripts/write-to-db.ts`
- `scripts/generate-structure-report.ts`

Их зависимости:
- `scripts/utils/logging.ts`
- `scripts/utils/module.ts`
- `scripts/utils/sqlite.ts`

## 🧰 Dev‑утилиты (не обязательны для runtime)

Оставлены в репозитории для удобства разработки:
- `scripts/clean-structure-workflow.ts`
- `scripts/clean-structure-shared.ts`

## 🧹 Что было удалено как legacy/дубли (и почему)

Мы убрали дубли и устаревшие раннеры, которые:
- не используются текущими workflow стадиями,
- дублировали логику `packages/research-scripts/workflow/*`,
- или ломали DX во внешнем репозитории (были завязаны на монорепо `ai-kod`).

Удалено:
- `scripts/package.json` (дублировал `packages/research-scripts/package.json`)
- старые pipeline/cli раннеры и лишние TS‑скрипты, не вызываемые workflow
- дубли модулей `code/docs/lanes/cli/utils/*.js` из `scripts/` (перенесены в `packages/research-scripts/`)

