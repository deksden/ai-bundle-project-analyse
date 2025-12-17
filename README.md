# AI‑KOD Bundle: `project-analyse` (ADR‑015)

Этот репозиторий — внешний **workflow bundle** для системы **AI‑KOD**.

Сейчас в нём:
- **Stage 1**: `research-structure` — структурный срез проекта (C4‑хребет, интеграции, артефакты/выгрузки).
- **Stage 2+ (skeleton)**: `research-analyse` — верхнеуровневая оркестрация (будет расширяться).

## 📦 Состав репозитория

- `.kod/manifest.json` — manifest бандла (content groups + defaults.attach_groups).
- `workflows/research-structure.yaml` — Stage 1 workflow (DSL v2).
- `workflows/research-analyse.yaml` — Stage 2+ workflow (skeleton).
- `packages/research-scripts/` — script package `research-scripts@0.4.0` (entrypoints `workflow/*.mjs`).
- `scripts/*.ts` — TS‑скрипты пайплайна (запускаются через `pnpm exec tsx …`).
- `analysis/config.json` — шаблон конфигурации SQLite/WAL.
- `examples/research-structure-demo/` — демо‑проект для прогона.
- `tests/fixtures/` — ingest + ожидаемые экспорты (для регрессии/сверок).
- `shared/analysis/` — shared артефакты (хранилище для БД/экспортов между прогонами).

## ✅ Предпосылки

- Запущен runtime AI‑KOD: **Redis + Server + Worker**.
- В PATH доступны: `pnpm`, `tsx`, `sqlite3` (используются script stages).
- Для запуска TS‑скриптов пайплайна требуется `pnpm` проект с зависимостями: в dev‑режиме задайте `AI_KOD_PROJECT_ROOT` (например, путь до монорепо `ai-kod`).

## 🚀 Локальная разработка (рекомендуемый DX)

### 1) Выбрать data root

```bash
ai-kod env set dev
# или руками:
# export AI_KOD_ROOT=~/.ai-kod-dev
```

Рекомендуем дополнительно:

```bash
export AI_KOD_PROJECT_ROOT=/Users/deksden/Documents/_Projects/ai-kod
```

### 2) Установить bundle из локального пути (link)

```bash
ai-kod bundles install /Users/deksden/Documents/_Projects/ai-bundle-project-analyse \
  --name project-analyse \
  --force
```

> `--force` нужен, если меняешь файлы, но не меняешь версию бандла: installer защищает от ситуации “одинаковая версия — разное содержимое”.

### 3) (Опционально) Залинковать script package для hot‑edit

Это даёт быстрый цикл разработки для `packages/research-scripts` без переустановки бандла:

```bash
ai-kod packages install /Users/deksden/Documents/_Projects/ai-bundle-project-analyse/packages/research-scripts --force
```

### 4) Запуск workflow

```bash
ai-kod run (project-analyse)/research-structure \
  -i workflows/research-structure.inputs.example.yaml \
  --wait \
  --stream logs
```

Или Stage 2+ (пока это минимальный каркас):

```bash
ai-kod run (project-analyse)/research-analyse \
  -i workflows/research-structure.inputs.example.yaml \
  --wait \
  --stream logs
```

## 🔁 Dev‑цикл

- Правки в `workflows/` и `scripts/` подтягиваются сразу при link‑установке бандла.
- Правки в `packages/research-scripts/`:
  - либо поддерживай link через `ai-kod packages install … --force`,
  - либо переустанавливай бандл `ai-kod bundles install … --force` (если полагаешься на export пакета из бандла).

## 🧹 Утилиты очистки

```bash
# очистить демо-артефакты
pnpm tsx scripts/clean-structure-workflow.ts

# очистить shared ресурсы в конкретном task/global
pnpm tsx scripts/clean-structure-shared.ts --global-root "<путь к TASK-XXX/global>"
```

## 📤 Выходные артефакты (внутри task workspace)

Ожидаемые директории формируются в `TASK/global/*` (точные пути зависят от конфигурации `analysis/config.json` и конкретных стадий), включая:
- `global/analysis/exports/*.json` — выгрузки сущностей/связей/метрик/интеграций,
- `global/reports/structure.md` — Markdown‑отчёт,
- `global/shared/research-structure/shared-resources/analysis.db` — shared SQLite база.
