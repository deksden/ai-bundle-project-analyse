---
file: .memorybank/mbb/duo-files-guide.md
description: 'MBB Rule: Duo Files Guide - правила декомпозиции, именования и структурирования сложных концепций'
purpose: Изучить для понимания как правильно структурировать и декомпозировать техническую документацию
version: '6.0.0'
date: '2025-09-08'
status: ACTIVE
c4_level: 'standard'
tags: [duo-files, decomposition, naming, documentation-structure]
parent: '.memorybank/mbb/index.md'
architecture: 'V6.0 MBB Standards'
related_files:
  - .memorybank/mbb/principles.md
  - .memorybank/mbb/frontmatter-standards.md
history:
  - version: 1.0.0
    date: 2025-01-06
    changes: Created duo files guide for MBB
---

# Duo Files Guide

## Концепция Duo файлов

**Duo файлы** - это паттерн структурирования сложной документации через разделение на **саммари** и **детальные** файлы.

### Философия
- **Саммари** - краткое изложение концепции с аннотированными ссылками
- **Детали** - углубленная информация по конкретным аспектам
- **Градуальное раскрытие** - читатель сам выбирает уровень детализации

## Правила декомпозиции

### Tier 1: Файлы ≤250 строк
**Остаются цельными.**

```
component.md (200 строк)
└── Полная документация компонента
```

**Когда применять:**
- Простые компоненты
- Утилитные функции  
- Конфигурационные модули

### Tier 2: Файлы 250-800 строк  
**Саммари + 1-2 детализации.**

```
component/
├── component.md                 # 200 строк - саммари
├── component-implementation.md  # 400 строк - детали реализации
└── component-examples.md        # 200 строк - примеры использования
```

**Когда применять:**
- Средней сложности компоненты
- API с несколькими endpoints
- Сервисы с ограниченной функциональностью

### Tier 3: Файлы >800 строк
**Обязательная декомпозиция на 3+ файла.**

```
complex-component/
├── index.md                          # 50 строк - навигация
├── complex-component.md              # 200 строк - саммари + ссылки
├── complex-component-architecture.md # 400 строк - архитектура
├── complex-component-services.md     # 400 строк - сервисы
├── complex-component-api.md          # 300 строк - API reference
└── complex-component-troubleshooting.md # 250 строк - диагностика
```

## Структура Duo файлов

### Саммари файл (главный)

**Название:** `{component}.md`

**Структура:**
```markdown
# Component Name

## Концепция
Краткое описание что это и зачем нужно.

## Ключевые возможности  
- Функция 1
- Функция 2  
- Функция 3

## Архитектура
Высокоуровневое описание архитектуры.

**Детализация:**
- [Component Architecture](component-architecture.md): V7 архитектура с event-driven patterns
- [Component Implementation](component-implementation.md): Детали реализации сервисов и классов
- [Component API](component-api.md): Публичные методы и их использование

## Быстрый старт
Минимальный пример использования.

**Углубленная информация:**
- [Component Examples](component-examples.md): Подробные примеры и use cases
- [Component Troubleshooting](component-troubleshooting.md): Решение типовых проблем
```

**Правила саммари файла:**
- 150-250 строк максимум
- Основные концепции БЕЗ деталей
- Аннотированные ссылки на детальные файлы
- Быстрый старт для нетерпеливых

### Иерархия duo файлов

- **Гибкая вложенность:** детальный файл может стать саммари для под-концепции. Сократите основной текст до ключевых идей и добавьте аннотированные ссылки на новые дочерние материалы.
- **Сохранение контекста:** в каждом уровне указывайте путь навигации (`← Назад к обзору` и `→ Детали`), чтобы читатель понимал где находится.
- **Глубина по потребности:** допускается несколько уровней вложенности, пока каждый из них объясняет, зачем переходить дальше и не дублирует информацию предыдущего уровня.
- **Метаданные:** обновляйте `related_files`, `children` и `implementation_files`, когда файл меняет роль (из деталей в саммари), чтобы индекс и инструменты поиска отражали новую структуру.

### Детальные файлы

#### Architecture файл
**Название:** `{component}-architecture.md`

**Содержимое:**
- Диаграммы архитектуры
- Паттерны проектирования
- Взаимосвязи с другими компонентами
- Design decisions и их обоснование

#### Implementation файл  
**Название:** `{component}-implementation.md`

**Содержимое:**
- Детали реализации классов
- Алгоритмы и структуры данных
- Performance considerations
- Внутренние API

#### Examples файл
**Название:** `{component}-examples.md` 

**Содержимое:**
- Подробные code examples
- Use cases и сценарии
- Configuration examples
- Integration patterns

#### API файл
**Название:** `{component}-api.md`

**Содержимое:**
- Полный API reference
- Параметры и возвращаемые значения
- Error handling
- Версионирование API

### Index файл (опционально)

**Когда создавать:** Если в папке компонента >5 файлов.

**Название:** `index.md`

**Содержимое:**
```markdown
# Component Navigation

## Overview
Brief description of the component.

## Documentation Structure
- [Component Overview](component.md): Main concepts and quick start
- [Architecture Details](component-architecture.md): V7 architecture patterns
- [Implementation Guide](component-implementation.md): Code details and algorithms  
- [API Reference](component-api.md): Complete API documentation
- [Examples & Use Cases](component-examples.md): Practical examples
- [Troubleshooting](component-troubleshooting.md): Common issues and solutions
```

## Правила именования

### Базовые паттерны

**Саммари файл:**
- `{concept}.md` - главная концепция
- `state-management.md`, `navigation.md`, `validation.md`

**Детальные файлы:**  
- `{concept}-{category}.md` - категория деталей
- `state-management-architecture.md`
- `navigation-strategies.md`  
- `validation-schemas.md`

### Multi-concept компоненты

**Когда главная концепция состоит из нескольких под-концепций:**

```
orchestrator/
├── orchestrator.md              # Саммари всей подсистемы
├── orchestrator-architecture.md # Общая архитектура  
├── state-management/            # Под-концепция 1
│   ├── state.md
│   └── state-implementation.md
├── navigation/                  # Под-концепция 2  
│   ├── navigation.md
│   └── navigation-strategies.md
└── event-bus/                   # Под-концепция 3
    ├── event-bus.md
    └── event-handlers.md
```

**Роль главного файла:** Индекс для под-концепций с аннотированными ссылками.

### Специальные суффиксы

| Суффикс | Назначение | Пример |
|---------|------------|--------|
| `-architecture` | Архитектурные диаграммы и паттерны | `observability-architecture.md` |
| `-implementation` | Детали кода и алгоритмов | `state-implementation.md` |
| `-api` | API reference | `workflow-api.md` |
| `-examples` | Code examples и use cases | `navigation-examples.md` |
| `-troubleshooting` | Диагностика и решение проблем | `redis-troubleshooting.md` |
| `-testing` | Testing strategy и test cases | `validation-testing.md` |
| `-performance` | Performance optimization | `queue-performance.md` |

## Аннотированные ссылки

### Формат ссылок

**Стандартный формат:**
```markdown
- [File Name](file-path.md): Краткое описание содержимого и цель чтения
```

**Примеры:**
```markdown
**Архитектурная документация:**
- [State Architecture](state-architecture.md): V7 архитектура с atomic операциями и distributed locking
- [Event-driven Flow](state-event-flow.md): Интеграция StateManager с WorkflowEventBus для V7

**Детали реализации:**  
- [StateCoreService](state-implementation.md): Реализация централизованного управления состоянием workflows
- [LockManagerService](lock-manager.md): Distributed locking для concurrent operations

**Практическое применение:**
- [State API Usage](state-api.md): Публичные методы и примеры вызовов для разработчиков  
- [Common Patterns](state-patterns.md): Типовые паттерны использования StateManager в workflow execution
```

### Правила аннотаций

**Первая часть:** Что содержится в файле (1 предложение)
**Вторая часть:** Для каких целей читать этот файл (1 предложение)

**✅ Хорошие аннотации:**
```markdown
- [Navigation Strategies](navigation-strategies.md): Документация 7 стратегий навигации WorkflowEngine. Читать для понимания как implement custom navigation logic.

- [Redis Performance](redis-performance.md): Метрики производительности и оптимизации Redis операций. Использовать при troubleshooting медленных workflow executions.
```

**❌ Плохие аннотации:**
```markdown  
- [Navigation file](navigation.md): About navigation
- [Some documentation](component-details.md): Details
```

## Связность файлов

### Cross-references между duo файлами

**В саммари файле:**
```markdown
## См. также
- [Related Component](../related/component.md): Смежная функциональность для integration scenarios
- [Parent System](../../system.md): Контекст использования этого компонента в системе
```

**В детальных файлах:**
```markdown  
## Навигация
- [← Назад к обзору](component.md): Основные концепции и быстрый старт
- [Architecture Details →](component-architecture.md): Углубленные архитектурные детали
```

### Related files в frontmatter

**Использовать для:**
- Файлы той же концепции (duo group)
- Смежные концепции  
- Код implementation
- Tests

```yaml
related_files:
  - .memorybank/docs/orchestrator/state-management/state-implementation.md
  - .memorybank/docs/orchestrator/state-management/lock-manager.md
  - .memorybank/epics/EP-001/FT-001-04/ft-001-04.md
```

## Best Practices

### При создании duo файлов

1. **Начинать с саммари** - определить главные концепции
2. **Планировать структуру** - какие нужны детальные файлы  
3. **Проверить размеры** - каждый файл <800 строк
4. **Создать индекс** - если файлов >5
5. **Валидировать ссылки** - все ссылки работают

### При рефакторинге больших файлов

1. **Анализ содержимого** - определить логические блоки
2. **Выделить концепции** - что может быть отдельным файлом
3. **Создать саммари** - основные тезисы + ссылки  
4. **Декомпозировать детали** - переносить блоки в отдельные файлы
5. **Обновить ссылки** - актуализировать все references

### Качество duo файлов

**Метрики качества:**
- Саммари файл: 150-250 строк
- Детальные файлы: <800 строк каждый
- Аннотированные ссылки: есть описание И цель
- Cross-references: двусторонние ссылки работают
- Актуальность: версии в frontmatter актуальны

**Антипаттерны:**
- ❌ Дублирование информации между файлами
- ❌ Саммари >300 строк (слишком детальный)  
- ❌ Неработающие ссылки
- ❌ Orphan детальные файлы без ссылок из саммари
- ❌ Отсутствие навигации между связанными файлами

---

**Duo файлы обеспечивают гибкость восприятия документации - от быстрого понимания до глубокого погружения в детали, что критически важно для эффективной работы как людей, так и ИИ-агентов.**
