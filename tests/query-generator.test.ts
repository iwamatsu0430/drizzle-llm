import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OpenAIProvider, AnthropicProvider, ConversationalQueryGenerator } from '../src/core/query-generator';
import { DrizzleLLMConfig, SchemaInfo, CollectedQuery } from '../src/types';

// Mock the OpenAI and Anthropic SDKs
vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: vi.fn()
      }
    }
  }))
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: {
      create: vi.fn()
    }
  }))
}));

describe('OpenAIProvider', () => {
  let provider: OpenAIProvider;
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
    provider = new OpenAIProvider('test-key', 'gpt-4', mockConfig);
  });

  it('should create OpenAI provider with correct configuration', () => {
    expect(provider).toBeInstanceOf(OpenAIProvider);
  });

  it('should throw error when calling deprecated generateQuery method', async () => {
    const mockSchema: SchemaInfo = { tables: [], relations: [] };
    
    await expect(provider.generateQuery('test prompt', mockSchema))
      .rejects.toThrow('Use ConversationalQueryGenerator instead');
  });

  it('should handle chat messages and return response', async () => {
    const mockResponse = {
      choices: [{
        message: { content: 'SELECT * FROM users' }
      }],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150
      }
    };

    // Mock the OpenAI client
    const mockCreate = vi.fn().mockResolvedValue(mockResponse);
    (provider as any).client.chat.completions.create = mockCreate;

    const messages = [
      { role: 'system' as const, content: 'You are a SQL generator' },
      { role: 'user' as const, content: 'Get all users' }
    ];

    const result = await provider.chat(messages);

    expect(result).toBe('SELECT * FROM users');
    expect(mockCreate).toHaveBeenCalledWith({
      model: 'gpt-4',
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      temperature: 0.1,
      max_tokens: 500,
    });
  });

  it('should throw error when OpenAI returns no content', async () => {
    const mockResponse = { choices: [{ message: { content: null } }] };
    (provider as any).client.chat.completions.create = vi.fn().mockResolvedValue(mockResponse);

    const messages = [{ role: 'user' as const, content: 'test' }];

    await expect(provider.chat(messages))
      .rejects.toThrow('No response from OpenAI');
  });
});

describe('AnthropicProvider', () => {
  let provider: AnthropicProvider;
  let mockConfig: DrizzleLLMConfig;

  beforeEach(() => {
    mockConfig = {
      provider: {
        type: 'anthropic',
        apiKey: 'test-key',
        model: 'claude-3-sonnet-20240229'
      },
      paths: {
        schema: './schema.ts',
        queries: './src/**/*.ts'
      }
    };
    provider = new AnthropicProvider('test-key', 'claude-3-sonnet-20240229', mockConfig);
  });

  it('should create Anthropic provider with correct configuration', () => {
    expect(provider).toBeInstanceOf(AnthropicProvider);
  });

  it('should throw error when calling deprecated generateQuery method', async () => {
    const mockSchema: SchemaInfo = { tables: [], relations: [] };
    
    await expect(provider.generateQuery('test prompt', mockSchema))
      .rejects.toThrow('Use ConversationalQueryGenerator instead');
  });

  it('should handle chat messages and return response', async () => {
    const mockResponse = {
      content: [{ type: 'text', text: 'SELECT * FROM users WHERE id = $1' }],
      usage: {
        input_tokens: 100,
        output_tokens: 50
      }
    };

    // Mock the Anthropic client
    const mockCreate = vi.fn().mockResolvedValue(mockResponse);
    (provider as any).client.messages.create = mockCreate;

    const messages = [
      { role: 'system' as const, content: 'You are a SQL generator' },
      { role: 'user' as const, content: 'Get user by ID' }
    ];

    const result = await provider.chat(messages);

    expect(result).toBe('SELECT * FROM users WHERE id = $1');
    expect(mockCreate).toHaveBeenCalledWith({
      model: 'claude-3-sonnet-20240229',
      max_tokens: 500,
      system: 'You are a SQL generator',
      messages: [{ role: 'user', content: 'Get user by ID' }],
    });
  });

  it('should throw error when Anthropic returns invalid response', async () => {
    const mockResponse = {
      content: [{ type: 'image', data: 'invalid' }]
    };
    (provider as any).client.messages.create = vi.fn().mockResolvedValue(mockResponse);

    const messages = [{ role: 'user' as const, content: 'test' }];

    await expect(provider.chat(messages))
      .rejects.toThrow('Invalid response from Anthropic');
  });
});

describe('ConversationalQueryGenerator', () => {
  let generator: ConversationalQueryGenerator;
  let mockConfig: DrizzleLLMConfig;
  let mockSchema: SchemaInfo;

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

    mockSchema = {
      tables: [
        {
          name: 'users',
          columns: [
            { name: 'id', dbName: 'id', type: 'uuid', nullable: false },
            { name: 'name', dbName: 'name', type: 'text', nullable: false },
            { name: 'email', dbName: 'email', type: 'text', nullable: false }
          ]
        }
      ],
      relations: []
    };

    generator = new ConversationalQueryGenerator(mockConfig);
  });

  it('should create generator with OpenAI provider', () => {
    expect(generator).toBeInstanceOf(ConversationalQueryGenerator);
  });

  it('should create generator with Anthropic provider', () => {
    const anthropicConfig = {
      ...mockConfig,
      provider: { ...mockConfig.provider, type: 'anthropic' as const }
    };
    const anthropicGenerator = new ConversationalQueryGenerator(anthropicConfig);
    expect(anthropicGenerator).toBeInstanceOf(ConversationalQueryGenerator);
  });

  it('should throw error for unsupported provider type', () => {
    const invalidConfig = {
      ...mockConfig,
      provider: { ...mockConfig.provider, type: 'invalid' as any }
    };

    expect(() => new ConversationalQueryGenerator(invalidConfig))
      .toThrow('Unsupported provider type: invalid');
  });

  it('should throw error when generating query without initialization', async () => {
    const mockQuery: CollectedQuery = {
      id: 'test-id',
      intent: 'Get all users',
      location: { file: 'test.ts', line: 1, column: 1 }
    };

    await expect(generator.generateQuery(mockQuery))
      .rejects.toThrow('Schema not initialized');
  });

  it('should clean SQL output correctly', () => {
    const dirtySQL = `\`\`\`sql
    SELECT * FROM users;
    -- This is a comment
    /* Block comment */
    \`\`\``;

    const cleanedSQL = (generator as any).cleanSQL(dirtySQL);
    expect(cleanedSQL).toBe('SELECT * FROM users');
  });

  it('should validate SQL correctly', () => {
    // Valid SQL should not throw
    expect(() => (generator as any).validateSQL('SELECT * FROM users')).not.toThrow();

    // Empty SQL should throw
    expect(() => (generator as any).validateSQL('')).toThrow('Generated SQL is empty');

    // Forbidden operations should throw
    expect(() => (generator as any).validateSQL('DROP TABLE users')).toThrow('forbidden operation');
    expect(() => (generator as any).validateSQL('DELETE FROM users')).toThrow('forbidden operation');

    // Non-SELECT queries should throw
    expect(() => (generator as any).validateSQL('INSERT INTO users VALUES (1)')).toThrow('must be a SELECT query');
  });
});