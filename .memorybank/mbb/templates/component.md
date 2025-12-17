---
file: .memorybank/[docs/subsystem]/[component-name].md
description: [Brief description of the component's functionality and purpose in 1-2 sentences]
purpose: [Explain when and why someone would read this component documentation]
version: 1.0.0
date: YYYY-MM-DD
status: ACTIVE
c4_level: component
architecture: [Brief description of architectural context, e.g., "V7 Event-Driven Architecture with WorkflowEventBus"]
implementation_files:
  - [apps/server/src/services/example-service.ts]
  - [packages/orchestrator/src/components/example-component.ts]
test_files:
  - [tests/unit/components/example-component.test.ts]
  - [tests/e2e/components/example-component.e2e.test.ts]
tags: [primary-component-type, technology-stack, main-use-case, architecture-version]
parent: .memorybank/docs/[subsystem]/index.md
related_files:
  - .memorybank/docs/[subsystem]/[related-component].md
  - .memorybank/docs/[other-subsystem]/[integration-component].md
history:
  - version: 1.0.0
    date: YYYY-MM-DD
    changes: Initial component documentation created from MBB template
---

# [Component Name] - [Brief Title]

## Концепция

**[Component Name]** - это [brief description of what the component does and why it exists in the system]. Компонент является [explain its role in the larger architecture].

### Ключевые особенности

- **[Feature 1]** - [brief description]
- **[Feature 2]** - [brief description]
- **[Feature 3]** - [brief description]
- **[Integration Feature]** - [how it integrates with other components]

## Архитектура

### Основные принципы

**[Component Name] follows these architectural principles:**
- **[Principle 1]** - [explanation]
- **[Principle 2]** - [explanation]
- **[SOLID/DRY/Clean Architecture principle]** - [how it's applied]

### Компонентная структура

```typescript
/**
 * [Component Name] core structure
 */
class [ComponentName] implements I[ComponentName] {
  constructor(
    private [dependency1]: [Dependency1Type],
    private [dependency2]: [Dependency2Type]
  ) {
    // Initialization logic
  }

  async [primaryMethod]([params]): Promise<[ReturnType]> {
    // Core functionality implementation
  }
}
```

## API Reference

### Core Methods

#### `[primaryMethod]([parameters]): Promise<[ReturnType]>`

**Описание:** [What this method does]

**Параметры:**
- `[param1]: [Type]` - [description]
- `[param2]: [Type]` - [description]

**Возвращает:** `Promise<[ReturnType]>` - [description of return value]

**Пример использования:**
```typescript
const [componentInstance] = new [ComponentName]([dependencies]);
const result = await [componentInstance].[primaryMethod]([example-params]);
console.log(result); // [expected output description]
```

#### `[secondaryMethod]([parameters]): [ReturnType]`

**Описание:** [What this method does]

**Параметры:**
- `[param]: [Type]` - [description]

**Возвращает:** `[ReturnType]` - [description]

## Configuration

### Required Configuration

```typescript
interface [ComponentName]Config {
  [configProperty1]: [Type]; // [description]
  [configProperty2]: [Type]; // [description]
  [optionalProperty]?: [Type]; // [description, optional]
}
```

### Environment Variables

```bash
# [Component Name] Configuration
[ENV_VAR_1]=[default-value]  # [description]
[ENV_VAR_2]=[default-value]  # [description]
```

## Integration Examples

### With [Related Component 1]

```typescript
// Integration example with [Related Component 1]
class [ExampleService] {
  constructor(
    private [componentName]: [ComponentName],
    private [relatedComponent]: [RelatedComponent]
  ) {}

  async [integrationMethod](): Promise<void> {
    const [data] = await this.[componentName].[primaryMethod]([params]);
    await this.[relatedComponent].[relatedMethod]([data]);
  }
}
```

### With [Related Component 2]

```typescript
// Integration pattern with [Related Component 2]
const [result] = await Promise.all([
  [componentInstance].[method1]([params]),
  [relatedComponentInstance].[method2]([params])
]);
```

## Error Handling

### Error Types

```typescript
// [Component Name] specific errors
class [ComponentName]Error extends ApplicationError {
  constructor(message: string, context?: [ContextType]) {
    super(message, '[COMPONENT_NAME]_ERROR', context);
  }
}

class [ComponentName]ValidationError extends [ComponentName]Error {
  // Specific validation error handling
}
```

### Error Handling Patterns

```typescript
try {
  const result = await [componentInstance].[primaryMethod]([params]);
  return result;
} catch (error) {
  if (error instanceof [ComponentName]ValidationError) {
    // Handle validation errors
    logger.warn('[ComponentName]: Validation failed', { error, params });
    throw new ValidationError('Input validation failed', { originalError: error });
  }
  
  if (error instanceof [ComponentName]Error) {
    // Handle component-specific errors
    logger.error('[ComponentName]: Operation failed', { error, params });
    throw error;
  }
  
  // Handle unexpected errors
  logger.error('[ComponentName]: Unexpected error', { error, params });
  throw new ApplicationError('Unexpected component error', { originalError: error });
}
```

## Testing

### Unit Testing Patterns

```typescript
describe('[ComponentName]', () => {
  let [componentInstance]: [ComponentName];
  let mock[Dependency1]: jest.Mocked<[Dependency1Type]>;
  let mock[Dependency2]: jest.Mocked<[Dependency2Type]>;

  beforeEach(() => {
    mock[Dependency1] = createMock[Dependency1]();
    mock[Dependency2] = createMock[Dependency2]();
    [componentInstance] = new [ComponentName](mock[Dependency1], mock[Dependency2]);
  });

  describe('[primaryMethod]', () => {
    it('should [expected behavior]', async () => {
      // Arrange
      const [testInput] = [test-data];
      mock[Dependency1].[method].mockResolvedValue([mock-return]);

      // Act
      const result = await [componentInstance].[primaryMethod]([testInput]);

      // Assert
      expect(result).toEqual([expected-result]);
      expect(mock[Dependency1].[method]).toHaveBeenCalledWith([expected-params]);
    });
  });
});
```

### Integration Testing

```typescript
describe('[ComponentName] Integration', () => {
  it('should integrate with [RelatedComponent]', async () => {
    // Integration test example
    const [componentInstance] = container.resolve<[ComponentName]>('[ComponentName]');
    const result = await [componentInstance].[primaryMethod]([integration-params]);
    
    expect(result).toBeDefined();
    // Additional integration assertions
  });
});
```

## Performance Considerations

### Performance Characteristics

- **[Operation 1]**: [typical timing] (e.g., <10ms under normal load)
- **[Operation 2]**: [timing range] (e.g., 50-200ms depending on data size)
- **Memory Usage**: [typical memory footprint]
- **Concurrent Operations**: [max concurrent operations supported]

### Optimization Techniques

```typescript
// Performance optimization example
class [ComponentName] {
  private [cache] = new Map<string, [CachedType]>();

  async [optimizedMethod]([params]): Promise<[ReturnType]> {
    const cacheKey = [generateCacheKey]([params]);
    
    if (this.[cache].has(cacheKey)) {
      return this.[cache].get(cacheKey)!;
    }

    const result = await this.[expensiveOperation]([params]);
    this.[cache].set(cacheKey, result);
    
    return result;
  }
}
```

## Monitoring & Observability

### Key Metrics

- **[Metric 1]**: [what it measures] (target: [target value])
- **[Metric 2]**: [what it measures] (threshold: [threshold value])
- **Error Rate**: [acceptable error rate] (alert if > [alert threshold])

### Logging

```typescript
// Logging patterns for [ComponentName]
logger.info('[ComponentName]: [Operation] started', {
  [contextKey]: [contextValue],
  correlationId: [correlationId]
});

logger.error('[ComponentName]: [Operation] failed', {
  error: error.message,
  [contextKey]: [contextValue],
  correlationId: [correlationId]
});
```

## Migration Guide

### Breaking Changes

#### Version [X.Y.Z] → [X+1.Y.Z]

**Changes:**
- [List of breaking changes]
- [Migration steps required]

**Migration Steps:**

```typescript
// Before (deprecated)
const result = await [component].[oldMethod]([oldParams]);

// After (current)
const result = await [component].[newMethod]([newParams]);
```

## Related Documentation

### Core Architecture
- **[Parent Subsystem](../index.md)** - [Brief description of parent subsystem]
- **[Architecture Overview]([path])** - [Brief description]

### Related Components
- **[Related Component 1]([path])** - [Brief description and relationship]
- **[Related Component 2]([path])** - [Brief description and relationship]

### Implementation Details
- **[Implementation File 1]** - [Brief description]
- **[Test Suite]** - [Brief description of test coverage]

---

**[Component Name] является критически важным компонентом [subsystem] системы, обеспечивающим [core value proposition]. Следование данной документации обеспечивает правильную интеграцию и использование компонента в рамках [Architecture Version] архитектуры.**