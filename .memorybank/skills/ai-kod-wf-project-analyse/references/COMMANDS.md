---
name: wf-project-analyse-commands
description: "Готовые команды для запуска/мониторинга project-analyse (install/run/status/logs/files)"
---

# COMMANDS

## Переключить окружение

```bash
ai-kod env set dev
ai-kod env show
```

## Поднять/проверить runtime

```bash
ai-kod redis status || ai-kod redis setup
ai-kod server status
ai-kod workers runtime status
```

## Установить bundle (dev: link)

```bash
export AI_KOD_PROJECT_ROOT=/ABS/PATH/ai-kod
ai-kod bundles install /ABS/PATH/ai-bundle-project-analyse --name project-analyse --force
```

## Установить bundle (prod-test: git copy)

```bash
export AI_KOD_PROJECT_ROOT=/ABS/PATH/ai-kod
ai-kod bundles install deksden/ai-bundle-project-analyse@main --name project-analyse
```

## Запуск Stage 1

```bash
ai-kod run (project-analyse)/research-structure \
  -i /ABS/PATH/ai-bundle-project-analyse/workflows/local.inputs.sample.yaml.example \
  --wait \
  --stream logs
```

## Мониторинг задачи

```bash
ai-kod task TASK-XXXX show --json
ai-kod task TASK-XXXX steps --json --verbosity steps
ai-kod logs tail --task-id TASK-XXXX --duration 30s --jsonl
```

## Скачать артефакты проблемного шага

```bash
ai-kod files get TASK-XXXX STEP-YYYY output.yaml --out /tmp/output.yaml --force
ai-kod files get TASK-XXXX STEP-YYYY _context.json --out /tmp/_context.json --force
```

