# Research Structure Bundle (ADR-015 Stage 1)

> ℹ️ Начиная с протокола 0107 стандартным workflow bundle для установки через CLI является внешний репозиторий `deksden/ai-bundle-project-analyse`. Он поставляет анализаторы и workflow `research-analyse` и устанавливается командой `ai-kod workflow install project-analyse`. Данный репозиторий содержит локальный bundle `research-structure`, используемый в тестах и для разработки.

Первый этап ADR-015 отвечает за получение **структурного среза** монорепозитория AI-KOD. Bundle собирает C4-иерархию, вертикали и интеграции, поддерживает ремарки и формирует JSON/Markdown артефакты для последующих стадий анализа.

## 🎯 Цели
- Типобезопасные CLI-скрипты, которые можно запускать и тестировать изолированно.
- Инкрементальная обработка за счёт `file_index`, git diff и WAL.
- Один workflow `research-structure.yaml`, orchestrating полный pipeline.
- Fail-fast валидации и воспроизводимость на тестовой фикстуре.

## 📦 Состав
```
bundle/
  .kod/manifest.json                # метаданные bundle и defaults
  scripts/                          # CLI-скрипты этапов
  workflows/research-structure.yaml # workflow, упакованный внутрь bundle
  analysis/config.json              # конфигурация SQLite (подхватывается скриптами)
  examples/research-structure-demo/ # демо-проект и входные данные
  tests/fixtures/                   # ingest + expected snapshots
  README.md
```

## ⚙️ Параметры
- `project_root` — абсолютный путь к анализируемому репо (обязателен).
- `remarks` — массив ремарок v1 `{ path, scope, recursive?, text }`.
- Используемый профиль движка: `analysis-default` (ADR-0091).

## 📤 Артефакты
- `global/analysis/exports/*.json` — entities, relationships, coverage, metrics, external systems, endpoints, queues.
- `global/reports/structure.md` — Markdown отчёт.
- `global/structure/snapshot.json` — сводный snapshot (см. `outputs.global.workflow.structure_dir`).
- `global/logs/*.log` — логи стадий pipeline.
- `global/config/` — рабочая копия конфигураций, скопированная с read-only ассетов bundle.
- `global/shared/research-structure/shared-resources/analysis.db` — shared база данных (симлинк на каталог bundle; SQLite пишет WAL/SHM рядом).

## 🛠 Пайплайн
1. `init-db.ts` — создаёт SQLite, включает WAL и таблицы (`runs`, `file_index`, `entities`, ...).
2. `index-files.ts` — индексирует код/доки/конфиги, фиксирует git SHA и изменения.
3. `prepare-remarks.ts` — нормализует ремарки, связывает с файлами. До запуска стадия `start` копирует конфигурации бандла в `global/config/`, чтобы все шаги работали с общей, редактируемой копией.
4. `clear-and-write-to-db.ts` — очищает предыдущие записи и загружает ingest JSONL (сущности/связи/слои/срезы).
5. `compact-db.ts` — VACUUM + очистка временных таблиц.
6. `enrich-links.ts` — считает покрытия, строит связи, подготавливает метрики.
7. `export-snapshot.ts` — пишет артефакты в `global/analysis/exports`.
8. `generate-structure-report.ts` — формирует `global/reports/structure.md` с подсчётами и ремарками.
9. `finalize-run.ts` — обновляет `runs`, валидирует содержимое SQLite (сверяет counts в `entities`, `relationships`, `file_index`) и сохраняет `structure_summary` + `global/structure/snapshot.json`.
10. `structure-audit.ts` — читает SQLite, выводит текстовый/JSON отчёт и сверяет показатели с эталоном демо-проекта (при расхождении возвращает ненулевой код).

## ▶️ Запуск шагов напрямую
Скрипты принимают абсолютные пути. Пример прогона с хранением результатов в `~/workspace/research-structure`:

```bash
WORKSPACE_ROOT=~/workspace/research-structure/TASK1
GLOBAL_ROOT="$WORKSPACE_ROOT/global"

mkdir -p \
  "$GLOBAL_ROOT/analysis/exports" \
  "$GLOBAL_ROOT/logs" \
  "$GLOBAL_ROOT/reports" \
  "$GLOBAL_ROOT/structure" \
  "$GLOBAL_ROOT/config" \
  "$GLOBAL_ROOT/shared/research-structure"

# Копия конфигураций из бандла (путь можно уточнить через outputs start-стадии)
rsync -a /abs/path/to/bundle/config/examples/research-structure-demo/configs/ "$GLOBAL_ROOT/config/"

# Подготовка базы
pnpm exec tsx bundle/scripts/init-db.ts \
  --project_root /abs/path/to/repo \
  --db_path "$GLOBAL_ROOT/shared/research-structure/analysis.db" \
  --task_id TASK1

# Индексация файлов
pnpm exec tsx bundle/scripts/index-files.ts \
  --project_root /abs/path/to/repo \
  --db_path "$GLOBAL_ROOT/shared/research-structure/analysis.db" \
  --task_id TASK1 \
  --git_sha "$(git rev-parse HEAD)"

# Ремарки (JSON строка или файл)
pnpm exec tsx bundle/scripts/prepare-remarks.ts \
  --project_root /abs/path/to/repo \
  --db_path "$GLOBAL_ROOT/shared/research-structure/analysis.db" \
  --task_id TASK1 \
  --remarks_json "$GLOBAL_ROOT/remarks.json"

# Загрузка ingest.jsonl
pnpm exec tsx bundle/scripts/clear-and-write-to-db.ts \
  --db_path "$GLOBAL_ROOT/shared/research-structure/analysis.db" \
  --task_id TASK1 \
  --ingest_path "$GLOBAL_ROOT/ingest.jsonl"

# Компактирование и очистка
pnpm exec tsx bundle/scripts/compact-db.ts \
  --db_path "$GLOBAL_ROOT/shared/research-structure/analysis.db" \
  --task_id TASK1

# Обогащение
pnpm exec tsx bundle/scripts/enrich-links.ts \
  --db_path "$GLOBAL_ROOT/shared/research-structure/analysis.db" \
  --task_id TASK1

# Экспорт JSON
pnpm exec tsx bundle/scripts/export-snapshot.ts \
  --db_path "$GLOBAL_ROOT/shared/research-structure/analysis.db" \
  --task_id TASK1 \
  --outputs_dir "$GLOBAL_ROOT/analysis/exports"

# Markdown-отчёт
pnpm exec tsx bundle/scripts/generate-structure-report.ts \
  --db_path "$GLOBAL_ROOT/shared/research-structure/analysis.db" \
  --task_id TASK1 \
  --outputs_dir "$GLOBAL_ROOT/reports"

# Финализация
pnpm exec tsx bundle/scripts/finalize-run.ts \
  --db_path "$GLOBAL_ROOT/shared/research-structure/analysis.db" \
  --task_id TASK1 \
  --outputs_dir "$GLOBAL_ROOT"

# Сверка с эталоном
pnpm exec tsx bundle/scripts/structure-audit.ts \
  --db_path "$GLOBAL_ROOT/shared/research-structure/analysis.db" \
  --task_id TASK1
```

`index-files` поддерживает `--prev_task_id`, чтобы пометить изменившиеся файлы относительно предыдущего прогона. `prepare-remarks` принимает массив объектов `{ path, scope, recursive?, text }`; `clear-and-write-to-db` читает JSONL с типами `entity|relationship|layer|slice|evidence` и очищает предыдущий run перед вставкой.

## ▶️ Workflow и тестирование

Workflow находится и в репозитории (`workflows/research-structure.yaml`), и внутри бандла (`bundle/workflows/research-structure.yaml`). Для ручного прогона используйте вспомогательный CLI:

```bash
# Запуск демо (артефакты будут скопированы в ./out/<task_id>)
pnpm bundle:structure --output-dir ./out

# Запуск на произвольном проекте
pnpm bundle:structure \
  --project-root /abs/path/to/repo \
  --ingest-path /abs/path/to/ingest.jsonl \
  --remarks-json /abs/path/to/remarks.json \
  --git-sha "$(git rev-parse HEAD)" \
  --output-dir ./out
```

CLI создаёт при необходимости временный проект на основе демо, запускает workflow через `ai-kod run research-structure` и копирует артефакты из `task/global` (кроме `bundle/` и `shared/`) в указанную директорию `--output-dir/<task_id>`; идентификатор задачи берётся из фактического `.tasks/TASK-XXX`.

Интеграционный тест `bundle/tests/research-structure.e2e.test.ts` прогоняет pipeline на фикстуре и сверяет JSON-экспорты с эталонами (`bundle/tests/fixtures/expected/*`). Запуск:

```bash
pnpm bundle:test:e2e
```

Тест проверяет наполнение `global/analysis/exports`, `global/reports/structure.md` и `global/structure/snapshot.json`, гарантируя неизменность контракта.

## 🧹 Очистка
- `bundle/scripts/clean-structure-workflow.ts` — удаляет артефакты демо-прогона в `examples/research-structure-demo/analysis/` и вспомогательные файлы.
- `bundle/scripts/clean-structure-shared.ts` — очищает `task/global/shared/research-structure` внутри выбранного workspace (сохраняет директорию и позволяет размонтировать symlink).

## ✅ DoD чекапы
- **Базовая инфраструктура**
  - [ ] `manifest.json` описывает все скрипты/workflow и defaults.
  - [ ] `analysis/config.json` содержит WAL/busy_timeout настройки.
  - [ ] Тестовая фикстура `tests/fixtures/research-structure-project` покрывает docs/api/worker/packages/workflows.
- **Init / Index**
  - [ ] `init-db.ts` идемпотентен; таблицы и индексы создаются повторно без ошибок.
  - [ ] `index-files.ts` игнорирует системные директории, фиксирует hashes и git diff.
- **Remarks / Ingestion**
  - [ ] Поддерживаются `scope`=`file|dir|glob`, лимит применений логируется.
  - [ ] `clear-and-write-to-db.ts` валидирует ingest и ведёт `ingest_log` по `task_id`.
- **Enrich / Export / Report**
  - [ ] `compact-db.ts` очищает временные записи (`ingest_log`, сироты ремарок, пустые evidence) и выполняет `VACUUM/ANALYZE`.
  - [ ] `enrich-links.ts` подсчитывает coverage, обновляет метаданные сущностей/связей, формирует метрики.
  - [ ] `export-snapshot.ts` пишет JSON-артефакты (entities/relationships/coverage/metrics/external-systems/endpoints/queues) в `global/analysis/exports`.
  - [ ] `generate-structure-report.ts` создаёт Markdown отчёт с summary, coverage и ремарками (`global/reports/structure.md`).
  - [ ] Стартовая стадия копирует конфигурации из бандла в `global/config/` (read/write).
  - [ ] `finalize-run.ts` обновляет metadata run'а, валидирует содержимое SQLite и формирует `outputs.global.structure_summary` + `global/structure/snapshot.json`.
  - [ ] Coverage > 0 и Containers ≥ 1 на фикстуре.
  - [ ] JSON экспорты сравнимы по множествам, отчёт содержит summary и applied remarks.
- **Workflow / Tests**
  - [ ] `research-structure.yaml` оркестрирует pipeline c таймаутами и ретраями.
  - [ ] Unit + integration + mini E2E тесты зелёные.
  - [ ] Второй прогон обрабатывает только изменённые файлы или fallback'ит с предупреждением.

## 🧪 Фикстура
`tests/fixtures/research-structure-project` — минимальный монорепозиторий: docs, API, worker, пакет common и sample workflow. Используется во всех тестах bundle.

## 📚 Ссылки
- ADR: `.protocols/ARD-015-1-research-structure-stage.md`
- Memory Bank: `.memory-bank/docs/orchestrator/event-flow/index.md`, `.memory-bank/docs/tests-docs/strategy/index.md`
