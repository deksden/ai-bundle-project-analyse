---
name: wf-project-analyse-troubleshoot
description: "Типовые проблемы project-analyse: pnpm/tsx/sqlite3, AI_KOD_PROJECT_ROOT, ambiguous workflow, database locked"
---

# TROUBLESHOOT

- **`Workflow \"X\" is ambiguous`** при `ai-kod run research-structure`  
  ➜ Всегда запускай namespaced: `ai-kod run (project-analyse)/research-structure ...`

- **`Command failed: pnpm exec tsx ...` / `pnpm` не найден / `tsx` не найден**  
  ➜ Проверь `AI_KOD_PROJECT_ROOT` и наличие `pnpm-workspace.yaml` в нём.  
  ➜ Проверь, что в этом workspace есть `tsx` (иначе `pnpm exec tsx` упадёт).

- **`sqlite3: command not found` / `analysis.db was not created`**  
  ➜ Нужен `sqlite3` CLI в PATH.

- **`database is locked` (SQLite)**  
  ➜ Возможны встроенные retry в persist/collect; фиксируй как отклонение.  
  ➜ Если lock не проходит: проверь, что нет параллельных запусков того же workflow и что shared DB не открыта другим процессом.

- **“Поменял bundle, но изменения не подхватились”**  
  ➜ Если ставил из git — переустанови (или bump version).  
  ➜ В dev: `ai-kod bundles install /ABS/PATH/... --name project-analyse --force`.

- **Stage 2 (`research-analyse`) падает на LLM стадии**  
  ➜ Это ожидаемо, если нет настроенного engine provider. Для быстрой проверки используй Stage 1 (`research-structure`).

