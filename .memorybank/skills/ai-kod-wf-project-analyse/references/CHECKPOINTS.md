---
name: wf-project-analyse-checkpoints
description: "Контрольные точки project-analyse: ожидаемые стадии research-structure/research-analyse и признаки отклонений"
---

# CHECKPOINTS — контрольные точки

## `(project-analyse)/research-structure` — ожидаемый набор стадий

Ожидаемые stage id (все должны появиться в `task steps`):

```
start
lanes-parallel-start
code-prepare
code-dispatch
code-process-file
code-collect
code-summary
docs-prepare
docs-dispatch
docs-process-file
docs-collect
docs-summary
lanes-parallel-end
code-persist
lanes-summary
final-report
```

## Ключевые чекпоинты по смыслу

1) **start (bootstrap)**
   - Созданы workspace файлы: `code-files.json`, `doc-files.json`, `folder-tree.json`, `output.yaml`.
   - В `output.yaml` есть `db_checks` (sqlite_version/tables/indexes/run_registered) и базовые `metrics`.

2) **code-prepare / docs-prepare**
   - Создан `fanout/*-items.json` и `output.yaml`.
   - Количество элементов fanout > 0 (если проект не пустой).

3) **code-process-file / docs-process-file**
   - Fanout реально исполняется (появляются steps с разными `stepId`).
   - Ошибки на отдельных ветках — отклонение, требующее расследования (см. TROUBLESHOOT).

4) **code-collect / docs-collect**
   - Собраны результаты веток (появляются агрегированные файлы/artefacts).

5) **code-persist**
   - Появляется `analysis/code-ingest.jsonl` (или аналог) и лог write-to-db.
   - В случае `database is locked` возможны retry — фиксировать как отклонение (но workflow может сам восстановиться).

6) **final-report**
   - Создан `global/reports/structure.md` в task workspace.
   - Есть итоговый `output.yaml` со статусом success.

## `(project-analyse)/research-analyse` (skeleton)

Ожидание сейчас минимальное:
- stage `structure` успешно завершает `wcall` в Stage 1;
- stage `analyse` создаёт `output.yaml` (placeholder).

## Что считать отклонением

- Любая стадия в `running/suspended` слишком долго без прогресса.
- Ошибка `ambiguous workflow` при запуске без `(project-analyse)/...`.
- Падения из-за отсутствия `pnpm/tsx/sqlite3` или не выставленного `AI_KOD_PROJECT_ROOT`.
- Массовые ошибки веток fanout (особенно сразу на `code-process-file`/`docs-process-file`).
- Не создан `global/reports/structure.md` после `final-report`.

