---
file: .memorybank/docs/workflows/index.md
description: 'Workflows index: карта и связи research-structure ↔ research-analyse'
purpose: 'Сначала читать этот файл, чтобы понять роли воркфлоу и куда углубляться дальше'
version: 1.0.0
date: 2025-12-17
status: ACTIVE
c4_level: L3
index_type: shallow
coverage_depth: 1
tags: [workflows, research-structure, research-analyse, adr-015]
parent: .memorybank/docs/index.md
related_files:
  - workflows/research-structure.yaml
  - workflows/research-analyse.yaml
  - .memorybank/docs/workflows/research-structure.md
  - .memorybank/docs/workflows/research-analyse.md
  - .memorybank/docs/workflows/adr-015-implementation-map.md
history:
  - version: 1.0.0
    date: 2025-12-17
    changes: Initial workflow docs index.
---

# 🔁 Workflows

## `(project-analyse)/research-structure` — Stage 1 ✅

**Назначение:** построить “структурный снимок” проекта: подготовить окружение, собрать артефакты, выгрузить результаты и отчёты.  
**Состояние:** наиболее проработанный воркфлоу в ADR‑015 цепочке.

Читать дальше:
- `.memorybank/docs/workflows/research-structure.md` — как устроен Stage 1 (inputs/outputs, стадии, артефакты).

## `(project-analyse)/research-analyse` — Stage 2+ (skeleton) 🧱

**Назначение:** верхнеуровневая оркестрация “полного анализа” поверх результатов Stage 1.  
**Состояние:** пока каркас: делает `wcall` в `research-structure`, и будет расширяться.

Читать дальше:
- `.memorybank/docs/workflows/research-analyse.md`

## ADR‑015: связь требований и текущей реализации 🧭

- `.memorybank/docs/workflows/adr-015-implementation-map.md` — что из ADR уже реализовано здесь, а что является roadmap.

