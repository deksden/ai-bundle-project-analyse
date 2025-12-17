---
file: .memorybank/docs/bundle/index.md
description: 'Bundle container docs: состав project-analyse, ассеты, установка в AI-KOD'
purpose: 'Читать, чтобы понимать что именно поставляется в AI-KOD из этого репозитория и как это связано с workflows/packages/shared'
version: 1.0.0
date: 2025-12-17
status: ACTIVE
c4_level: L3
implementation_files:
  - .kod/manifest.json
tags: [bundle, manifest, installation, library, assets]
parent: .memorybank/docs/index.md
related_files:
  - .memorybank/docs/bundle/manifest.md
  - .memorybank/docs/workflows/index.md
  - README.md
  - docs/development.md
history:
  - version: 1.0.0
    date: 2025-12-17
    changes: Initial bundle docs index.
---

# 📦 Bundle: `project-analyse`

## Что такое “bundle” в этом контексте

Bundle — это репозиторий‑контейнер, который AI‑KOD устанавливает в `AI_KOD_ROOT/library/workflows/<bundle>/…` и использует как источник:
- workflow YAML,
- скриптов (pipeline scripts),
- script packages (entrypoints),
- shared ресурсов (папки под shared storage),
- schemas/docs/demo/fixtures (для тестов и воспроизводимости).

## Быстрые ссылки

- `.memorybank/docs/bundle/manifest.md` — как читать `.kod/manifest.json`.
- `docs/development.md` — практическая инструкция по dev/prod-test режимам и запуску.

