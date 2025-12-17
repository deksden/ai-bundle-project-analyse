---
file: .memorybank/docs/workflows/research-analyse.md
description: 'Stage 2+ workflow: research-analyse — верхнеуровневая оркестрация ADR-015 (пока skeleton)'
purpose: 'Читать, чтобы понимать роль research-analyse, как он вызывает Stage 1 и где развивать следующие стадии'
version: 1.0.0
date: 2025-12-17
status: ACTIVE
c4_level: L3
implementation_files:
  - workflows/research-analyse.yaml
tags: [workflow, research-analyse, stage-2, adr-015]
parent: .memorybank/docs/workflows/index.md
related_files:
  - .memorybank/docs/workflows/research-structure.md
  - .memorybank/docs/workflows/adr-015-implementation-map.md
history:
  - version: 1.0.0
    date: 2025-12-17
    changes: Initial skeleton documentation.
---

# `(project-analyse)/research-analyse` (Stage 2+)

## 🎯 Роль

`research-analyse` — “контейнерный” воркфлоу, который должен оркестрировать полную методологию ADR‑015:
- запускает Stage 1 (сбор структуры),
- далее запускает следующие фазы (многоаспектный анализ, quality gates, отчёт full/diff и т.д.).

## ✅ Текущее состояние

Сейчас это **skeleton**:
- внутри вызывает Stage 1 через `wcall` на `(project-analyse)/research-structure`.

## 🛠️ Где расширять

- `workflows/research-analyse.yaml` — добавлять новые стадии после `wcall` (следующие фазы ADR‑015).
- `.memorybank/docs/workflows/adr-015-implementation-map.md` — список ожидаемых фаз и артефактов.

