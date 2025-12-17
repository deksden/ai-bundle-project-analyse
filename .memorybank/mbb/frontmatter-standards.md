---
file: .memorybank/mbb/frontmatter-standards.md
description: 'MBB Rule: Frontmatter Standards - обязательные поля, форматирование, версионирование, связи между файлами'
purpose: Изучить для понимания как правильно оформлять метаданные в документации
version: '6.0.0'
date: '2025-09-08'
status: ACTIVE
c4_level: 'standard'
tags: [frontmatter, metadata, yaml, standards, documentation]
parent: '.memorybank/mbb/index.md'
architecture: 'V6.0 MBB Standards'
related_files:
  - .memorybank/mbb/indexing-guide.md
  - .memorybank/mbb/cross-references.md
history:
  - version: 1.0.0
    date: 2025-01-06
    changes: Created frontmatter standards for MBB
---

# Frontmatter Standards

## Концепция Frontmatter

**Frontmatter** - это блок YAML метаданных в начале каждого Markdown файла, который содержит структурированную информацию о документе.

### Преимущества стандартизации
- **Машиночитаемость** - ИИ-агенты быстро понимают содержимое файла
- **Навигация** - автоматическое создание индексов и связей
- **Версионирование** - отслеживание изменений документации
- **Поиск** - фильтрация по тегам, статусу, уровню C4

## Обязательные поля

### Базовые поля (присутствуют во всех файлах)

```yaml
---
file: .memorybank/docs/component/component.md
description: Краткое описание содержимого файла в 1-2 предложениях
purpose: Объяснение для каких целей читать этот файл
version: X.Y.Z
date: YYYY-MM-DD
status: ACTIVE | DRAFT | DEPRECATED
---
```

#### Детализация базовых полей

**`file:`** - Относительный путь к файлу от корня проекта
```yaml
file: .memorybank/docs/orchestrator/state-management/state.md
# НЕ используем абсолютные пути
# НЕ используем /Users/username/...
```

**`description:`** - Краткое описание (1-2 предложения)
```yaml  
description: Centralized workflow state management with Redis-backed persistence and distributed locking
# НЕ: "This file contains information about state management"
# НЕ: Более 50 слов
```

**`purpose:`** - Для каких целей читать файл (1-2 предложения)
```yaml
purpose: Read to understand how task and step states are managed across the system and implement state-dependent functionality
# НЕ: "General information about the topic"
# НЕ: Повтор description
```

**`version:`** - Семантическое версионирование
```yaml
version: 5.2.1  # major.minor.patch
# major - структурные изменения документа
# minor - новые секции или значительные дополнения
# patch - исправления, уточнения, мелкие обновления
```

**`date:`** - Дата последнего значимого обновления
```yaml
date: 2025-01-06  # YYYY-MM-DD формат
# Обновляется при изменении содержимого, НЕ при исправлении опечаток
```

**`status:`** - Текущий статус документа
```yaml
status: ACTIVE      # Актуальная документация
status: DRAFT       # В процессе написания
status: DEPRECATED  # Устаревшая, но еще используется
# НЕ используем: "WIP", "In Progress", "Old"
```

### Расширенные поля (добавляются по необходимости)

#### C4 и архитектурные поля

```yaml
c4_level: L1 | L2 | L3
# L1 - System level (product.md, architecture.md)  
# L2 - Subsystem level (api/, orchestrator/)
# L3 - Component level (state-management/, navigation/)

architecture: V7 Event-Driven Architecture with WorkflowEventBus
# Краткое описание архитектурного контекста
```

#### Связи с кодом и тестами

```yaml
implementation_files:
  - apps/server/src/services/state-core.service.ts
  - apps/server/src/services/lock-manager.service.ts
  - packages/orchestrator/src/state/state-manager.ts

test_files:  
  - tests/unit/state-core.test.ts
  - tests/unit/lock-manager.test.ts
  - tests/e2e/workflow-state-management.test.ts
```

#### Навигационные связи

```yaml
parent: .memorybank/docs/orchestrator/index.md
# Родительский документ в иерархии (для breadcrumbs)

related_files:
  - .memorybank/docs/orchestrator/navigation/navigation.md
  - .memorybank/docs/orchestrator/event-bus/event-bus.md  
  - .memorybank/epics/EP-001/FT-001-04/ft-001-04.md
# Связанные документы той же или смежной тематики
```

#### Категоризация и поиск

```yaml
tags: [state-management, redis, atomic-operations, workflow-orchestrator]
# 3-6 релевантных тегов для поиска и фильтрации
# НЕ используем: слишком общие теги ("documentation", "file")
# НЕ используем: слишком специфичные ("line-45-in-service")
```

#### История изменений

```yaml
history:
  - version: 5.2.0
    date: 2025-01-06  
    changes: Refactored for V7 event-driven architecture
  - version: 5.1.3
    date: 2025-09-03
    changes: Added StateCoreService decomposition details
  - version: 5.1.0  
    date: 2025-09-02
    changes: Initial documentation for V7.0 StateManager
# Максимум 5-7 последних изменений
# Формат: version, date, краткое описание изменений
```

### Специальные поля для разных типов файлов

#### Индексные файлы

```yaml
index_type: shallow | deep | hybrid
coverage_depth: 2  # На сколько уровней вниз покрывает индекс  
```

#### Epic и Feature файлы

```yaml
epic: EP-001
feature: FT-001-04
user_value: Centralized state management enables reliable workflow execution
target_audience: [developers, devops-engineers]
```

#### Tech stack файлы (ADR)

```yaml
decision_status: ACCEPTED | PROPOSED | DEPRECATED  
alternatives_considered: [Bull, Bee-Queue, Kue, Custom Redis]
decision_date: 2025-01-06
review_date: 2025-07-06  # Когда пересматривать решение
```

#### Test documentation файлы

```yaml
test_type: unit | e2e | integration
test_subject: StateCoreService  
coverage_scope: [state-management, redis-operations, locking]
```

## Форматирование и стиль

### YAML синтаксис

**✅ Правильное форматирование:**
```yaml
---
file: .memorybank/docs/component.md
description: Single line description without line breaks
purpose: Another single line explaining why to read this
version: 1.0.0
date: 2025-01-06
status: ACTIVE
tags: [tag1, tag2, tag3]
implementation_files:
  - apps/server/src/file1.ts
  - apps/server/src/file2.ts
related_files:
  - .memorybank/docs/related.md
history:
  - version: 1.0.0
    date: 2025-01-06  
    changes: Initial creation
---
```

**❌ Неправильное форматирование:**
```yaml
---
file:.memorybank/docs/component.md  # Нет пробела после двоеточия
description: "Multi-line description
that spans several lines"  # Многострочное описание
purpose: Same as description  # Дублирование
version: v1.0.0  # Префикс v не нужен
date: 01/06/2025  # Неправильный формат даты
status: active  # Строчные буквы
tags: tag1, tag2  # Не массив
implementation_files: apps/server/src/file.ts  # Не массив
---
```

### Соглашения по контенту

#### Description правила
- 1-2 предложения максимум
- Описывает ЧТО содержится в файле
- Без лишних слов ("This document describes...")
- Конкретно и информативно

**✅ Хорошие descriptions:**
```yaml
description: V7 event-driven workflow orchestration with WorkflowEventBus integration
description: Complete API reference for StateCoreService with usage examples
description: Unit test documentation for navigation strategies including mocking patterns
```

**❌ Плохие descriptions:**
```yaml
description: This file contains documentation about state management
description: Information related to the orchestrator system  
description: Some notes about navigation
```

#### Purpose правила
- Объясняет ДЛЯ ЧЕГО читать файл
- Указывает на конкретные use cases
- Помогает решить, релевантен ли файл

**✅ Хорошие purposes:**
```yaml
purpose: Understand state management architecture when implementing workflow persistence
purpose: Reference API methods and parameters when integrating with StateManager  
purpose: Learn testing patterns when writing unit tests for navigation components
```

**❌ Плохие purposes:**
```yaml
purpose: Learn about state management
purpose: General information
purpose: Documentation purposes
```

#### Версионирование

**Семантическое версионирование для документации:**
- **Major (X.0.0)** - Структурные изменения, новая архитектура, breaking changes
- **Minor (X.Y.0)** - Новые секции, значительные дополнения, новые концепции  
- **Patch (X.Y.Z)** - Исправления, уточнения, мелкие дополнения

**Примеры изменений версий:**
```yaml
# 5.1.0 → 5.2.0 (minor)
changes: Added V7 event-driven architecture documentation

# 5.2.0 → 5.2.1 (patch)  
changes: Fixed code examples and clarified API parameters

# 5.2.1 → 6.0.0 (major)
changes: Complete restructure for Memory Bank V6.0 refactoring  
```

## Валидация frontmatter

### Автоматические проверки

**Обязательные поля присутствуют:**
```bash
# Проверка наличия всех обязательных полей
required_fields=("file" "description" "purpose" "version" "date" "status")
```

**Форматирование корректно:**
```bash
# Валидация YAML синтаксиса
# Валидация формата даты (YYYY-MM-DD)
# Валидация версий (semantic versioning)
# Валидация статуса (ACTIVE/DRAFT/DEPRECATED)
```

**Ссылки работают:**
```bash
# Проверка что implementation_files существуют
# Проверка что related_files доступны
# Проверка что parent файл существует
```

### Custom command для валидации

```markdown
# /mb-validate команда проверяет:
- [ ] Все MD файлы имеют frontmatter
- [ ] Обязательные поля присутствуют
- [ ] YAML синтаксис корректен  
- [ ] Версии и даты в правильном формате
- [ ] Ссылки на файлы работают
- [ ] Теги не дублируются и релевантны
```

### Метрики качества frontmatter

**Метрики соответствия:**
- **Compliance Rate:** % файлов с корректным frontmatter
- **Completeness:** % файлов со всеми рекомендуемыми полями
- **Link Health:** % рабочих ссылок в related_files
- **Tag Quality:** % файлов с релевантными тегами
- **Version Consistency:** % файлов с актуальными версиями

## Шаблоны frontmatter

### Шаблон для обычного документа

```yaml
---
file: .memorybank/docs/[subsystem]/[component].md
description: [What this document contains in 1-2 sentences]
purpose: [Why and when to read this document]
version: X.Y.Z  
date: YYYY-MM-DD
status: ACTIVE
c4_level: L2 | L3
tags: [primary-topic, technology, use-case]
parent: .memorybank/docs/[subsystem]/index.md
implementation_files:
  - [path/to/implementation.ts]
test_files:
  - [path/to/test.test.ts]
related_files:
  - [path/to/related.md]
history:
  - version: X.Y.Z
    date: YYYY-MM-DD
    changes: [Brief description of changes]
---
```

### Шаблон для индексного файла

```yaml
---
file: .memorybank/docs/[subsystem]/index.md
description: Navigation index for [subsystem] components and documentation  
purpose: Use to quickly find relevant [subsystem] documentation and understand system structure
version: X.Y.Z
date: YYYY-MM-DD  
status: ACTIVE
c4_level: L2
index_type: deep | shallow
coverage_depth: [number]
tags: [index, subsystem-name, navigation]
parent: .memorybank/docs/index.md
related_files:
  - [main subsystem file]
history:
  - version: X.Y.Z
    date: YYYY-MM-DD
    changes: [Brief description of changes]
---
```

### Шаблон для Epic/Feature файла

```yaml
---
file: .memorybank/epics/[EP-XXX]/[FT-XXX-YY]/[filename].md
description: [Epic/Feature description and user value]
purpose: [When to reference this epic/feature documentation]
version: X.Y.Z
date: YYYY-MM-DD
status: ACTIVE
epic: EP-XXX
feature: FT-XXX-YY  # Only for feature files
user_value: [Clear statement of user value]
target_audience: [developers, devops, product-managers]
tags: [feature-area, technology, user-type]
related_files:
  - [related epic/feature files]
  - [implementation docs]
history:
  - version: X.Y.Z
    date: YYYY-MM-DD
    changes: [Brief description of changes]
---
```

---

**Стандартизированный frontmatter превращает коллекцию markdown файлов в структурированную, машиночитаемую базу знаний, эффективную как для людей, так и для ИИ-агентов.**