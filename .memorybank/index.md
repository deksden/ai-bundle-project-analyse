---
file: .memorybank/index.md
description: 'Memory Bank репозитория project-analyse: навигация по знаниям (C4 + MBB)'
purpose: 'Быстро понять, где лежит документация бандла, как устроены workflows research-structure/research-analyse и какие источники (ADR) это описывают'
version: 1.0.0
date: 2025-12-17
status: ACTIVE
c4_level: L1
implementation_files:
  - .kod/manifest.json
  - workflows/research-structure.yaml
  - workflows/research-analyse.yaml
  - packages/research-scripts/workflow/bootstrap.mjs
tags: [memory-bank, documentation, workflow-bundle, adr-015, project-analyse, ai-kod]
parent: null
related_files:
  - .memorybank/docs/index.md
  - .memorybank/docs/workflows/index.md
  - .memorybank/docs/bundle/index.md
  - .memorybank/docs/adr/index.md
  - .memorybank/mbb/index.md
  - .memorybank/templates/index.md
  - README.md
history:
  - version: 1.0.0
    date: 2025-12-17
    changes: Initial Memory Bank for external bundle repo (ADR-015).
---

# 🧠 Memory Bank — `project-analyse`

Этот Memory Bank — единый источник правды по **внешнему бандлу** `project-analyse` (ADR‑015), который устанавливается в AI‑KOD как workflow bundle.

## 🚀 Быстрый старт

- **Как запускать и разрабатывать прямо сейчас:** `README.md` и `docs/development.md`
- **Правила ведения Memory Bank (MBB):** `.memorybank/mbb/index.md`
- **Главная карта документации бандла:** `.memorybank/docs/index.md`

## 🧩 Что здесь важно знать (коротко)

- `research-structure` — основной Stage 1 (структурный срез проекта, артефакты, SQLite).
- `research-analyse` — Stage 2+ (пока каркас), оркестрирует и вызывает Stage 1.
- Воркфлоу и контент поставляются в AI‑KOD через `.kod/manifest.json` (content_groups + defaults.attach_groups).

## 🗺️ Навигация по разделам

- **Workflows:** `.memorybank/docs/workflows/index.md` — как устроены `research-structure` и `research-analyse`, входы/выходы, структура стадий.
- **Bundle:** `.memorybank/docs/bundle/index.md` — состав бандла, что куда “экспортится”, как интерпретировать manifest.
- **ADR источники:** `.memorybank/docs/adr/index.md` — первичные документы ADR‑015 / ARD‑015‑1 и “карта реализации” в этом репозитории.
- **Skills:** `.memorybank/skills/ai-kod-wf-project-analyse/SKILL.md` — инструкция для AI‑агента как запускать и проверять этот bundle/workflow.
- **Шаблоны MBB:** `.memorybank/templates/index.md` — шаблоны документов (скопированы из основного репо AI‑KOD).
