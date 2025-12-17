---
name: wf-project-analyse-run
description: "Запуск project-analyse: выбор окружения dev/prod, установка bundle (local link vs git copy), запуск research-structure/research-analyse и базовый мониторинг"
---

# RUN — запуск `project-analyse`

## 0) Выбрать окружение (data root)

Окружения переключаются командой (она же перезапускает runtime в нужном root):

```bash
ai-kod env set dev
# или
ai-kod env set prod
```

Проверить:

```bash
ai-kod env show
ai-kod env path
```

## 1) Проверить, что runtime поднят

```bash
ai-kod redis status
ai-kod server status
ai-kod workers runtime status
```

Если Redis локальный и не поднят:

```bash
ai-kod redis setup
```

## 2) Выставить обязательный `AI_KOD_PROJECT_ROOT`

Stage 1 запускает TS‑скрипты через `pnpm exec tsx …`. Для этого нужен pnpm workspace:

```bash
export AI_KOD_PROJECT_ROOT=/ABS/PATH/ai-kod
```

## 3) Установить bundle

### Вариант A (dev): локальный путь (link)

```bash
ai-kod bundles install /ABS/PATH/ai-bundle-project-analyse --name project-analyse --force
```

### Вариант B (prod-test): git (copy)

```bash
ai-kod bundles install deksden/ai-bundle-project-analyse@main --name project-analyse
```

Проверка:

```bash
ai-kod bundles list
ai-kod workflows info (project-analyse)/research-structure
```

## 4) Подготовить inputs и запустить workflow

Рекомендуется использовать **абсолютный** `project_root`.

Если есть готовый шаблон inputs в bundle‑репо:

```bash
ai-kod run (project-analyse)/research-structure \
  -i /ABS/PATH/ai-bundle-project-analyse/workflows/local.inputs.sample.yaml.example \
  --wait \
  --stream logs
```

Если хочешь Stage 2+ (skeleton):

```bash
ai-kod run (project-analyse)/research-analyse \
  -i /ABS/PATH/ai-bundle-project-analyse/workflows/local.inputs.sample.yaml.example \
  --wait \
  --stream logs
```

## 5) Базовый мониторинг

Сразу после старта сохрани `task_id` из вывода `ai-kod run` (в human он печатается; в json — поле `taskId`/`task.id`).

```bash
ai-kod task TASK-XXXX show
ai-kod task TASK-XXXX steps --verbosity steps
```

Если появились отклонения — см. `TOOLS.md` и `TROUBLESHOOT.md`.

