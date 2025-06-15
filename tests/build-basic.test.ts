import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { validateQueries } from '../src/core/build';
import { DrizzleLLMConfig } from '../src/types';

describe('Build Process - Basic Tests', () => {
  let mockConfig: DrizzleLLMConfig;

  beforeEach(() => {
    mockConfig = {
      provider: {
        type: 'openai',
        apiKey: 'test-key',
        model: 'gpt-4'
      },
      paths: {
        schema: './schema.ts',
        queries: './src/**/*.ts'
      }
    };
  });

  it('should validate queries with distributed files message', async () => {
    const originalLog = console.log;
    console.log = vi.fn();

    try {
      await validateQueries(mockConfig);
      expect(console.log).toHaveBeenCalledWith('🔍 Validation is now handled during build process with distributed files.');
      expect(console.log).toHaveBeenCalledWith('💡 Run "drizzle-llm build" to validate and regenerate queries.');
    } finally {
      console.log = originalLog;
    }
  });

  it('should create valid configuration objects', () => {
    expect(mockConfig.provider.type).toBe('openai');
    expect(mockConfig.provider.apiKey).toBe('test-key');
    expect(mockConfig.paths.schema).toBe('./schema.ts');
    expect(mockConfig.paths.queries).toBe('./src/**/*.ts');
  });

  it('should handle optional configuration properties', () => {
    const configWithCache: DrizzleLLMConfig = {
      ...mockConfig,
      cache: {
        enabled: true,
        directory: './.cache'
      },
      output: {
        generateSqlFiles: true,
        generateQueryFiles: false
      },
      debug: {
        verbose: true,
        logPrompts: false
      }
    };

    expect(configWithCache.cache?.enabled).toBe(true);
    expect(configWithCache.output?.generateSqlFiles).toBe(true);
    expect(configWithCache.debug?.verbose).toBe(true);
  });

  it('should support anthropic provider configuration', () => {
    const anthropicConfig: DrizzleLLMConfig = {
      provider: {
        type: 'anthropic',
        apiKey: 'claude-key',
        model: 'claude-3-sonnet-20240229'
      },
      paths: {
        schema: './db/schema.ts',
        queries: ['./src/**/*.ts', './lib/**/*.ts']
      }
    };

    expect(anthropicConfig.provider.type).toBe('anthropic');
    expect(Array.isArray(anthropicConfig.paths.queries)).toBe(true);
    expect(anthropicConfig.paths.queries).toHaveLength(2);
  });
});