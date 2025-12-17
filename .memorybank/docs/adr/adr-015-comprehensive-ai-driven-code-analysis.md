---
file: .memorybank/docs/adr/adr-015-comprehensive-ai-driven-code-analysis.md
description: 'Источник: ADR-015 — комплексная методология AI-анализа кода (research → aspect runs)'
purpose: 'Хранить первичный ADR текст рядом с bundle; использовать как основу для дизайна workflows в этом репозитории'
version: 1.0.0
date: 2025-12-17
status: ACTIVE
c4_level: documentation
tags: [adr, adr-015, source, methodology]
parent: .memorybank/docs/adr/index.md
related_files:
  - .memorybank/docs/workflows/adr-015-implementation-map.md
history:
  - version: 1.0.0
    date: 2025-12-17
    changes: Copied from ai-kod `.protocols/ADR-015-comprehensive-ai-driven-code-analysis.md`.
---
# ADR-015 :: Комплексная методология AI-анализа кода

Статус: Предложено  
Дата: 2025-10-28  
Версия: 2.2

История изменений:
- 2027-04-08 — v2.2: детерминированное извлечение сущностей (tree-sitter + jsdoc), агенты документации, таблицы raw/doc_matches, клиенты CLI.
- 2025-10-28 — v2.1: исследовательский бандл, лейны docs/code, база сущностей и аспектов.

## 1. Контекст и мотивация

Классические линтеры и статический анализ не отвечают требованиям к архитектурной зрелости больших проектов и AI‑сгенерированного кода. Для платформы AI‑KOD нужен воспроизводимый процесс, который:
- формирует достоверную картину системы (структура, внешние зависимости, документация) и обновляет её по мере развития проекта;
- сопоставляет документы и код, подсвечивая зоны без покрытия и расхождения;
- выполняет многоаспектный анализ (архитектура, безопасность, телеметрия, производительность) поверх единой модели знания;
- работает инкрементально, перенося накопленные данные между запусками;
- учитывает обратную связь инженеров (remaks) и повышает уверенность в выводах;
- поставляется в виде бандла, переиспользуемого несколькими workflow в оркестраторе.

## 2. Краткое решение

Основой служит “analysis bundle” — пакет с manifest, скриптами, аспектами, SQLite‑базой и набором workflow. Процесс делится на две фазы:
1. **Ресёрч** (research): извлекаем знания из документации и кода, выявляем внешние технологии, строим C4‑совместимую иерархию и фиксируем покрытие. Пользовательские ремарки вносят корректировки и повышают доверие.
2. **Многоаспектный анализ** (aspect runs): применяем независимые аспекты к сущностям графа, записываем findings, выполняем quality gates и формируем отчёт (актуальное состояние + diff).

Ключевые принципы:
- единый storage — SQLite (WAL) внутри бандла, UPSERT по stable_key, строгая схема;
- ingest через JSON Lines (`ingest.jsonl`) и скрипт‑ингестер с file-lock и retry;
- библиотека аспектов (Markdown + frontmatter) с `scope`, `layers`, `slices`, требованиями к источникам;
- параллельные дорожки `docs` и `code` внутри ресёрча; tech discovery (внешние системы) фиксируется как сущности, а не отдельный лейн;
- система ремарок — пользовательские комментарии, влияющие на confidence и реструктуризацию;
- несколько workflow внутри бандла делят одну инфраструктуру, что улучшает DX и повторяемость;
- task-scoped workspace и `global` переменные (протокол 0093) дают единый namespace для артефактов и состояния шага/WCALL, бандлы монтируются read-only в `bundle/<namespace>`;
- отчёты full/diff, инкрементальный diff по сущностям, события наблюдаемости.

## 3. Идентификаторы, версия и достоверность

- `run_id` — UUID запуска; используется во всех таблицах и событиях.
- `task_id`, `step_id` — айди оркестратора для корреляции логов.
- `stable_key` — стабильный ключ сущности/связи (hash нормализованного идентификатора: тип + путь/имя/сигнатура).
- `confidence` — индекс достоверности 0..1:
  - базовый уровень зависит от источников (`DOC_ONLY` ≈ 0.6, `CODE_ONLY` ≈ 0.7, `DOC_AND_CODE` ≈ 0.85);
  - ремарки `confirm` повышают вес, `reject/disable` снижают;
  - аспекты и автоматические проверки могут увеличивать confidence.
- `coverage_status` — `DOC_ONLY`, `CODE_ONLY`, `DOC_AND_CODE`, `OUTDATED`, `DEPRECATED`.
- `remarks` — пользовательские комментарии (таблица `remarks`): тип (`confirm`, `reject`, `clarify`, `merge`, `split`, `disable`), автор, текст, вес, срок действия. На каждом запуске ресёрча ремарки прикладываются к контексту агентов и пересчитываются.

## 4. Бандл анализа

```
bundle/
  .kod/
    manifest.json
  analysis/
    config.json
    analysis.db
  aspects/
    index.yaml
    *.md
  scripts/
    init-db.ts
    index-files.ts
    write-to-db.ts
    compact-db.ts
    remap-structure.ts
    enrich-links.ts
    analyze-architecture.ts
    compute-diff.ts
    generate-report.ts
    finalize-run.ts
  workflows/
    research.yaml
    aspect-architecture.yaml
    aspect-security.yaml
    report.yaml
  docs/ (опц.)
  templates/ (опц.)
  README.md
```

### 4.1 Manifest (`.kod/manifest.json|yaml`)

```json
{
  "version": "2.0",
  "bundle_id": "analysis-bundle-v2",
  "default_workflow": { "file": "workflows/research.yaml", "id": "analysis-research" },
  "workflows": [
    { "file": "workflows/research.yaml", "id": "analysis-research" },
    { "file": "workflows/aspect-architecture.yaml", "id": "analysis-architecture" },
    { "file": "workflows/report.yaml", "id": "analysis-report" }
  ],
  "workspace_integration": {
    "strategy": "symlink",
    "target": "task",
    "readOnly": true,
    "limits": { "maxFiles": 200, "maxTotalSizeMb": 30 }
  },
  "content_groups": {
    "analysis_tools": {
      "description": "Скрипты ресёрча и нормализации",
      "files": [
        { "src": "scripts/write-to-db.ts", "dst": "tools/write-to-db.ts", "description": "Ингестер JSONL → SQLite" },
        { "src": "scripts/compact-db.ts", "dst": "tools/compact-db.ts", "description": "Нормализация `ingest_log`" }
      ],
      "annotate": true
    },
    "reports": {
      "description": "Инструменты генерации отчётов",
      "files": [
        { "src": "scripts/generate-report.ts", "dst": "tools/generate-report.ts", "description": "Full/diff отчёты" }
      ],
      "annotate": true
    }
  },
  "defaults": { "attach_groups": ["analysis_tools", "reports"] },
  "context": {
    "expose": [
      { "key": "bundle.analysis_tools", "group": "analysis_tools" }
    ],
    "max_inline_bytes": 32768,
    "load_modes": {
      "extensions": { ".md": "text", ".json": "text", ".yaml": "text" }
    }
  }
}
```

- Несколько workflow используют общие скрипты и БД.
- Проверяем безопасность: нормализация путей, запрет `..`, лимиты размеров, whitelist расширений.
- `defaults.attach_groups` автоматически подключает наборы файлов в workspace.
- `defaults.params` позволяет задать типовые значения (например, `project_root`), которые можно переопределить при запуске.
- Workflow используют engine profiles (0091): внутри YAML указывается `engine_profile: analysis-default`, что заменяет legacy поля `executor/provider/profile`.

### 4.2 Конфиг анализа (`analysis/config.json`)

```json
{
  "db_path": "analysis/analysis.db",
  "mode": "rw",
  "repo_root": "../../",
  "git_sha": "<HEAD>",
  "options": {
    "journal_mode": "WAL",
    "busy_timeout_ms": 8000,
    "cache_size": 2000
  }
}
```

`mode`: `rw` — для ресёрча и отчётов, `ro` — для аспектных запусков. `repo_root` нужен для абсолютных путей (индексирование файлов). `options` передаются скриптам.

### 4.3 Параметры запуска

Workflow `workflows/research.yaml` принимает обязательный параметр `project_root` — абсолютный путь к анализируемому репозиторию. При подготовке:
- loader извлекает `inputs.project_root` (или CLI-параметр `--param project_root=/path`) и записывает значение в `analysis/runtime.json`;
- переменная пробрасывается в ENV `ANALYSIS_PROJECT_ROOT` и подставляется в `analysis/config.json` вместо `repo_root`;
- включены правила валидации (протокол 0090): при отсутствии параметра или недоступности директории workflow прерывается с ошибкой.

Пример запуска:
```bash
ai-kod run bundle/workflows/research.yaml \
  --param project_root=/Users/deksden/Documents/_Projects/ai-kod
```

Remarks input (опционально):
- `remarks`: массив объектов c полями `path`, `scope`, `recursive?`, `text`.
- Пример CLI:
  ```bash
  ai-kod run bundle/workflows/research-structure.yaml \
    --param project_root=/repo \
    --param 'remarks=[{"path":"apps/server","scope":"dir","recursive":true,"text":"Не дробить контейнер API"},{"path":"packages/common/src/types.ts","scope":"file","text":"Тип X считать частью домена Navigation"}]'
  ```

### 4.4 CLI и отчёты
- **`ai-kod structure:code-process`** — выводит содержимое `analysis/code-process.json`, подсвечивает файлы со сменой `content_hash` и разницу по грамматике tree-sitter. Используется при ревью PR.
- **`ai-kod structure:doc-matches`** — стриминг таблицы `doc_matches`/`doc_match_conflicts` (флаги `--only-outdated`, `--only-missing`). Позволяет QA/архитектору проверить покрытие документацией до запуска аспектов.
- **`ai-kod structure:export`** — формирует zip из `analysis/exports/*`, global `structure_summary`, `doc-matches.json`. Поддерживает `--changed-only`.
- Все команды читают `analysis/runtime.json` и `global/structure/*`, поэтому CLI можно запускать как в task workspace, так и локально указав `--bundle-root`.

## 5. Модель знаний

Граф сущностей хранится в нормализованной схеме SQLite:

| Тип | Назначение | Примеры |
| --- | --- | --- |
| `System` | Корневой проект | AI-KOD |
| `Domain`/`Context` | Бизнес-домены, bounded contexts | Workflow Orchestration |
| `Container` | Приложения/сервисы/CLI | API, Worker, Dashboard |
| `Component` | Пакеты/модули | NavigationEngine, WorkflowLoader |
| `Unit` | Файлы/классы/функции | navigation-engine-v7.service.ts |
| `ExternalSystem` | Внешние API, SaaS, SDK | Redis, Claude API |
| `DataStore` | Хранилища данных | Redis, S3, Postgres |
| `Queue`/`Stream` | Очереди, стримы | v7:events, BullMQ queue |
| `Interface`/`APIEndpoint` | REST/SSE, CLI, MCP | POST /tasks, SSE logs |
| `Workflow` | YAML workflow/процессы | analysis-research |
| `Layer` | Горизонтальные слои | Presentation, Application, Domain, Infrastructure |
| `Slice` | Вертикальные срезы | Observability, Security, Workflow Execution |
| `Remark` | Пользовательские указания | «Контейнер X не выделять отдельно» |

Связи: `contains`, `depends_on`, `uses`, `communicates_with`, `implements`, `belongs_to_layer`, `belongs_to_slice`, `docs_reference`, `code_reference`, `confirmed_by`, `conflicts_with`.

Каждая сущность хранит: `stable_key`, `type`, `name`, `description`, `sources` (doc/code/remark), `coverage_status`, `confidence`, `data_json` (файл, диапазон, версия, SLA), `parent_key`, списки слоёв/срезов, `last_run_id`, `last_step_id`, timestamps.

Ремарки (`remarks`) связываются с сущностями и применяются при компактации (см. §8.3).

### 5.1 Рекомендуемые слои и срезы (v1)
- Layers (горизонтали): `Presentation`, `Application`, `Domain`, `Infrastructure`.
- Slices (вертикали): `Workflow Execution`, `Observability`, `Security`, `API`, `CLI`.

### 5.2 Минимальные поля сущности (v1)
- Ключевые: `stable_key`, `type`, `name`, `parent_key`.
- Статусы: `coverage_status` (DOC_ONLY/CODE_ONLY/DOC_AND_CODE/OUTDATED/DEPRECATED), `confidence` (0..1).
- Источники: `sources` (doc|code|remark) + `evidence` ссылки.
- Данные: `data_json` (для Unit/Component: `path`; для Container: `entry`; для APIEndpoint: `method`, `path`; для Queue/Stream: `keys`; для ExternalSystem/DataStore: `kind`, `version?`).
- Классификация: `layers[]`, `slices[]` (при наличии).

### 5.3 Эвристики извлечения (v1)
- Документация (MBB/ADR/README):
  - Заголовки/разделы → `System`/`Domain`/`Container`.
  - Таблицы/списки API → `Interface`/`APIEndpoint`.
  - Разделы интеграций/конфигов → `ExternalSystem`/`DataStore`.
  - Ключевые слова для срезов: `event`, `observability`, `security`, `api`, `cli`.
- Код/конфиги:
  - `apps/*` + entrypoints → `Container`.
  - `packages/*` и `src/*` узлы → `Component`.
  - Слои: по каталогам (`controllers/`→Presentation, `services/`→Application, `domain/`→Domain, `infra/`/ORM/Redis→Infrastructure).
  - Срезы: по токенам в путях/названиях (`event`, `obs`, `auth`, `api`, `cli`).
  - Интеграции: `import` SDK, клиенты, `process.env.*` (URI/host) → `ExternalSystem`/`DataStore`.
  - Очереди/стримы: `new Queue(...)`, ключи Redis Streams.
  - Endpoints: декларации роутеров (метод+путь).
  - Workflows/Jobs: YAML, объявления workers/`processJob`.

### 5.4 Что не извлекаем в v1
- Глубокие доменные модели (DDD агрегаты/события) — оставляем аспектам.
- Полные контрактные схемы (JSON Schema/Zod) — достаточно инвентаря endpoint’ов.
- Тонкие статические метрики качества — это уровень аспектов.

### 5.5 Детерминированное извлечение кода
- Лейн `code` больше не полагается на эвристику AST из agenta: используется tree-sitter (для TS/JS/Go/Python) с единым walker (`scripts/research/code/extract-tree.ts`).  
- Каждый узел нормализуется до `code_symbol` и сопровождается *JSDoc/TypeDoc* блоком (`jsdoc_text`, `tags[]`). Функции-конструкторы и классы получают `signature_hash`, который входит в `stable_key`.
- Файл `analysis/code-process.json` фиксирует: версию грамматики, список обойденных файлов, `content_hash` (sha256 нормализованного содержимого) и предупреждения. CLI и агенты используют его для воспроизводимости.
- Результат пишется в таблицу `raw_code_entities (run_id, content_hash, symbol_path, jsdoc_text, metadata_json, extracted_at)` и только после компактации переносится в `structure_entities`. Любое изменение `content_hash` автоматически помечает сущность как `CODE_ONLY` до подтверждения документацией.

### 5.6 Агентное извлечение документации и doc_matches
- Лейн `docs` объединяет два источника: детерминированные парсеры (Markdown, MBB Duo, ADR) и агентные резюмирующие проходы (`docs-agent`).  
- Для каждого раздела создаётся запись `raw_doc_entities (run_id, document_path, heading_fqn, summary_md, anchors[], content_hash_doc)`. Агент документирует назначение, интеграции, ожидаемые артефакты.
- Процедура `match-docs-to-code.ts` сравнивает `content_hash_doc` с `signature_hash` и семантическими embedding’ами. Совпадения фиксируются в `doc_matches (run_id, doc_key, code_key, match_kind, confidence_doc, evidence)`; конфликты (несоответствие типов, устаревшие ссылки) попадают в `doc_match_conflicts`.
- Эти таблицы двигают `coverage_status`: при подтверждении doc↔code запись становится `DOC_AND_CODE`, при расхождении выставляется `OUTDATED`. Отчёт `doc-matches.json` публикуется в `analysis/exports/`.

## 6. Библиотека аспектов

Аспекты описываются Markdown с YAML-фронтматтером:

```yaml
---
id: architecture-boundaries
title: "Границы модулей"
scope: container               # system | domain | container | component | unit
layers: ["Application", "Domain"]
slices: ["Workflow Execution"]
sources: ["code", "doc"]
targets:
  include: ["containers/api", "containers/worker"]
  exclude: ["containers/dashboard"]
selectors:
  files: ["apps/server/src/**/*.ts"]
  languages: ["ts"]
  changed_only: true
required_confidence: 0.6
quality_gate:
  severity_threshold: "high"
  max_conflicts: 5
output_contract: findings-v2
dependencies: ["structure-verification"]
---
```

- `scope` — уровень применения;
- `layers`/`slices` — горизонтальные и вертикальные срезы, используемые для фильтрации;
- `sources` — обязательные источники (`doc`, `code`, `remark`);
- `required_confidence` — минимальная уверенность, с которой сущность допускается в анализ;
- `quality_gate` — ограничения, при превышении которых workflow падает;
- `dependencies` — ensures что необходимый ресёрч выполнен.

`aspects/index.yaml` группирует аспекты по волнам (`research`, `structure`, `aspect-architecture`, `aspect-security`, `post`), определяет порядок и опциональность.

## 7.3 Remarks v1 — простой дизайн

Цель: дать инженеру способ простыми текстовыми инструкциями (высший приоритет) управлять поведением агентов в пределах файловой области, без жёстких операций.

Модель (v1):
- `remarks` хранятся в SQLite и дублируются в глобальном workspace для DX.
- Поля: `remark_id (UUID)`, `path (repo-relative)`, `scope (file|dir|glob)`, `recursive? (для dir, default: true)`, `text (string)`, `created_at (ts)`, `source (input|db)`, `remark_key (sha256(path+scope+recursive+normalize(text)))`.
- Нет приоритетов/тегов/expiry в v1. Инструкция воспринимается агентом как обязательная.

Ввод:
- Через `inputs.remarks` (см. §4.3) можно подавать список новых ремарок на каждый запуск.
- Шаг `prepare-remarks` валидирует пути (в пределах `project_root`), нормализует, UPSERT'ит по `remark_key`.

Область действия (`applies_to`):
- Для `file` → один файл (несуществующий путь → предупреждение, пропуск).
- Для `dir` и `recursive:true` → все файлы в поддереве; `recursive:false` → только файлы непосредственно в папке.
- Для `glob` → все файлы по маске.
- Результат сохраняется в `remark_applies(remark_id, file_path, last_run_id)` и экспортируется в `global/remarks/applies/<remark_id>.json` и агрегированно в `global/remarks_context.json`.

Применение (prompts):
- ContextManager подмешивает в начало промпта раздел «Priority user guidelines» — релевантные инструкции для целевых файлов шага.
- В evidence шага (`evidence.payload_json`) пишется `applied_remarks: [remark_id...]`.

Инвалидация:
- Любое изменение ремарки делает «dirty set» = весь её `applies_to` набор; ingestion перечитывает эти файлы, compact пересчитывает их сущности и 1‑й уровень соседей (родитель/дети).

Обратная связь:
- В `outputs.global.remarks_summary` возвращаем `{ remark_id, path, scope, recursive, affected_files_count }`.
- В `structure.md` — секция «Remarks influence»: итоги и top‑N файлов с примерами.

События и валидации:
- События: `remarks_added`, `remarks_applied` (+ counts), `remarks_conflict_detected` зарезервировано.
- Валидации: запрет пустого `text`, нормализация/проверка пути, лимит на «слишком широкие» ремарки (например, >5000 файлов → warning).

## 7. Контракты артефактов

### 7.1 `ingest.jsonl`

Каждая строка:
```json
{
  "version": "2.0",
  "run_id": "b3a8b3a8-8d6e-4d7a-8c11-3c9a0a",
  "task_id": "TASK-123",
  "step_id": "STEP-001",
  "aspect_id": "structure-doc-research",
  "source": "doc",
  "entity": {
    "type": "Container",
    "name": "API",
    "stable_key": "container:api",
    "parent_key": "system:ai-kod",
    "layer": "Application",
    "slice": "Workflow Execution",
    "coverage_status": "DOC_ONLY",
    "confidence": 0.6,
    "data": {
      "doc_path": ".memory-bank/docs/orchestrator/index.md",
      "summary": "Orchestrator inside API runtime"
    }
  },
  "relationships": [
    {
      "type": "uses",
      "dst_key": "external:redis",
      "data": { "reason": "state storage" },
      "confidence": 0.5
    }
  ],
  "remarks": [
    {
      "type": "clarify",
      "note": "Документация может быть устаревшей"
    }
  ]
}
```

`write-to-db.ts`:
- валидация схемы (Zod/JSON Schema);
- режим WAL, busy_timeout, file lock;
- UPSERT в `ingest_log` по `(run_id, step_id, aspect_id, entity.stable_key, content_hash)`;
- статусы `pending`, `processed`, `error`, с логированием ошибок.

### 7.2 Таблицы БД

- `runs(run_id PK, workflow_id, started_at, finished_at, prev_run_id, git_sha, branch, params_json)`
- `file_index(path PK, hash, size, kind, last_seen_run, last_analyzed_run)`
- `ingest_log(id PK, run_id, aspect_id, source, payload_json, content_hash, status, error, created_at)`
- `entities(stable_key PK, type, name, parent_key, data_json, coverage_status, confidence, sources_json, last_run_id, last_step_id, created_at, updated_at)`
- `relationships(stable_key PK, src_key, dst_key, type, data_json, confidence, sources_json, last_run_id, created_at, updated_at)`
- `layers(entity_key, layer)` / `slices(entity_key, slice)`
- `remarks(remark_id PK, path, scope, recursive, text, created_at, source, remark_key)`
- `remark_applies(remark_id, file_path, last_run_id)`
- `aspect_findings(finding_id PK, aspect_id, stable_key, severity, title, description, data_json, confidence, status, last_run_id)`
- `evidence(id PK, stable_key, run_id, source, payload_json, note, created_at)`
- `reports(id PK, run_id, type, path, created_at)`

Граф можно эмулировать через SQL join; при необходимости поддержать материальные представления (views).

## 8. Фаза ресёрча

### 8.1 Шаг 0 — Prepare & Index
- Loader распознаёт бандл по `.kod/manifest`, выбирает workflow (`workflowId` → файл/директория/логический id).
- Workspace интеграция: симлинки или копии файлов контент-групп, проверка лимитов, генерация `BUNDLE_INDEX.md` и `bundle-index.json`.
- `init-db.ts`: создаёт/открывает SQLite, включает WAL, PRAGMA (`synchronous = NORMAL`, `temp_store = MEMORY`).
- `index-files.ts`: формирует `file_index`, фиксирует git_sha и `git diff` с предыдущим run.
- `prepare-remarks`: принимает `inputs.remarks`, нормализует пути, валидирует, UPSERT'ит в `remarks`, рассчитывает `remark_applies`, экспортирует `global/remarks_context.json` и `global/remarks/applies/*`.
- События: `bundle_detected`, `bundle_attached`, `bundle_db_opened`, `remarks_added`.

### 8.2 Шаг 1 — Документация (`docs` lane)
- Аспекты `structure-doc-*` читают Memory Bank, ADR, README, C4 карты.
- Извлекаем System → Domain → Container → Component, связи `docs_reference`, внешние системы.
- Фиксируем coverage `DOC_ONLY`, `confidence` ~ 0.6–0.7, `sources = ["doc"]`.
- Сохраняем TODO и assumptions как ремарки (`remark type = clarify`).
- Пишем в `ingest_log`.

### 8.3 Шаг 2 — Код (`code` lane)
- Аспекты `structure-code-*` исследуют дерево кода: директории, namespace, class names, config files, imports, использование SDK.
- Извлекаем сущности, внешние зависимости (`ExternalSystem`, `DataStore`, `Queue`), связи `uses`, `depends_on`, `implements`.
- Определяем слои (по путям/именам) и срезы (по ключевым словам/папкам).
- coverage `CODE_ONLY`, `confidence` ~ 0.7–0.85.
- В лог попадают найденные сущности и связи.

### 8.4 Шаг 3 — Консолидация (`compact-db.ts`)
- Объединяем doc и code сущности по `stable_key`. Если совпадают → `coverage_status = DOC_AND_CODE`. Если нет — `CONFLICT`.
- Применяем ремарки:
  - `confirm` повышает confidence до ≥ 0.9;
  - `reject/disable` снижает confidence, переводит в `DEPRECATED`;
  - `merge/split` вызывает `remap-structure.ts`, обновляя `parent_key` и связи.
- Обновляем `entities`, `relationships`, `layers`, `slices`, `evidence`.
- События: `structure_compacted`, `structure_conflict_detected`.

### 8.5 Шаг 4 — Обогащение (`enrich-links.ts`)
- Сопоставляем doc ↔ code (frontmatter vs JSDoc, @see, @docs).
- Выявляем устаревшие документы (сравнение дат, git history).
- Нормализуем внешние технологии (SDK, инфраструктура) из обоих источников.
- Формируем coverage метрики: % подтверждённых контейнеров, количество `DOC_ONLY`/`CODE_ONLY`.

### 8.6 Результат ресёрча
- Иерархия C4 + дополнительные типы сущностей (внешние системы, интерфейсы, слои).
- Каталог внешних технологий с привязкой к контейнерам.
- Метрики покрытия и confidence heatmap.
- Список конфликтов doc↔code, список сущностей без документации.
- Ремарки и их влияние (журнал объясняет изменения структуры).
- Правила `validation_rules` (0090) проверяют, что ключевые коллекции не пусты; при нарушении workflow завершается с ошибкой.
- Global артефакты сохраняются в task workspace (`global/`), доступны всем шагам/WCALL; структурированное состояние помещается в `outputs.global` и доступно через `inputs.global` последующих шагов.

### 8.7 Экспорты снапшота структуры (structure-only)
- JSON экспорты в `analysis/exports/`:
  - `entities.json` — все сущности с ключевыми полями;
  - `relationships.json` — все связи;
  - `coverage.json` — агрегаты по coverage/confidence;
  - `metrics.json` — базовые метрики (counts по типам, по слоям/срезам);
  - `external-systems.json` — инвентарь внешних систем/хранилищ;
  - `endpoints.json` — инвентарь API endpoint’ов;
  - `queues.json` — инвентарь очередей/стримов.
- Global workspace (0093):
  - `global/structure/snapshot.json` — агрегированный слепок для последующих шагов;
  - `outputs.global.structure_summary` — краткая сводка (counts, coverage %, timestamp).

### 8.8 Таблицы raw/result и очистка по хэшу
- **`raw_code_entities` / `raw_doc_entities`**: буфер перед компактацией. Содержат `run_id`, `content_hash`, `source_path`, `metadata_json`, `extracted_at`. Очистка выполняется по принципу *двух фаз*: сначала копим все записи текущего запуска, затем `compact-db.ts` переносит их в `structure_entities`.
- **`structure_entities` / `structure_relationships`**: основная модель после объединения doc+code. Колонки `content_hash_prev` и `content_hash_next` позволяют строить diff без повторного обхода.
- **`doc_matches` / `doc_match_conflicts`**: соответствия и коллизии документации ↔ кода (см. §5.6). Используются CLI и отчётами `coverage.json`.
- **`structure_clean_log`**: фиксирует удалённые записи (`entity_key`, `reason`, `content_hash`). Скрипт `clean-by-hash.ts` удаляет сущности, если файл исчез или `content_hash` не встречается в последних двух запусках. Это предотвращает “призрачные” сущности при переименованиях веток.
- **`structure_cli_runs`**: журнал всех запусков CLI-команд (название, параметры, git_sha) — нужен для аудита артефактов, публикуемых в PR.

> Очистка по хэшу гарантирует, что повторный запуск с теми же файлами не создаёт дубликаты: перед переносом в `structure_entities` выполняется `DELETE FROM raw_* WHERE content_hash IN (SELECT content_hash FROM structure_entities WHERE last_run_id = :run_id)`.

## 9. Многоаспектный анализ

Запускается отдельными workflow (например, `aspect-architecture.yaml`, `aspect-security.yaml`). Each workflow:
- подготавливает выборку сущностей по `scope`, `layers`, `slices`, `confidence`, `changed_only`;
- раздаёт цели агентам, прикладывая контекст: код (файлы, диапазоны), документацию, ремарки, предыдущие findings;
- сохраняет результаты в `ingest_log`, далее в `aspect_findings`.

### 9.1 Категории аспектов
- `System`/`Domain` — глобальные проверки (архитектурные риски, SLA, соответствие ADR).
- `Container` — границы сервисов, event flow, security posture, observability coverage.
- `Component` — зависимость, контракт, error handling, resource usage.
- `Unit` — детализация (тесты, кодстайл, телеметрия).

### 9.2 Quality Gates
- Аспект может задать `quality_gate` (например, severity ≥ high ⇒ остановить workflow).
- Гейт оценивается после компактации `aspect_findings`.
- Событие `aspect_quality_gate_failed` сообщает о нарушении с деталями.

### 9.3 Использование confidence и coverage
- Аспекты могут анализировать только сущности с `confidence ≥ threshold`.
- Можно указать `include_status: ["DOC_AND_CODE", "CODE_ONLY"]` и исключить `OUTDATED`.
- Findings могут повышать confidence (если подтверждают структуру) или создавать ремарки.

## 10. Диффы и отчётность

### 10.1 Инкрементальность
- `runs.prev_run_id` указывает на предыдущий запуск. `init-db.ts` вычисляет diff по git и обновляет `file_index`.
- Ресёрч может работать в режиме `changed_only`: анализировать изменённые файлы + их окрестности (impact по `relationships`).
- `compute-diff.ts` сравнивает `entities`, `relationships`, `aspect_findings` между `run_id` и `prev_run_id`. Отдельно фиксирует изменения `coverage_status`, `confidence`, структуру (смена родителя).

### 10.2 Отчёты (`generate-report.ts`)
- **Full report**:
  - структура (таблицы, диаграммы C4), coverage, confidence heatmap;
  - список внешних систем (тип, версия, слой, владелец, SLA);
  - summary аспектов (по слоям/срезам, severity, рекомендации);
  - ремарки и их статус (подтверждено/ожидает действия).
- **Diff report**:
  - Added/Removed/Changed сущности и связи;
  - изменения coverage/confidence;
  - новые/закрытые findings;
  - зоны, где документация отстала или опережает код.
- Пути `.md` / `.json` пишутся в `reports` и доступны в workspace (`analysis/reports/full.md`, `analysis/reports/diff.md`).

## 11. Наблюдаемость

События (EventSystemAPI):
- `bundle_detected`, `bundle_attached`, `bundle_context_exposed`;
- `structure_doc_ingested`, `structure_code_ingested`, `structure_compacted`, `structure_conflict_detected`;
- `remarks_applied`, `confidence_updated`;
- `aspect_started`, `aspect_completed`, `aspect_quality_gate_failed`;
- `report_generated`, `run_finalized`.

Payload событий содержит `run_id`, `workflow_id`, статистику (сущности, coverage %, conflicts, findings).

## 12. Надёжность и производительность

- SQLite: WAL, busy_timeout, file locking; ограничение parallel writers.
- `ingest_log` очищается после компактации; evidence переносится в `evidence`.
- Скрипты поддерживают `--changed-only`, `--max-entities`, `--confidence-threshold`.
- Для больших репозиториев: запуск по подсистемам (workflow per container/slice), опциональное кеширование результатов.
- Агентам не выдаётся прямой доступ к БД; только через скрипты из `scripts/`.

## 13. Поддержка в оркестраторе

### 13.1 Loader
- Распознаёт `.kod/manifest`, поддерживает `workflowId` как логический id, путь к директории или YAML.
- Возвращает `bundleContext` (manifest, пути, content_groups).
- Проверяет, что workflow присутствует в manifest/workflows.

### 13.2 Workspace
- Подключает группы файлов (`symlink`/`copy`), создаёт `bundle/` с `BUNDLE_INDEX.md` и `bundle-index.json`.
- Проверяет лимиты (`maxFiles`, `maxTotalSizeMb`), запрещает escape из бандла.
- Шаги получают инструкции по workdir и путям к скриптам.
- Task workspace размещает `global/` (симлинк на `tasks/<id>/global`) и read-only бандлы (`bundle/<namespaceOrId>`), что обеспечивает общий namespace для всех шагов и WCALL (протокол 0093).

### 13.3 ContextManager
- Распознаёт `context_from: ["bundle.<group>"]`.
- Собирает `context.bundle.<group>.files`, `.inline`, `.index` с учётом `max_inline_bytes`.
- Подмешивает `remarks` для сущностей в вывод аспектов.

## 14. Тестирование

- Loader: распознавание manifest, выбор workflow, обработка ошибок.
- Workspace integration: симлинк/копия, безопасность путей, генерация индексов.
- ContextManager: формирование bundle контекста, inline лимиты.
- Скрипты: unit tests на `write-to-db.ts`, `compact-db.ts`, `remap-structure.ts`, `compute-diff.ts`, `generate-report.ts`.
- Ресёрч: проверка построения структуры, coverage, применения ремарок.
- Аспекты: фильтрация по scope/layer/slice/confidence, quality gates.
- E2E: последовательность `research → aspect-* → report`.

## 15. Состояние и дальнейшие шаги

**Уже реализовано (протоколы 0090–0092):**
- интеграция бандла в оркестратор (loader, workspace, context), включая события наблюдаемости;
- runtime-параметры workflow (`project_root`) и валидация входов, использующая новые правила из 0090;
- Research workflow с лейнами `docs` и `code`, скрипты init/index/write/compact/enrich, отчёт full (без diff);
- поддержка ремарок и confidence при компактации, хранение сущностей, связей, evidence в SQLite;
- унифицированные engine profiles (0091) — workflows используют `engine_profile` вместо legacy полей.
- task-scoped global workspace, `global` переменные и read-only бандлы (`bundle/<namespace>`) по протоколу 0093; API/CLI/MCP для чтения `global` состояния.

**Предстоящие улучшения:**
1. **Aspects + Diff** — внедрить aspect pipeline (`aspect_findings`, quality gates), diff-отчёт и расширенный набор событий.
2. **Advanced** — дополнительные аспекты (security, performance, compliance), автоматические диаграммы, remediation и CI-интеграции, рассмотрение перехода на графовую БД при росте.

## 16. Открытые вопросы

- Нормализация `stable_key` при переименованиях (вес сигнатуры vs путь, alias).
- Retention `remarks` и `evidence` (TTL, архив).
- Использование NLP/embeddings для улучшения doc↔code сопоставления.
- Репрезентация вертикальных/горизонтальных срезов в UI и отчётах.
- Версионирование аспектов и миграция найденных issues при обновлении правил.
- Возможный переход на специализированное графовое хранилище по мере роста.

---

**Вывод:** ADR-015 описывает методику «живой архитектуры» для AI‑KOD: ресёрч строит верифицированную структуру системы (код + документация + внешние зависимости + ремарки), а многоаспектный анализ работает поверх неё. Бандл объединяет инструменты и несколько workflow, обеспечивая повторяемость и удобство для команд. Результат — full/diff отчёты, поддерживающие архитектуру в актуальном состоянии, с инкрементальными обновлениями и прозрачной обратной связью.
