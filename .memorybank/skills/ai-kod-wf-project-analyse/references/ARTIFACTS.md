---
name: wf-project-analyse-artifacts
description: "Артефакты project-analyse: где искать outputs/report/db и что важно сохранять при расследовании"
---

# ARTIFACTS

## Где лежат результаты

Все результаты живут внутри `AI_KOD_ROOT/workspaces/<TASK_ID>/...`.

Root можно получить так:

```bash
ROOT="$(ai-kod env path)"
```

## Ключевые артефакты Stage 1 (research-structure)

Внутри task workspace (типичные места, зависят от реализации):
- `TASK/global/analysis/config.runtime.json` — runtime‑конфиг.
- `TASK/global/analysis/exports/*.json` — выгрузки.
- `TASK/global/reports/structure.md` — итоговый отчёт.
- `TASK/global/shared/research-structure/shared-resources/analysis.db` — SQLite база (shared).

## Что сохранять при расследовании

Минимальный набор:
- `ai-kod task TASK-XXXX show --json`
- `ai-kod task TASK-XXXX steps --json --verbosity steps`
- `output.yaml` + `_context.json` проблемного шага (`ai-kod files get …`)
- срез логов `ai-kod logs tail --task-id TASK-XXXX --duration 30s --jsonl`

