# AI‑KOD Bundle: `project-analyse` (ADR‑015) 🧩

Этот репозиторий — внешний **workflow bundle** для системы **AI‑KOD**. Цель: развивать `research-*` воркфлоу **в отдельном репозитории**, устанавливать в AI‑KOD “почти как у пользователя”, но при этом иметь быстрый dev‑цикл. 🚀

📘 Dev guide: `docs/development.md`
🧠 Memory Bank: `.memorybank/index.md`

## 🔎 Что внутри и как это связано

Воркфлоу в этом бандле:
- **Stage 1 (основной, уже проработан)**: `research-structure` — “структурный срез” проекта: индексирование, формирование артефактов, выгрузки, отчёты, подготовка SQLite базы.
- **Stage 2+ (пока skeleton)**: `research-analyse` — верхнеуровневая оркестрация ADR‑015. Сейчас он **делает `wcall` в Stage 1** и будет расширяться дальше.

Практически: если ты продолжаешь развивать “анализ проекта”, то чаще всего правки начнутся в `research-structure`, а `research-analyse` станет точкой сборки/оркестрации следующих стадий. 🧠

## 📦 Структура репозитория

- `.kod/manifest.json` — manifest бандла (content groups + defaults.attach_groups).
- `workflows/research-structure.yaml` — Stage 1 workflow (DSL v2).
- `workflows/research-analyse.yaml` — Stage 2+ workflow (skeleton, вызывает `research-structure`).
- `packages/research-scripts/` — script package `research-scripts@0.4.0` (entrypoints `workflow/*.mjs`).
- `scripts/` — TS/JS‑скрипты пайплайна (запускаются из `bootstrap.mjs` через `pnpm exec tsx …`).
- `analysis/config.json` — шаблон runtime‑конфига для SQLite/WAL (в рантайме материализуется в task workspace).
- `examples/research-structure-demo/` — демо‑проект для прогона.
- `tests/fixtures/` — ingest + ожидаемые экспорты (для регрессии/сверок).
- `shared/analysis/` — shared артефакты между прогонами (например, БД).

## ✅ Предпосылки (обязательные)

1) Запущен runtime AI‑KOD: **Redis + Server + Worker** (pm2). 🧰  
2) В PATH доступны: `pnpm`, `tsx`, `sqlite3` (используются script stages).  
3) В dev‑режиме **обязательно** выставить `AI_KOD_PROJECT_ROOT` (см. ниже), иначе Stage 1 не сможет выполнить `pnpm exec tsx …`.

Почему нужен `AI_KOD_PROJECT_ROOT`?  
Stage 1 (`packages/research-scripts/workflow/bootstrap.mjs`) запускает TS‑скрипты через `pnpm exec tsx …` и для этого ищет **pnpm workspace** (или использует явно заданный `AI_KOD_PROJECT_ROOT`). Обычно это монорепо `ai-kod`, где уже есть `pnpm`, `tsx` и нужные зависимости. ✅

---

## 🧪 Режимы окружения AI‑KOD (dev vs prod-test)

Мы используем **два data root**:
- **dev**: `~/.ai-kod-dev` — быстрый DX, безопасно “ломать”, удобно для ежедневной разработки.
- **prod-test**: `~/.ai-kod` — интеграционное “как у пользователя” тестирование.

Переключение делает CLI (автоматически: stop → switch → setup(update) → start → verify):

```bash
ai-kod env show
ai-kod env set dev
ai-kod env set prod
ai-kod env path
```

Важно: **одновременно два рантайма не держим** — `env set` сам остановит процессы в другом root. ⚠️

---

## 🚀 Quick Start (60 секунд) ⚡

### 0) Поднять рантайм AI‑KOD (один раз)

```bash
ai-kod env set dev
ai-kod redis status
ai-kod server status
ai-kod workers runtime status
```

Если redis не поднят:

```bash
ai-kod redis setup
```

### 1) Подготовить переменные окружения

```bash
export AI_KOD_PROJECT_ROOT=/Users/deksden/Documents/_Projects/ai-kod
```

### 2) Установить bundle из локальной папки (link‑режим для разработки)

```bash
ai-kod bundles install /Users/deksden/Documents/_Projects/ai-bundle-project-analyse \
  --name project-analyse \
  --force
```

### 3) Запустить Stage 1 на демо‑проекте

```bash
ai-kod run (project-analyse)/research-structure \
  -i workflows/research-structure.inputs.example.yaml \
  --wait \
  --stream logs
```

---

## 🧩 Установка бандла: local‑dev vs git

### Вариант A (рекомендуется): локальная разработка (link) 🔗

Link‑установка нужна, чтобы правки в `workflows/` / `scripts/` подхватывались **сразу**, без публикации и без копирования. ✅

```bash
ai-kod bundles install /ABS/PATH/ai-bundle-project-analyse --name project-analyse --force
```

Проверка, что бандл виден:

```bash
ai-kod bundles list
ai-kod workflows info (project-analyse)/research-structure
```

### Вариант B: установка из git (copy) 📦

Это режим “как у пользователя”: AI‑KOD клонирует репозиторий и устанавливает snapshot.

```bash
ai-kod bundles install deksden/ai-bundle-project-analyse@main --name project-analyse
```

Примечание: если ты ставишь из git и часто меняешь содержимое — **повышай версию** в `.kod/manifest.json` (или используй `--force` осознанно).

---

## 🛠️ Разработка: быстрый цикл правок 🔁

### Что можно править “на лету”

Когда бандл установлен из локальной папки (link):
- правки в `workflows/*.yaml` видны сразу;
- правки в `scripts/*` видны сразу (они берутся из bundle‑контекста в task workspace).

### Script package (`research-scripts`) — отдельный hot‑loop 🔥

Stage 1 использует `packages/research-scripts`. Его можно развивать отдельно от всего bundle‑install:

```bash
ai-kod packages install /ABS/PATH/ai-bundle-project-analyse/packages/research-scripts \
  --name research-scripts \
  --force
```

Когда это нужно:
- ты часто правишь `packages/research-scripts/workflow/*.mjs` и хочешь минимизировать “переустановки”.

Если менял только `packages/research-scripts`:
- переустанови package командой выше и перезапусти workflow;
- если видишь странности — сделай `ai-kod env set dev` (это перезапустит всё окружение).

---

## 🏁 Запуск на реальном проекте (например, `ai-kod-sample-project`) 🧪

### 1) Подготовь inputs

Рекомендуем: **всегда указывать `project_root` абсолютным путём**, чтобы избежать сюрпризов.

Пример `./workflows/local.inputs.sample.yaml` (создай файл рядом с репо или в удобном месте):

```yaml
project_root: /ABS/PATH/ai-kod-sample-project
git_sha: ""
remarks: []
```

Готовый шаблон: `workflows/local.inputs.sample.yaml.example` ✅

`project_root` может быть и относительным, но тогда он будет резолвиться относительно `AI_KOD_PROJECT_ROOT` (или найденного `pnpm-workspace.yaml`). Для DX лучше абсолютный путь. ✅

### 2) Запусти workflow

```bash
ai-kod run (project-analyse)/research-structure \
  -i workflows/local.inputs.sample.yaml \
  --wait \
  --stream logs
```

Stage 2+ (пока каркас, вызывает Stage 1):

```bash
ai-kod run (project-analyse)/research-analyse \
  -i workflows/local.inputs.sample.yaml \
  --wait \
  --stream logs
```

---

## 🧾 Где искать результаты (task workspace) 🗂️

Каждый запуск создаёт задачу `TASK-...` в `AI_KOD_ROOT/workspaces/…`.

Типичные выходы для `research-structure`:
- `TASK/global/analysis/config.runtime.json` — фактический runtime‑конфиг прогона.
- `TASK/global/analysis/exports/*.json` — выгрузки сущностей/связей/метрик/интеграций.
- `TASK/global/reports/structure.md` — Markdown‑отчёт.
- `TASK/global/shared/research-structure/shared-resources/analysis.db` — shared SQLite база.

Подсказка: root можно получить так:

```bash
ROOT="$(ai-kod env path)"
ls -la "$ROOT/workspaces"
```

---

## 🧹 Утилиты очистки 🧽

```bash
# очистить демо-артефакты (внутри bundle demo)
pnpm tsx scripts/clean-structure-workflow.ts

# очистить shared ресурсы в конкретном task/global
pnpm tsx scripts/clean-structure-shared.ts --global-root "<путь к TASK-XXX/global>"
```

---

## 🧯 Troubleshooting

### ❌ `Command failed: pnpm exec tsx …`

Почти всегда причина одна: не задан `AI_KOD_PROJECT_ROOT` (или он не указывает на pnpm workspace).

```bash
export AI_KOD_PROJECT_ROOT=/Users/deksden/Documents/_Projects/ai-kod
```

### ❌ `sqlite3: command not found` / `analysis.db was not created`

- Установи `sqlite3` (CLI) в систему и повтори запуск.

### ❌ “Поменял workflow, но рантайм как будто не видит правки”

Если bundle установлен link‑ом — правки должны подхватываться сразу. Если нет:
- переустанови: `ai-kod bundles install /ABS/PATH/... --name project-analyse --force`
- или сделай “жёсткий” рефреш окружения: `ai-kod env set dev`

### ❌ “Workflow ambiguous” при `ai-kod run research-structure`

Это означает, что одинаковый `workflowId` есть в нескольких бандлах. Используй namespaced вызов:

```bash
ai-kod run (project-analyse)/research-structure -i ...
```
