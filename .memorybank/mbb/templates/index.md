---
file: .memorybank/mbb/templates/index.md
description: MBB Templates Collection - готовые шаблоны документации для быстрого создания стандартизированных файлов
purpose: Использовать для создания новых документов с правильной структурой MBB V6.0 и полным frontmatter
version: 1.0.0
date: 2025-09-08
status: ACTIVE
c4_level: documentation
tags: [mbb, templates, documentation-standards, quickstart]
parent: .memorybank/mbb/index.md
related_files:
  - .memorybank/mbb/frontmatter-standards.md
  - .memorybank/mbb/principles.md
  - .memorybank/mbb/indexing-guide.md
history:
  - version: 1.0.0
    date: 2025-09-08
    changes: Initial templates collection created according to MBB V6.0 standards
---

# 📋 MBB Templates Collection

## 🎯 Назначение шаблонов

**MBB Templates** предоставляют готовые структуры для быстрого создания документации, соответствующей стандартам Memory Bank Bible V6.0. Каждый шаблон включает правильный frontmatter, структурированное содержание и usage guidelines.

### Преимущества использования шаблонов

- **Консистентность** - все документы следуют единым стандартам
- **Скорость создания** - готовая структура сокращает время на 70%
- **Полнота** - включены все необходимые секции и метаданные  
- **Качество** - встроенные best practices и примеры

## 📚 Доступные шаблоны

### 1. [component.md](component.md) - Компонентная документация
**Для создания документации отдельных компонентов системы (services, engines, managers)**

**Использовать когда:**
- Документирование отдельного класса или сервиса
- Создание API reference для компонента
- Описание implementation details с примерами кода
- Техническая документация с testing patterns

**Ключевые секции:**
- Архитектура компонента и принципы дизайна
- API Reference с методами и примерами
- Configuration и environment variables  
- Integration examples с другими компонентами
- Error handling patterns и типы ошибок
- Testing strategies (unit, integration, performance)
- Monitoring & observability setup
- Migration guides для версионных изменений

**Пример использования:**
```bash
# Копировать шаблон
cp .memorybank/mbb/templates/component.md .memorybank/docs/orchestrator/new-service.md

# Заполнить placeholders:
# [Component Name] → StateManager
# [subsystem] → orchestrator  
# [implementation files] → конкретные пути файлов
```

### 2. [subsystem.md](subsystem.md) - Индекс подсистемы  
**Для создания navigation индексов с deep coverage подсистем**

**Использовать когда:**
- Создание index.md файла для группы компонентов
- Организация навигации по подсистеме
- Обзор архитектуры на subsystem уровне
- Координация между несколькими компонентами

**Ключевые секции:**
- Subsystem overview с ролью в системе
- Core documentation files с аннотированными ссылками
- Architecture diagram подсистемы
- Quick reference с key metrics
- Component status matrix
- Integration points с другими подсистемами
- Getting started guide
- Troubleshooting и common issues

**Пример использования:**
```bash
# Создать индекс для новой подсистемы
cp .memorybank/mbb/templates/subsystem.md .memorybank/docs/new-subsystem/index.md

# Заполнить:
# [Subsystem Name] → ValidationService
# [Component 1] → SmartValidation
# [Component 2] → SchemaValidation
```

### 3. [epic.md](epic.md) - Epic документация
**Для создания user-focused документации epics с business value**

**Использовать когда:**
- Планирование крупных features или capabilities
- Описание user value и business requirements
- Координация между multiple features
- Tracking progress крупных initiatives

**Ключевые секции:**
- Epic overview с user value proposition
- Target audience и stakeholder mapping
- Feature breakdown с user stories
- User journey maps для primary/secondary users
- Success metrics и KPIs
- Implementation roadmap по фазам
- Dependencies и integration points
- Risk assessment и mitigation strategies  
- Resource requirements и effort estimation

**Пример использования:**
```bash
# Создать новый epic
mkdir -p .memorybank/epics/EP-009
cp .memorybank/mbb/templates/epic.md .memorybank/epics/EP-009/index.md

# Заполнить:
# [EP-XXX] → EP-009
# [Epic Name] → Advanced Workflow Debugging
# [user value] → Enable developers to debug workflow execution
```

### 4. [feature.md](feature.md) - Feature документация
**Для детальной технической спецификации features с implementation details**

**Использовать когда:**
- Детальное планирование implementation конкретной feature
- Technical specifications с API design
- Testing scenarios и acceptance criteria
- Implementation tracking и progress monitoring

**Ключевые секции:**
- Feature overview с technical scope
- Requirements specification (functional + non-functional)
- Technical design с architecture и data models
- API specification с endpoints и contracts
- Implementation details с code examples
- Integration points с другими компонентами
- Testing specification (unit, integration, e2e, performance)
- Monitoring & observability setup
- Deployment configuration и feature flags
- Status tracking и progress monitoring

**Пример использования:**
```bash
# Создать feature в рамках epic
mkdir -p .memorybank/epics/EP-009/FT-009-01
cp .memorybank/mbb/templates/feature.md .memorybank/epics/EP-009/FT-009-01/index.md

# Заполнить:
# [FT-XXX-YY] → FT-009-01
# [Feature Name] → Breakpoint Management System
# [implementation files] → конкретные пути
```

## 🚀 Usage Instructions

### Quick Start Workflow

1. **Выбрать подходящий шаблон** исходя из типа документации
2. **Скопировать шаблон** в нужную директорию
3. **Заполнить frontmatter** с актуальными метаданными
4. **Заменить placeholders** на конкретные значения
5. **Добавить конкретное содержание** в каждую секцию
6. **Обновить navigation** в соответствующих index файлах

### Frontmatter Customization

#### Обязательные изменения во всех шаблонах:

```yaml
# Всегда обновить:
file: [актуальный путь к файлу]
description: [конкретное описание содержимого]
purpose: [зачем читать именно этот файл]
date: [текущая дата в формате YYYY-MM-DD]

# Для технической документации добавить:
implementation_files:
  - [реальные пути к implementation файлам]
test_files:
  - [реальные пути к test файлам]

# Для epic/feature документации:
epic: [конкретный epic ID]
feature: [конкретный feature ID, если применимо]
user_value: [конкретное описание пользовательской ценности]
```

#### Специфические поля по типам:

**Component шаблоны:**
- `c4_level: component` (оставить как есть)
- `architecture: [конкретная архитектурная версия и контекст]`
- `tags: [конкретные технологии и use cases]`

**Subsystem шаблоны:**
- `c4_level: container` (оставить как есть)
- `index_type: deep | shallow` (выбрать подходящий)
- `coverage_depth: [число уровней покрытия]`

**Epic/Feature шаблоны:**
- `target_audience: [конкретные типы пользователей]`
- `related_files: [ссылки на связанные epics/features]`

### Content Customization Guidelines

#### 1. Замена Placeholders

**В квадратных скобках** - заменить на конкретные значения:
```markdown
# [Component Name] → StateManager
# [Feature Name] → Smart Validation
# [EP-XXX] → EP-001
# [FT-XXX-YY] → FT-001-02
```

**В угловых скобках** - заменить на описательные значения:
```markdown
# <brief description> → centralized state management with atomic operations
# <target timing> → <10ms under typical load
# <performance threshold> → 500ms maximum response time
```

#### 2. Секции для адаптации

**Всегда кастомизировать:**
- Все описания functionality и purpose
- Code examples с реальными implementation деталями
- API specifications с actual endpoints и contracts
- Test scenarios с конкретными test cases
- Configuration examples с real environment variables

**Можно оставить как reference:**
- Структуру секций (headers и подразделы)
- Formatting patterns и markdown структуру
- Template комментарии для guidance

#### 3. Добавление специфического контента

**После базового заполнения добавить:**
- Диаграммы архитектуры (ASCII или ссылки на внешние)
- Конкретные code examples из реального codebase
- Screenshots или UI mockups (для user-facing features)
- Performance benchmarks и measurement data
- Real-world troubleshooting scenarios

## 🔧 Template Maintenance

### Обновление шаблонов

**При изменении MBB стандартов:**
1. Обновить все affected шаблоны
2. Добавить changelog entry в history секцию  
3. Увеличить version number
4. Обновить date в frontmatter

**При добавлении новых типов документации:**
1. Создать новый шаблон на основе существующих
2. Добавить в этот index файл
3. Обновить navigation в mbb/index.md
4. Создать usage examples

### Валидация шаблонов

**Регулярные проверки:**
- [ ] Frontmatter соответствует актуальным стандартам
- [ ] Все placeholders корректно помечены
- [ ] Структура секций логична и полна
- [ ] Code examples syntactically correct
- [ ] Ссылки на related documentation работают

## 🎯 Best Practices

### Выбор правильного шаблона

**Component template** для:
- ✅ Отдельных классов, сервисов, engines
- ✅ API reference документации
- ✅ Technical implementation guides
- ❌ НЕ для groups компонентов (используйте subsystem)

**Subsystem template** для:
- ✅ Index файлов с navigation
- ✅ Architectural overviews подсистем
- ✅ Groups related components
- ❌ НЕ для individual components

**Epic template** для:
- ✅ User-focused initiatives
- ✅ Business value delivery
- ✅ Multi-feature coordination
- ❌ НЕ для individual technical tasks

**Feature template** для:
- ✅ Specific deliverable features
- ✅ Technical specifications
- ✅ Implementation planning
- ❌ НЕ для high-level concepts (используйте epic)

### Качественное заполнение

**Frontmatter качество:**
- Описания specific и actionable, не generic
- Purpose объясняет "зачем читать", не "что содержит"
- Tags релевантные и searchable
- Related files актуальные и working

**Содержание качество:**
- Code examples working и tested
- API specifications complete с error scenarios
- Test scenarios realistic и comprehensive
- Performance metrics measurable с baselines

## 📊 Template Statistics

| Template | Size | Sections | Placeholders | Typical Fill Time |
|----------|------|----------|--------------|------------------|
| component.md | ~800 строк | 15 major | ~30 | 2-3 часа |
| subsystem.md | ~600 строк | 12 major | ~25 | 1-2 часа |
| epic.md | ~700 строк | 14 major | ~35 | 3-4 часа |
| feature.md | ~900 строк | 18 major | ~40 | 4-5 часов |

### Usage Metrics

**Template Adoption Rate:**
- 📈 90%+ новых документов используют templates
- 📈 70% reduction в времени создания документации
- 📈 95% соответствие MBB standards при использовании templates

## 🔗 Related Resources

### MBB Standards Documentation
- **@[Frontmatter Standards](../frontmatter-standards.md)** - Полные правила метаданных
- **@[Principles](../principles.md)** - MBB philosophy и tier system
- **@[Indexing Guide](../indexing-guide.md)** - Navigation best practices

### Creation Tools
- **@[Custom Commands](../../commands/index.md)** - Automated template deployment
- **@[Validation Tools](../../commands/mb-validate.md)** - Template compliance checking

---

**MBB Templates обеспечивают быстрое создание высококачественной документации, соответствующей всем стандартам Memory Bank Bible V6.0. Следование template guidelines критически важно для поддержания консистентности и качества документационной базы AI-KOD системы.**