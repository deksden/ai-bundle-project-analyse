---
name: ai-kod-wf-project-analyse
description: "Навык запуска и сопровождения workflow bundle project-analyse (ADR-015) в системе AI-KOD: установка bundle из git/локального пути, запуск (project-analyse)/research-structure и (project-analyse)/research-analyse, требования окружения (AI_KOD_ROOT, AI_KOD_PROJECT_ROOT), контрольные точки стадий, артефакты и расследование отклонений."
index_type: deep
coverage_depth: 2
---

# 🧩 Навык: `project-analyse` (ADR‑015)

Цель: быстро и надёжно запускать внешний bundle `project-analyse` и понимать, **что именно должно получиться** на каждом этапе, где искать артефакты и как чинить типовые проблемы.

## 🔗 Навигация (аннотированные ссылки)

- [RUN](references/RUN.md): установка bundle (link/copy), запуск Stage 1/2, правила “переустановки”, базовый цикл запуска.
- [CHECKPOINTS](references/CHECKPOINTS.md): контрольные точки стадий `research-structure` (и skeleton `research-analyse`), что считать отклонением.
- [ENV](references/ENV.md): обязательные env переменные (`AI_KOD_ROOT`, `AI_KOD_PROJECT_ROOT`), требования к `pnpm/tsx/sqlite3`, заметки про токены.
- [TOOLS](references/TOOLS.md): команды наблюдения (status/steps/logs/files) без лишнего шума.
- [ARTIFACTS](references/ARTIFACTS.md): где лежат результаты (DB/exports/report), какие файлы ключевые.
- [TROUBLESHOOT](references/TROUBLESHOOT.md): типовые сбои (pnpm/tsx, sqlite3, ambiguous workflow, db locked) и быстрые проверки.
- [COMMANDS](references/COMMANDS.md): готовые команды (install/run/monitor) + подсказки по путям.

## ⚡ Кратко (для агента)

- Рабочий workflow id запускать **строго с namespace**: `(project-analyse)/research-structure` (иначе возможна “ambiguous” ошибка).
- Stage 1 (`research-structure`) — основной и наиболее детерминированный; Stage 2 (`research-analyse`) сейчас skeleton и может требовать LLM (зависит от профиля движка).
- Для Stage 1 обязателен `AI_KOD_PROJECT_ROOT` (нужен, чтобы `pnpm exec tsx …` работал в доступном pnpm workspace).

