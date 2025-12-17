# Development guide (AI‑KOD bundle `project-analyse`) 🛠️

Этот документ — практическая инструкция, как разрабатывать и прогонять воркфлоу из этого репозитория в системе AI‑KOD.

## TL;DR ⚡

```bash
ai-kod env set dev
export AI_KOD_PROJECT_ROOT=/Users/deksden/Documents/_Projects/ai-kod
ai-kod bundles install /Users/deksden/Documents/_Projects/ai-bundle-project-analyse --name project-analyse --force
ai-kod run (project-analyse)/research-structure -i workflows/local.inputs.sample.yaml.example --wait --stream logs
```

## 1) Окружения: dev vs prod-test 🧪

AI‑KOD использует `AI_KOD_ROOT` как data root.

- dev: `~/.ai-kod-dev`
- prod-test: `~/.ai-kod`

Переключение:

```bash
ai-kod env show
ai-kod env set dev
ai-kod env set prod
ai-kod env path
```

Важно: `env set` делает stop → switch → setup(update) → start → verify, и не держит два рантайма одновременно. ⚠️

## 2) Поднятие рантайма AI‑KOD 🧰

Минимальная проверка:

```bash
ai-kod redis status
ai-kod server status
ai-kod workers runtime status
```

Если redis не поднят локально:

```bash
ai-kod redis setup
```

## 3) Переменные окружения (критично для Stage 1) 🔑

Stage 1 (`research-structure`) запускает TS‑скрипты через `pnpm exec tsx …`.
Для этого нужен доступ к pnpm workspace (обычно это монорепо `ai-kod`).

```bash
export AI_KOD_PROJECT_ROOT=/Users/deksden/Documents/_Projects/ai-kod
```

Если `AI_KOD_PROJECT_ROOT` не выставлен (и рядом с запуском не находится `pnpm-workspace.yaml`) — Stage 1, как правило, упадёт на вызове `pnpm exec tsx …`. ❌

## 4) Установка bundle: link vs git 🧩

### Вариант A: локальная разработка (link) 🔗

```bash
ai-kod bundles install /ABS/PATH/ai-bundle-project-analyse --name project-analyse --force
```

Проверка:

```bash
ai-kod bundles list
ai-kod workflows info (project-analyse)/research-structure
```

### Вариант B: установка из git (copy) 📦

```bash
ai-kod bundles install deksden/ai-bundle-project-analyse@main --name project-analyse
```

## 5) Запуск воркфлоу 🏁

### Stage 1: `research-structure` (основной)

```bash
ai-kod run (project-analyse)/research-structure \
  -i workflows/local.inputs.sample.yaml.example \
  --wait \
  --stream logs
```

### Stage 2+: `research-analyse` (skeleton)

```bash
ai-kod run (project-analyse)/research-analyse \
  -i workflows/local.inputs.sample.yaml.example \
  --wait \
  --stream logs
```

## 6) Inputs: как правильно задавать `project_root` 🧾

Рекомендуем: `project_root` всегда абсолютный.

Пример готового файла: `workflows/local.inputs.sample.yaml.example`.

Если указать `project_root` относительным — он будет резолвиться относительно `AI_KOD_PROJECT_ROOT` (или найденного `pnpm-workspace.yaml`), что удобнее для demo, но менее предсказуемо для внешних проектов.

## 7) Где результаты 🗂️

Каждый запуск создаёт `TASK-...` в `AI_KOD_ROOT/workspaces/...`.

Типичные выходы:
- `TASK/global/analysis/config.runtime.json`
- `TASK/global/analysis/exports/*.json`
- `TASK/global/reports/structure.md`
- `TASK/global/shared/research-structure/shared-resources/analysis.db`

Узнать root:

```bash
ROOT="$(ai-kod env path)"
ls -la "$ROOT/workspaces"
```

## 8) Ускорение правок: отдельный hot-loop для `research-scripts` 🔥

Если ты часто правишь entrypoints в `packages/research-scripts/workflow/*.mjs`, удобно “ставить” package отдельно:

```bash
ai-kod packages install /ABS/PATH/ai-bundle-project-analyse/packages/research-scripts \
  --name research-scripts \
  --force
```

## 9) Troubleshooting 🧯

### `Command failed: pnpm exec tsx …`

```bash
export AI_KOD_PROJECT_ROOT=/Users/deksden/Documents/_Projects/ai-kod
```

### `sqlite3: command not found` / `analysis.db was not created`

Нужен установленный `sqlite3` (CLI) в системе.

### Не видит изменения

```bash
ai-kod bundles install /ABS/PATH/ai-bundle-project-analyse --name project-analyse --force
ai-kod env set dev
```

### `Workflow "X" is ambiguous`

Всегда используй namespaced вызов:

```bash
ai-kod run (project-analyse)/research-structure -i ...
```

