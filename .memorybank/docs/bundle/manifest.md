---
file: .memorybank/docs/bundle/manifest.md
description: 'Спецификация manifest: как проект-analyse описывает content groups, defaults.attach_groups и context.expose'
purpose: 'Читать, чтобы безопасно менять `.kod/manifest.json` и понимать последствия для установки/рантайма'
version: 1.0.0
date: 2025-12-17
status: ACTIVE
c4_level: L3
implementation_files:
  - .kod/manifest.json
tags: [manifest, bundle, content-groups, context, install]
parent: .memorybank/docs/bundle/index.md
related_files:
  - .memorybank/docs/workflows/index.md
  - .memorybank/docs/workflows/research-structure.md
history:
  - version: 1.0.0
    date: 2025-12-17
    changes: Initial manifest explanation for this bundle.
---

# `.kod/manifest.json` — как читать и менять

## Идентичность и namespace

- `bundle_id`: `project-analyse` — имя установки в библиотеке.
- `namespace`: `project-analyse` — namespace, который используется в путях `bundle/<namespace>` и в ссылках вида `(bundle)/workflow-id`.

## Default workflow

`default_workflow` задаёт, что считать “главным” воркфлоу бандла (используется как удобство, но запускать можно любой).

## Workspace integration

`workspace_integration` определяет как бандл “монтируется” в task workspace:
- `target: task`
- `strategy: symlink`
- `readOnly: true`

Это важно для dev‑режима: link‑установка бандла позволяет подхватывать изменения без копирования.

## Content groups (ассеты бандла)

`content_groups` — список “групп файлов”, которые бандл может прикреплять к task workspace.

В этом репозитории ключевые группы:
- `workflows` — YAML воркфлоу и конфиг анализатора.
- `scripts` — TS/JS скрипты пайплайна.
- `shared-resources` — папки под shared storage между прогонами.
- `schemas`, `docs`, `fixtures`, `demo-*` — репродуцируемость и тесты.

## defaults.attach_groups

`defaults.attach_groups` — какие группы прикреплять по умолчанию при установке/запуске.

Важно: чем больше attach_groups, тем тяжелее “материализация” в task workspace, но тем больше self-contained воспроизводимость.

## context.expose

`context.expose` задаёт “ключи”, по которым workflow DSL может ссылаться на ассеты через `context_from`:
- в этом бандле принято namespaced‑именование: `bundle.project-analyse.*`

Это защищает от конфликтов имён между разными бандлами.

