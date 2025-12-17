---
name: wf-project-analyse-tools
description: "Инструменты наблюдения: status/steps/logs/files для расследования запусков project-analyse"
---

# TOOLS

## Статус систем

```bash
ai-kod server status
ai-kod workers runtime status
ai-kod workers list --json
```

## Мониторинг задачи

```bash
ai-kod task TASK-XXXX show --json
ai-kod task TASK-XXXX steps --verbosity steps --json
```

Срез логов задачи (быстро и дёшево по контексту):

```bash
ai-kod logs tail --task-id TASK-XXXX --duration 30s --jsonl
```

## Просмотр артефактов шага

```bash
ai-kod files list TASK-XXXX STEP-YYYY --json
ai-kod files get TASK-XXXX STEP-YYYY output.yaml --out /tmp/output.yaml --force
ai-kod files get TASK-XXXX STEP-YYYY _context.json --out /tmp/_context.json --force
```

## Быстро найти workspace на диске

```bash
ROOT="$(ai-kod env path)"
ls -la "$ROOT/workspaces" | tail
```

