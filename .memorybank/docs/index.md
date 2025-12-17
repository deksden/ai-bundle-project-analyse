---
file: .memorybank/docs/index.md
description: 'Docs hub для project-analyse: карта разделов по C4 и практическим темам'
purpose: 'Использовать как “docs root”: откуда перейти к workflow-описаниям, бандлу, ADR и правилам MBB'
version: 1.0.0
date: 2025-12-17
status: ACTIVE
c4_level: L2
index_type: shallow
coverage_depth: 2
tags: [documentation, index, workflow-bundle, project-analyse]
parent: .memorybank/index.md
related_files:
  - .memorybank/docs/workflows/index.md
  - .memorybank/docs/bundle/index.md
  - .memorybank/docs/adr/index.md
  - .memorybank/mbb/index.md
history:
  - version: 1.0.0
    date: 2025-12-17
    changes: Initial docs hub structure.
---

# 📚 Docs Hub — `project-analyse`

## Основные разделы

- **Workflows:** `.memorybank/docs/workflows/index.md` — спецификация воркфлоу, структура стадий, контракты inputs/outputs, артефакты.
- **Bundle:** `.memorybank/docs/bundle/index.md` — устройство бандла и `.kod/manifest.json` (content_groups/attach/context).
- **ADR:** `.memorybank/docs/adr/index.md` — первичные источники (ADR‑015 / ARD‑015‑1) и их отражение в коде бандла.

## Практический DX

- “Как поставить/запустить”: `README.md`, `docs/development.md`

