---
file: .memorybank/mbb/cross-references.md
description: 'MBB Rule: Cross-References - JSDoc теги, Markdown ссылки, двусторонняя связность'
purpose: Изучить для понимания как создать двусторонние ссылки между кодом и документацией  
version: '6.0.0'
date: '2025-09-08'
status: ACTIVE
c4_level: 'standard'
tags: [cross-references, jsdoc, markdown, code-documentation, bidirectional-links]
parent: '.memorybank/mbb/index.md'
architecture: 'V6.0 MBB Standards'
related_files:
  - .memorybank/mbb/frontmatter-standards.md
  - .memorybank/tech/standards/jsdoc-standards.md
history:
  - version: 1.0.0
    date: 2025-01-06
    changes: Created cross-references guide for MBB
---

# Cross-references Guide

## Концепция кросс-ссылок

**Кросс-ссылки** - это двусторонние связи между кодом и документацией, которые обеспечивают:
- **Навигацию** от кода к архитектурной документации
- **Трассировку** от документации к реализации
- **Синхронность** между техническими решениями и их описанием

### Принципы кросс-ссылочной системы
- **Двусторонность** - ссылки работают в обе стороны: код ↔ документация
- **Актуальность** - ссылки обновляются при рефакторинге  
- **Специфичность** - ссылки ведут на конкретные секции, а не на общие файлы
- **Контекстность** - ссылки содержат аннотации о цели перехода

## JSDoc теги для кода → документация

### Стандартные JSDoc теги

#### @docs тег - основная архитектурная документация

```typescript
/**
 * @fileoverview StateCoreService - Centralized state management  
 * @version 5.2.0
 * 
 * @docs {@link .memorybank/docs/orchestrator/state-management/state.md} Main architecture documentation
 * @docs {@link .memorybank/docs/orchestrator/state-management/state-architecture.md} V7 architectural patterns  
 * @see {@link .memorybank/docs/orchestrator/state-management/state-implementation.md} Implementation details
 * @see {@link .memorybank/epics/EP-001/FT-001-04/ft-001-04.md} Feature specification
 */
export class StateCoreService implements IStateCoreService {
  // Implementation...
}
```

**Правила @docs тега:**
- Ссылается на **основную архитектурную документацию** компонента
- Максимум 2-3 @docs ссылки на файл  
- Описание после ссылки объясняет **тип документации**

#### @see тег - дополнительная и смежная документация

```typescript
/**
 * Update task status atomically with distributed lock
 * 
 * @param taskId - Task identifier  
 * @param status - New task status
 * @returns Promise resolving when update completed
 * 
 * @docs {@link .memorybank/docs/orchestrator/state-management/atomic-operations.md} Atomic operations design
 * @see {@link .memorybank/tests-docs/unit/state-core.md} Unit testing patterns
 * @see {@link .memorybank/docs/orchestrator/navigation/navigation.md} Related navigation state updates
 */
async updateTaskStatus(taskId: string, status: TaskStatus): Promise<void> {
  // Implementation details...
}
```

**Правила @see тега:**
- Ссылается на **смежную документацию**, тесты, примеры
- Может быть 3-5 @see ссылок на метод/класс
- Описание объясняет **связь с текущим кодом**

### Форматирование JSDoc ссылок

#### Стандартный формат ссылок

```typescript
@docs {@link path/to/file.md} Brief description of what documentation contains
@see {@link path/to/file.md} Explanation of relevance to current code
```

#### Примеры правильного форматирования

**✅ Правильно:**
```typescript
/**
 * @docs {@link .memorybank/docs/orchestrator/navigation/navigation.md} NavigationEngineV2 architecture overview
 * @see {@link .memorybank/docs/orchestrator/navigation/strategies.md} Strategy pattern implementation details
 * @see {@link .memorybank/epics/EP-001/FT-001-03/ft-001-03.md} Navigation feature requirements
 */
export class NavigationEngineV2 {
  // ...
}
```

**❌ Неправильно:**
```typescript
/**
 * @docs {@link navigation.md} About navigation  // Неполный путь + плохое описание
 * @see {@link some-file.md} See this file     // Неинформативное описание
 * @see navigation-file                        // Не ссылка вообще
 */
```

#### Специфичность ссылок

**Ссылки на конкретные секции (предпочтительно):**
```typescript
/**
 * @docs {@link .memorybank/docs/orchestrator/state-management/state.md#atomic-operations} Atomic operations section
 * @see {@link .memorybank/docs/orchestrator/state-management/state-api.md#updateTaskStatus} API method documentation
 */
```

**Ссылки на файлы целиком (допустимо):**
```typescript
/**
 * @docs {@link .memorybank/docs/orchestrator/state-management/state.md} Complete state management documentation
 */
```

### JSDoc теги для разных типов кода

#### Сервисы и основные классы

```typescript
/**
 * @fileoverview WorkflowOrchestrator - Central workflow coordination service
 * @version 5.2.0
 * 
 * @docs {@link .memorybank/docs/orchestrator/orchestrator.md} Orchestrator architecture overview
 * @docs {@link .memorybank/docs/orchestrator/orchestrator-architecture.md} V7 event-driven architecture  
 * @see {@link .memorybank/docs/orchestrator/event-bus/event-bus.md} Event bus integration
 * @see {@link .memorybank/epics/EP-001/ep-001.md} Workflow orchestration epic
 * @see {@link .memorybank/tests-docs/unit/orchestrator.md} Testing documentation
 */
export class WorkflowOrchestrator {
  // ...
}
```

#### Утилитарные функции

```typescript
/**
 * Calculate string similarity using Levenshtein distance
 * 
 * @param str1 - First string to compare
 * @param str2 - Second string to compare  
 * @returns Similarity score between 0 and 1
 * 
 * @docs {@link .memorybank/docs/(packages)/common/string-utils.md} String utilities documentation
 * @see {@link .memorybank/docs/orchestrator/navigation/suggestions.md} Usage in navigation suggestions
 */
export function calculateStringSimilarity(str1: string, str2: string): number {
  // ...
}
```

#### Интерфейсы и типы

```typescript
/**
 * Core interface for state management operations
 * 
 * @docs {@link .memorybank/docs/orchestrator/state-management/state-api.md} Complete API reference
 * @see {@link .memorybank/docs/orchestrator/state-management/state-architecture.md} Architecture context
 */
export interface IStateCoreService {
  updateTaskStatus(taskId: string, status: TaskStatus): Promise<void>;
  getTask(taskId: string): Promise<Task | null>;
  // ...
}
```

## Markdown ссылки документация → код

### Ссылки на implementation files в frontmatter

```yaml
implementation_files:
  - apps/server/src/services/state-core.service.ts
  - apps/server/src/services/lock-manager.service.ts
  - packages/orchestrator/src/state/state-manager.ts
```

### Ссылки внутри документации

#### Секция Implementation

```markdown
## Implementation

Core service: [StateCoreService](../../../apps/server/src/services/state-core.service.ts:15)

Key methods:
- [`updateTaskStatus()`](../../../apps/server/src/services/state-core.service.ts:45) - Atomic status updates with locking
- [`getTask()`](../../../apps/server/src/services/state-core.service.ts:78) - Task retrieval with validation  
- [`createExecutionRecord()`](../../../apps/server/src/services/state-core.service.ts:112) - Step execution tracking

Tests: [state-core.test.ts](../../../tests/unit/state-core.test.ts)
```

#### Inline ссылки на код

```markdown
The StateManager uses distributed locking implemented in 
[LockManagerService](../../apps/server/src/services/lock-manager.service.ts:25) 
to ensure atomic operations across multiple workers.

Key architectural decision is documented in the 
[`acquireLock()` method](../../apps/server/src/services/lock-manager.service.ts:67-89)
which implements exponential backoff retry strategy.
```

#### Ссылки с номерами строк

**Формат:** `file.ts:line` или `file.ts:start-end`

```markdown
- [StateCoreService constructor](../../apps/server/src/services/state-core.service.ts:23-35)
- [updateTaskStatus implementation](../../apps/server/src/services/state-core.service.ts:67)  
- [Error handling pattern](../../apps/server/src/services/state-core.service.ts:145-167)
```

### Секции для разных типов ссылок

#### Architecture + Implementation секция

```markdown
## Architecture & Implementation

**Design Pattern:** State Manager implements Repository pattern with atomic operations.

**Core Components:**
- [StateCoreService](../../apps/server/src/services/state-core.service.ts) - Main state operations
- [LockManagerService](../../apps/server/src/services/lock-manager.service.ts) - Distributed locking  
- [RedisCore](../../packages/redis/src/redis-core.ts) - Low-level Redis operations

**Key Algorithms:**
- [Atomic State Update](../../apps/server/src/services/state-core.service.ts:89-134) - ACID-compliant state changes
- [Lock Acquisition](../../apps/server/src/services/lock-manager.service.ts:45-78) - Distributed lock with timeout
```

#### Testing секция

```markdown
## Testing

**Unit Tests:**
- [StateCoreService Tests](../../tests/unit/state-core.test.ts) - Core functionality testing
- [LockManager Tests](../../tests/unit/lock-manager.test.ts) - Locking mechanism tests

**E2E Scenarios:**
- [Workflow State Management](../../tests/e2e/workflow-state.test.ts) - End-to-end state flow
- [Concurrent Operations](../../tests/e2e/concurrent-state.test.ts) - Multi-worker scenarios  

**Test Documentation:**  
- [State Testing Strategy](../tests-docs/unit/state-core.md) - Testing approach and patterns
```

#### Related Code секция

```markdown
## Related Code

**Dependencies:**
- [UnifiedRedisService](../../packages/redis/src/unified-redis.service.ts) - Redis operations abstraction
- [WorkflowEventBus](../../packages/orchestrator/src/events/event-bus.ts) - Event system integration

**Dependents:**  
- [WorkflowOrchestrator](../../apps/server/src/services/workflow-orchestrator-v5.ts) - Main orchestrator service
- [NavigationEngine](../../apps/server/src/services/navigation/navigation-engine-v2.ts) - State-dependent navigation
```

## Валидация кросс-ссылок

### Автоматические проверки

#### Проверка JSDoc ссылок

```bash
# Поиск всех @docs и @see тегов
grep -r "@docs\|@see" --include="*.ts" apps/ packages/

# Проверка что файлы по ссылкам существуют  
# Валидация формата ссылок
# Проверка что описания не пустые
```

#### Проверка Markdown ссылок

```bash
# Поиск всех ссылок на код в документации
grep -r "\](.*\.ts" .memorybank/docs/

# Проверка существования файлов
# Валидация номеров строк (если указаны)
# Проверка доступности файлов
```

### Custom command для валидации ссылок

```markdown
# /mb-sync-refs команда:
1. Сканирует все .ts файлы на JSDoc теги
2. Проверяет существование файлов в @docs/@see ссылках
3. Сканирует все .md файлы на ссылки на код  
4. Проверяет что implementation_files существуют
5. Генерирует отчет о broken links
6. Предлагает исправления для неработающих ссылок
```

### Метрики качества кросс-ссылок

**Coverage метрики:**
- **Code→Doc Coverage:** % .ts файлов с @docs тегами
- **Doc→Code Coverage:** % .md файлов со ссылками на implementation  
- **Bidirectional Coverage:** % концепций с двусторонними ссылками

**Quality метрики:**
- **Link Health:** % рабочих ссылок
- **Annotation Quality:** % ссылок с информативными описаниями  
- **Specificity:** % ссылок на конкретные секции/методы

## Best Practices

### Создание новых кросс-ссылок

1. **При написании кода:**
   - Добавить @docs на главную архитектурную документацию
   - Добавить @see на смежную документацию и тесты
   - Использовать специфичные описания ссылок

2. **При написании документации:**
   - Указать implementation_files в frontmatter
   - Создать Implementation секцию со ссылками на ключевой код
   - Добавить ссылки на тесты и примеры

3. **При рефакторинге:**
   - Обновить JSDoc ссылки при перемещении файлов
   - Актуализировать Markdown ссылки при изменении structure
   - Проверить работоспособность всех ссылок

### Поддержание актуальности

**Workflow обновления:**
1. Code changes → Update JSDoc tags
2. Documentation changes → Update implementation_files  
3. File moves → Update all references
4. Regular validation → Fix broken links

**Integration с CI/CD:**
```yaml
# GitHub Actions check
- name: Validate cross-references
  run: pnpm mb-sync-refs --validate-only
```

### Антипаттерны

**❌ Избегать:**
- Ссылки на несуществующие файлы
- Общие описания ("See documentation")  
- Односторонние ссылки (только код→док или только док→код)
- Ссылки на устаревшие файлы
- Циклические ссылки без ценности

**✅ Стремиться к:**  
- Актуальные двусторонние ссылки
- Специфичные описания цели ссылки
- Ссылки на конкретные секции/методы
- Регулярная валидация и обновление
- Интеграция с процессом разработки

---

**Качественная система кросс-ссылок превращает код и документацию в связанную сеть знаний, где каждая концепция имеет как техническую реализацию, так и архитектурное обоснование.**