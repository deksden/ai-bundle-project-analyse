---
name: wf-project-analyse-env
description: "ENV переменные и требования окружения для project-analyse (research-structure/research-analyse)"
---

# ENV

## Обязательные переменные

- `AI_KOD_ROOT` — data root (обычно выставляется через `ai-kod env set dev|prod`).
- `AI_KOD_PROJECT_ROOT` — путь до pnpm workspace, где доступно `pnpm exec tsx` (обычно это монорепо `ai-kod`).

Пример:

```bash
ai-kod env set dev
export AI_KOD_PROJECT_ROOT=/ABS/PATH/ai-kod
```

## Требования к инструментам в PATH

Stage 1 использует:
- `pnpm`
- `tsx` (через `pnpm exec tsx`)
- `sqlite3` (CLI)

Если чего-то нет — workflow упадёт на bootstrap/persist/report стадиях.

## Токены / доступ к API

Локально (dev, localhost) часто работает без токена благодаря `API_LOCALHOST_BYPASS=true`, но в удалённых сценариях потребуется настройка `CLIENT_TOKEN`/`CLIENT_BASE_URL` (см. skill `ai-kod-cli`).

