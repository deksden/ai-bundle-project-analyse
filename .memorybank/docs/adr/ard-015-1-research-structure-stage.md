---
file: .memorybank/docs/adr/ard-015-1-research-structure-stage.md
description: 'Источник: ARD-015-1 — спецификация Stage 1 (research-structure) для ADR-015'
purpose: 'Хранить первичный ARD текст рядом с bundle; использовать как контракт Stage 1 при изменениях workflow/scripts'
version: 1.0.0
date: 2025-12-17
status: ACTIVE
c4_level: documentation
tags: [ard, adr-015, stage-1, research-structure, source]
parent: .memorybank/docs/adr/index.md
related_files:
  - .memorybank/docs/workflows/research-structure.md
  - .memorybank/docs/workflows/adr-015-implementation-map.md
history:
  - version: 1.0.0
    date: 2025-12-17
    changes: Copied from ai-kod `.protocols/ARD-015-1-research-structure-stage.md`.
---
# ARD-015-1 — Первая стадия ADR‑015: Research/Structure‑Only (с БД)

Статус: Draft  
Дата: 2027-04-08  
Автор: AI‑KOD Team

## 🎯 ADR‑style Summary

- Context: Требуется реализовать первую фазу ADR‑015 — «ресёрч структуры» без аспектов, уже включающую детерминированное извлечение кода (tree-sitter+jsdoc), агентное извлечение документации, таблицы raw/doc_matches и CLI для инспекции данных.
- Problem Statement: Нельзя запускать «монстр‑воркфлоу». Нужны утилиты-скрипты, которые можно тестировать изолированно (unit/integration), и один workflow для сборки результата. Должны поддерживаться fail‑fast валидации, простая DX, воспроизводимость и ability to diff raw таблиц.
- Decision: Сделать bundle с расширенным набором скриптов (init/index/remarks/extract-code/extract-docs/match-docs/write/compact/clean/enrich/export/report/finalize) и CLI-командами (`structure:code-process`, `structure:doc-matches`). Всё тестируется через unit+integration, плюс E2E на фикстуре.
- Consequences: Получаем стабильный «снимок структуры» (JSON + .md отчёт + doc_matches), лог `code-process.json` и CLI-команды для ревью. Результат отражает как код, так и документацию, очищается по хэшам и готов для следующих стадий ADR‑015.

---

## 🧱 Scope (границы)
- Включено: C4‑хребет (System/Domains/Containers/Components/Units), слои (Layers), вертикали (Slices), интеграции (ExternalSystem/DataStore/Queue/Stream/APIEndpoint/Workflow), ремарки v1 (FS‑привязка), SQLite/WAL, инкрементальность по `file_index` и git‑diff, детерминированное извлечение кода (tree-sitter + jsdoc), агентное извлечение документации, таблицы `raw_code_entities`/`raw_doc_entities`/`doc_matches`, CLI `structure:*`, экспорты JSON + .md отчёт, global summary.
- Исключено: аспектный анализ (security/perf/etc.), diff‑отчёты, remediation/PR, сложные доменные модели (DDD агрегаты), полные JSON Schema контрактов, продвинутый статанализ.

---

## 📦 Bundle структура (фактическое состояние)

```
bundle/
  .kod/
    manifest.json
  analysis/
    config.json            # { db_path, repo_root: "{{ project_root }}", options: { WAL, busy_timeout } }
    analysis.db            # создаётся при первом запуске
    code-process.json      # журнал tree-sitter прохода
    doc-matches.json       # экспорт таблицы doc_matches
  scripts/
    init-db.ts
    index-files.ts
    prepare-remarks.ts
    extract-code-tree.ts   # tree-sitter + jsdoc, пишет raw_code_entities
    extract-docs-agent.ts  # детерминированный Markdown парсер + агент
    match-docs-to-code.ts  # заполняет doc_matches/doc_match_conflicts
    write-to-db.ts
    compact-db.ts
    clean-by-hash.ts       # очищение сущностей по content_hash
    enrich-links.ts
    export-snapshot.ts
    export-doc-matches.ts
    generate-structure-report.ts
    finalize-run.ts
    run-workflow.ts
    run-structure-cli.ts    # Новая CLI-обёртка для запуска через @ai-kod/cli
  workflows/
    research-structure.yaml # Обновлена: кавычки вокруг путей, безопасная передача JSON
  README.md
```

### Дополнительно (не было в исходном решении)

```
examples/research-structure-demo/
  README.md
  docs/
    ADR-001-current.md
    ADR-999-legacy.md
  apps/
    api/src/index.ts
    worker/src/index.ts
    reporting/src/aggregator.ts
  services/cron/job.ts
  configs/queue.yaml
  workflows/monitor.yaml
  infrastructure/terraform/main.tf
  ingest.jsonl
  remarks.json
  analysis/.gitkeep
```

Manifest/analysis config остались по плану; bundle теперь снабжён демонстрационным проектом и входными данными.

Manifest: loader поднимается от `workflows/*.yaml` к корню bундела и находит `.kod/manifest.*`. В `defaults.params` можно указать локальные значения (override через inputs).

---

## 🧩 Inputs/Outputs/Параметры (факт)

- Inputs:
  - `project_root` — обязателен, абсолютный путь.
  - `run_id` — обязателен (CLI генерирует `structure-YYYYMMDDHHMM`).
  - `ingest_path` — путь до JSONL (теперь передаём абсолютный внутри CLI).
  - `remarks` — массив объектов (CLI считывает `remarks.json` и подставляет напрямую).
  - `db_path`, `outputs_dir`, `git_sha` — настройки местоположения БД и артефактов.
  - `code_lane.languages` — whitelist языков для tree-sitter (по умолчанию `["ts","tsx","js","jsx","go","py"]`), задаётся через inputs.
  - `docs_lane.mode` — `deterministic` (только Markdown парсеры) или `agent` (LLM + parser); default `agent`.
- Engine: по умолчанию `analysis-default`; для реального GLM используется системная настройка (см. `.env.glm`).
- Outputs:
  - Global: `outputs.global.structure_summary`, `analysis/global/structure/snapshot.json`, `outputs.global.doc_matches`.
  - Экспорты: `analysis/exports/*.json` (entities, relationships, coverage, metrics, external-systems, endpoints, queues, doc-matches) + zip для CLI.
  - Логи: `analysis/code-process.json` (tree-sitter проход), `analysis/doc-matches.json`, `analysis/reports/structure.md`.
  - SQLite таблицы: `raw_code_entities`, `raw_doc_entities`, `doc_matches`, `doc_match_conflicts`, `structure_clean_log` заполнены; `structure_cli_runs` отражает вызовы CLI.
  - Все артефакты складываются внутрь `examples/research-structure-demo/analysis/` при запуске команды `bundle:structure`.

---

## 🛠 Скрипты и их контракт (CLI)
Актуальный список (см. выше) дополнен `run-structure-cli.ts`, который:
- читает демо-входные данные (`ingest.jsonl`, `remarks.json`);
- создаёт временный inputs-файл;
- выполняет `pnpm --filter @ai-kod/cli exec -- ai-kod run research-structure --wait --stream events --verbosity steps`.
Общие флаги: `--project_root`, `--db_path`, `--run_id`, `--prev_run_id?`, `--git_sha?`, `--outputs_dir`, `--remarks_json?` (только для prepare‑remarks), `--ingest_path?` (только для write‑to‑db).

1) `init-db.ts`
- Создаёт/открывает SQLite, PRAGMA: WAL, busy_timeout, synchronous=NORMAL.
- Создаёт таблицы: `runs, file_index, ingest_log, raw_code_entities, raw_doc_entities, doc_matches, doc_match_conflicts, structure_clean_log, structure_cli_runs, entities, relationships, layers, slices, remarks, remark_applies, evidence, reports`.
- DoD: повторный запуск идемпотентен, все таблицы и индексы на месте.

2) `index-files.ts`
- Индексирует `project_root`: doc (`**/*.md`), code (`**/*.{ts,js,tsx,jsx,py,go,rs}` конфигурируемо), config (`**/*.{yaml,yml,json}`) — записывает `file_index(path, hash, size, kind)`.
- При наличии git — сохраняет `git_sha` и список changed файлов для run.
- DoD: корректные counts, детерминированные hash, игнор системных папок (`node_modules`, `.git`, `dist`, `build`).

3) `prepare-remarks.ts`
- Читает JSON из `inputs.remarks`/`--remarks_json`, нормализует path относительно `project_root`, валидирует.
- UPSERT в `remarks` по `remark_key = sha256(path+scope+recursive+normalize(text))`.
- Рассчитывает `remark_applies(remark_id, file_path)` по правилам scope/recursive/glob.
- Экспортирует `global/remarks/remarks.json`, `global/remarks/applies/<id>.json`, агрегат `global/remarks_context.json`.
- DoD: для каждой ремарки посчитан `affected_files_count` (>0 или предупреждение), записан `remarks_summary`.

4) `extract-code-tree.ts`
- Обходит файлы из `file_index(kind="code")` в пределах whitelist языков, запускает tree-sitter (TS/JS/Go/Python) и jsdoc-парсер.
- Нормализует каждый символ (module/class/function) → `symbol_path`, `signature_hash`, `jsdoc_text`, `metadata`.
- Пишет `analysis/code-process.json` (перечень файлов, грамматика, `content_hash`, ошибки) и batch вставки в `raw_code_entities`.
- DoD: количество записей совпадает с количеством разобранных символов, `content_hash` совпадает с `file_index.hash`.

5) `extract-docs-agent.ts`
- Парсит Markdown/MBB/ADR (детерминированным парсером) и запускает агента (`docs_lane.mode=agent`) для резюмирования разделов.
- Формирует `raw_doc_entities` с `heading_fqn`, `summary_md`, `anchors`, `doc_hash`, а также `mentions[]` (интеграции, CLI, таблицы raw) — эти данные далее превращаются в `ExternalSystem`/`Interface`.
- Сохраняет промежуточный `docs-ingest.jsonl` (используется `write-to-db` для журнала).
- DoD: каждая секция ≥ 200 символов попала в таблицу, агентные ошибки логируются и не блокируют процесс.

6) `match-docs-to-code.ts`
- Сравнивает `raw_doc_entities` и `raw_code_entities` по `stable_key`, `signature_hash`, embedding.
- Записывает `doc_matches(doc_key, code_key, match_kind, confidence, evidence)` и `doc_match_conflicts`.
- Генерирует `analysis/doc-matches.json` для CLI/QA.
- DoD: `coverage_status` обновляется (DOC_AND_CODE/OUTDATED), конфликты доступны в CLI.

7) `write-to-db.ts`
- Валидирует `ingest.jsonl` (строгие строки JSON) для дополнительных источников (например, tech discovery).
- UPSERT в `ingest_log` и распределяет payload в `raw_code_entities/raw_doc_entities` при необходимости (fallback канал).
- DoD: некорректные строки → error, корректные → pending, метрики в логах.

8) `compact-db.ts`
- Объединяет doc↔code по `stable_key`, выставляет `coverage_status` и `confidence` с учётом `doc_matches`, применяет ремарки (приоритетные инструкции); фиксирует `applied_remarks` в `evidence`.
- Обновляет `entities, relationships, layers, slices`; создаёт записи о внешних системах/интерфейсах.
- DoD: после компакта есть ≥1 Container, ≥1 запись `DOC_AND_CODE ∪ CODE_ONLY`, doc_matches обработаны.

9) `clean-by-hash.ts`
- Сравнивает `raw_*` и `structure_entities` по `content_hash`. Удаляет сущности без подтверждённого `content_hash` в двух последних запусках, логирует в `structure_clean_log`.
- DoD: исчезнувшие файлы → сущности удалены, лог содержит `entity_key`, `reason=missing_file|hash_changed`.

10) `enrich-links.ts`
- Связи doc↔code (frontmatter/JSDoc @see/@docs), OUTDATED detection по датам/commit, дополнительно связывает doc_matches → `docs_reference`.
- DoD: наличие `docs_reference`/`code_reference`, отмеченные OUTDATED и `doc_match_conflicts`.

11) `export-snapshot.ts`
- Экспортирует JSON: entities/relationships/coverage/metrics/external-systems/endpoints/queues/doc-matches.
- Пишет `global/structure/snapshot.json`, `outputs.global.structure_summary`, `outputs.global.doc_matches`.
- DoD: все файлы существуют, поля соответствуют минимальной схеме ADR‑015, количество doc_matches совпадает с таблицей.

12) `export-doc-matches.ts`
- Формирует человеко-читаемый `analysis/reports/doc-matches.md` (группировка по container, статусы `missing`, `outdated`, `confirmed`).
- DoD: все контейнеры присутствуют, конфликты подсвечены.

13) `generate-structure-report.ts`
- Создаёт `analysis/reports/structure.md`: Containers/Components, coverage, ExternalSystems, Queues, Endpoints, секция «Remarks influence», блок «Doc coverage».
- DoD: файл создан, содержит ключевые разделы, цифры бьются с JSON.

14) `finalize-run.ts`
- Закрывает run: пишет `runs.finished_at`, пути отчётов в `reports`, отправляет события; регистрирует CLI вызов (`structure_cli_runs`).
- DoD: run завершён, события отправлены, CLI аудит записан.

---

## 🧭 Workflow: `workflows/research-structure.yaml`
- inputs: `project_root` (required), `remarks` (optional []), `code_lane.languages?`, `docs_lane.mode?`.
- engine_profile: `analysis-default`.
- stages (порядок):
  1) **prepare** — attach bundle, validate inputs по 0090, init-db, index-files, prepare-remarks.
  2) **fan-out**:
     - `structure-code` (lane `code`): запускает `extract-code-tree.ts`, пишет `raw_code_entities`, `analysis/code-process.json`, публикует событие `structure_code_ingested`.
     - `structure-doc` (lane `docs`): запускает `extract-docs-agent.ts` в `agent` или `deterministic` режиме, формирует `raw_doc_entities` и `docs-ingest.jsonl`, событие `structure_doc_ingested`.
  3) **fan-in**: `match-docs-to-code` объединяет lanes, фиксирует `doc_matches`, событие `structure_doc_matches_ready`.
  4) **post-processing**: write-to-db (fallback ingestion) → compact-db → clean-by-hash → enrich-links → export-snapshot → export-doc-matches → generate-structure-report → finalize-run.
- validation_rules (0090):
  - `project_root` существует и читаем;
  - после compact: `Containers >= 1`, `(DOC_AND_CODE ∪ CODE_ONLY) > 0`;
  - `doc_matches` покрывают ≥ 70% контейнеров (конфигурируемо via `min_doc_coverage`);
  - сырьевые таблицы не пусты (`raw_code_entities` > 0, `raw_doc_entities` > 0) иначе workflow завершает работу с ошибкой.
- события: `bundle_detected|attached|db_opened|remarks_added|structure_code_ingested|structure_doc_ingested|structure_doc_matches_ready|structure_compacted|doc_matches_exported|report_generated|run_finalized`.

---

## 🧠 Извлекаемые структуры (минимум)
- C4: `System`, `Domain/Context`, `Container`, `Component`, `Unit`.
- Слои (Layers): `Presentation`, `Application`, `Domain`, `Infrastructure`.
- Срезы (Slices): `Workflow Execution`, `Observability`, `Security`, `API`, `CLI`.
- Интеграции: `ExternalSystem`, `DataStore`, `Queue/Stream`, `Interface/APIEndpoint`, `Workflow`/Jobs.
- Связи: `contains`, `uses/depends_on`, `communicates_with`, `implements`, `belongs_to_layer`, `belongs_to_slice`, `docs_reference`, `code_reference`.

Эвристики — см. ADR‑015 §5.3 (дублировать здесь коротко не требуется).

## 🗄️ SQLite ожидания и мониторинг
- Таблицы `raw_code_entities` и `raw_doc_entities` должны содержать `run_id`, `source_path`, `stable_key`, `content_hash`, `metadata_json`; индексы по `(run_id, stable_key)` и `content_hash`.
- `doc_matches` и `doc_match_conflicts` обязаны сохранять `match_kind (exact|fuzzy|outdated)` и `confidence`. `coverage.json` читает эти таблицы напрямую, поэтому нарушение схемы ломает отчёты.
- `structure_clean_log` ведёт историю удаления сущностей. Каждая запись содержит `entity_key`, `reason`, `content_hash`, `deleted_run_id`. CLI `structure:code-process --show-clean` читает именно эту таблицу.
- `structure_cli_runs` хранит `command`, `args`, `git_sha`, `executed_at`. Любая новая CLI команда должна регистрироваться через `run-structure-cli.ts`.

---

## 📝 Remarks v1 (коротко)
- FS‑привязка обязательна: `path` + `scope: file|dir|glob` + `recursive?` для dir.
- Свободный текст — «Priority user guidelines» (агент обязан учитывать).
- `prepare-remarks`: валидация → UPSERT → `remark_applies` → экспорт `global/remarks_context.json`.
- Evidence: шаги пишут `applied_remarks: [remark_id...]`.
- Feedback: `outputs.global.remarks_summary[{ id, path, scope, recursive, affected_files_count }]`.

---

## ♻️ Инкрементальность
- `runs.prev_run_id` + `git diff -M` или сравнение `file_index` (fallback), вычисление A/M/D.
- changed‑only ingestion для docs/code; обработка удалений; impacted‑расширение на 1 уровень (родитель/дети, ключевые связи).
- partial compact для changed+impacted set.
- fallback на полный прогон, если изменено > threshold (30–50%).

---

## 🔎 Тест‑план

### Unit (скрипты)
- init-db: схема, идемпотентность.
- index-files: индексация, хэши, фильтры ignore.
- prepare-remarks: нормализация путей, glob, recursive, расчёт applies, экспорт.
- write-to-db: валидация ingest.jsonl, UPSERT.
- compact-db: coverage/confidence, базовый merge doc↔code, evidence applied_remarks.
- enrich-links: doc↔code ссылки, OUTDATED.
- export-snapshot: структура JSON и минимальные поля.

### Integration/E2E
- unit и integration тесты остались (Vitest).
- e2e: `bundle/tests/research-structure.e2e.test.ts` — прогон по фикстуре внутри `bundle/tests/fixtures/...`.
- Новый процесс: для реального агента предусмотрена команда `pnpm bundle:structure`, которая запускает workflow на демонстрационном проекте, не требуя захода внутрь тестовых каталогов.

---

## ✅ Чек‑лист реализации (DoD)
1) Bundle структура создана; manifest и config валидны.
2) Скрипты реализованы; unit‑тесты зелёные.
3) Интеграционный тест с реальной SQLite зелёный.
4) `workflows/research-structure.yaml` работает локально (таймауты заданы, inputs валидируются).
5) Экспорты JSON и `structure.md` создаются; `outputs.global.structure_summary` заполнен.
6) Ремарки из inputs сохраняются, рассчитан applies, контекст экспортирован, evidence шагов фиксирует `applied_remarks`.
7) Инкрементальность: повторный прогон обрабатывает только изменённые файлы (или уходит в fallback при большом diff).
8) События и логи содержат counts/elapsed; ошибки (валидации/ingest) читаемые.

---

## ⚠️ Риски и смягчения
- Слишком широкие ремарки (поражают тысячи файлов) → предупреждение в отчёте + событие; лимит по умолчанию 5000.
- Неоднозначные эвристики слоёв/срезов → оставляем как best‑effort, позже покрываем аспектами/ремарками.
- Git недоступен → fallback на `file_index` сравнение (медленнее, но надёжно).
- SQLite contention → WAL + busy_timeout, последовательная запись, очистка `ingest_log` после компакта.

---

## 🔮 Open Questions (актуализация)
- Дополнительные языки/маски: можно расширять через манифест без изменения кода (`analysis/config.json` или будущие overrides).
- Пороговые валидации внешних систем: пока остаёмся на soft‑валидаторах (coverage + remarks). Возможное развитие — отдельный аспект.
- Нужно ли расширять демо‑проект? Пока покрывает основные сценарии (confirmed/code-only/doc-only); дальнейшее развитие зависит от аспектных стадий.

---

- **Новая команда**: `pnpm bundle:structure` (добавлена в `package.json`).  
  Поддерживает запуск от корня проекта; автоматически использует демо-проект:
  ```
  pnpm bundle:structure
  # -> внутри выполняется:
  #    ai-kod run research-structure --inputs <tmp-file> --wait --stream events --verbosity steps
  # Артефакты: examples/research-structure-demo/analysis/**
  ```
- **Документация**: подготовлена `.memory-bank/commands/wf-structure.md` с пошаговой инструкцией.

---

## 📘 Финализированная архитектура (обновлено 03.11.2025)

> Сводка договорённостей из протокола `0098-research-structure-extraction`.  
> Отражает финальную цель для следующего этапа разработки.

### A. Общий blueprint workflow

```
start → init-db → index-files → prepare-remarks
                ↘
                 parallel
                   ├─ doc-file-list → doc-fanout (agent per file) → doc-merge
                   └─ code-file-list → code-fanout (agent per file) → code-merge
                 ↘
               merge-structure (doc+code JSONL)
               ↘
clear-and-write-raw → compact-db (создаёт result) → enrich-links → export-snapshot → generate-structure-report → finalize-run
```

- Fan-out шаги порождают **raw** JSON/JSONL артефакты по каждому файлу.
- `merge-structure` объединяет doc+code результаты, формирует JSONL для дальнейшей загрузки (`entities_raw.jsonl`, `relationships_raw.jsonl`, `layers_raw.jsonl`, `slices_raw.jsonl`, `evidence_raw.jsonl`, `external_systems_raw.jsonl`, `queues_raw.jsonl`).
- `clear-and-write-raw` удаляет старые raw записи текущего `taskId`, вставляет новые и фиксирует `origin`, `source_path`, `hierarchy`, `remarks_applied`, `confidence`, `reason`.
- `compact-db` агрегирует raw → `result`, создаёт `entity_derivations`/`relationship_derivations`, считает coverage и confidence.
- Остальные стадии работают только с `status='result'`.

### B. Спецификация агента (doc/code)

- Агент получает:
  - файл (содержимое);
  - структуру директорий вокруг файла;
  - REMARKs, относящиеся к пути;
  - системный контекст (`project_root`, git SHA, доп. hints).
- Выход:
  - `output.yaml` (статус, ссылки на JSON, counts, применённые REMARKs);
  - одна или несколько JSON коллекций:
    ```json
    {
      "id": "container-api-gateway",
      "type": "Container",
      "name": "API Gateway",
      "status": "raw",
      "origin": "code",
      "source_path": "apps/server/src/index.ts",
      "hierarchy": ["apps", "api"],
      "layers": ["external-interface"],
      "slices": ["workflow-execution"],
      "remarks_applied": ["remark-legacy-docs"],
      "confidence": 0.8,
      "reason": "Top-level service exposing REST endpoints",
      "evidence": [
        { "text": "createApiGateway()", "line": 12, "description": "Entry point for external traffic" }
      ],
      "metadata": { "imports": ["express"], "hints": { "folder": "apps/server" } }
    }
    ```
- **doc-анализ**: в первую очередь извлекает описание System/Domain/Container, внешних акторов, бизнес-контракти. REMARKs помогают подсветить подтверждённые элементы.
- **code-анализ**: строит контейнеры по каталогам (`apps/`, `services/`, `packages/`), фиксирует компоненты/units, внешние зависимости (imports, config), вертикальные срезы и layer hints.

### C. SQLite модель (raw/result)

- Каждая основная таблица (`entities`, `relationships`, `layers`, `slices`, `evidence`) имеет поля:
  - `status` (`raw`, `result`, `archived`);
  - `origin`, `source_path`, `hierarchy`, `remarks_applied`, `confidence`, `reason`, `metadata JSON`, `created_at`, `updated_at`.
- Дополнительно:
  - `entity_derivations(result_entity_id, raw_entity_id, description)`;
  - `relationship_derivations(result_relationship_id, raw_relationship_id, description)`.
- Алгоритм:
  1. `clear-and-write-raw`: удаляет raw для `taskId`, вставляет новые raw записи.
  2. `compact-db`: группирует raw (по `(type, canonical_name, hierarchy)`), создаёт result, записывает связи в derivations, обновляет `coverage_summary`, `run_metrics`.
  3. `enrich-links`: дополняет `metadata.analysis` (doc↔code references, OUTDATED/UNCONFIRMED).

### D. Контрольные проверки и мониторинг

- Workflow останавливается, если:
  - после merge нет raw сущностей класса Container;
  - `compact-db` не создал ни одной result записи;
  - coverage < 1 контейнера / отсутствует evidence.
- В `wf-structure.md` и `structure-audit.ts` фиксируем требования к ретраям: `STEP_FAILED` → `STEP_RERUN_REQUESTED` → финальный статус + артефакты.

### E. План внедрения

1. Зафиксировать спецификации (протокол `0098`), подготовить документацию.
2. Реализовать ingestion raw + derivations (под фичeflag).
3. Добавить doc/code fan-out и merge-structure.
4. Перевести compact/enrich/export на работу с raw/result.
5. Отказаться от статичного `ingest.jsonl`, обновить Memory Bank, README, workflow инструкции.
6. Раскатить новую схему, обучить команду, активировать в CI (unit + e2e тесты).

---

**Итог:** документ фиксирует дизайн и критерии приёмки первой стадии ADR‑015. Реализация идёт малыми шагами: сначала скрипты + unit, затем интеграция с SQLite, затем один workflow и mini‑E2E на фикстуре. Такой подход гарантирует воспроизводимость, простую отладку и быстрый выход к полезному артефакту — достоверной «карте» проекта.
