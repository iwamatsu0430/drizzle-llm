# Drizzle LLM Plugin

A powerful Vite plugin that automatically generates SQL queries from natural language using LLMs at build time, seamlessly integrating with Drizzle ORM.

## Overview

Write database queries in natural language and get type-safe, optimized SQL generated at build time. Zero runtime cost, maximum developer productivity.

```typescript
// Write queries in natural language
const users = await db.llm<User>("Get all active users with their recent orders");

// SQL is generated at build time
// Runtime executes pre-generated queries (zero cost)
```

## ✨ Features

- ✅ **Build-time Generation**: LLM calls only happen during build, zero runtime cost
- ✅ **Type Safety**: Full TypeScript type safety with your existing Drizzle schema
- ✅ **Smart Caching**: Queries are cached and only regenerated when changed
- ✅ **Vite Integration**: Seamless integration with your Vite build process
- ✅ **Multi-LLM Support**: OpenAI GPT-4, Anthropic Claude, and more
- ✅ **Schema-Aware**: Understands your database structure for accurate queries
- ✅ **Hot Reload**: Development mode regenerates queries when files change

## 📦 Installation

```bash
npm install drizzle-llm
# or
yarn add drizzle-llm
# or
pnpm add drizzle-llm
```

## 🚀 Quick Start

### 1. Configure Vite Plugin

```typescript
// vite.config.ts
import { defineConfig } from 'vite';
import { drizzleLLM } from 'drizzle-llm';

export default defineConfig({
  plugins: [
    drizzleLLM({
      provider: {
        type: 'openai', // or 'anthropic'
        apiKey: process.env.OPENAI_API_KEY,
        model: 'gpt-4', // optional
      },
      paths: {
        schema: './src/db/schema.ts',
        queries: './src/**/*.ts',
        output: './src/generated/queries.ts',
      },
      cache: {
        enabled: true,
        directory: '.drizzle-llm-cache',
      },
    }),
  ],
});
```

### 2. Set Up Runtime

```typescript
// src/db/index.ts
import { drizzle } from 'drizzle-orm/postgres-js';
import { createLLMExtension } from 'drizzle-llm/runtime';
import { generatedQueries, intentToId } from '../generated/queries';
import postgres from 'postgres';

const client = postgres(process.env.DATABASE_URL);
const db = drizzle(client);

// Add LLM capabilities
export const llmDB = createLLMExtension(db, generatedQueries, intentToId);
```

### 3. Write Natural Language Queries

```typescript
// src/services/userService.ts
import { llmDB } from '../db';

// Simple queries
const users = await llmDB.llm<User>("Get all users");

// Parameterized queries
const activeUsers = await llmDB.llm<User>(
  "Get users by status", 
  { status: "active" }
);

// Complex queries
const userWithOrders = await llmDB.llm<UserWithOrders>(
  "Get users with their orders from last month, ordered by total amount"
);
```

## 📋 Example Schema

```typescript
// src/db/schema.ts
import { pgTable, text, integer, timestamp, boolean } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: integer('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  status: text('status').default('active'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const orders = pgTable('orders', {
  id: integer('id').primaryKey(),
  userId: integer('user_id').references(() => users.id),
  amount: integer('amount').notNull(),
  status: text('status').default('pending'),
  createdAt: timestamp('created_at').defaultNow(),
});

export type User = typeof users.$inferSelect;
export type Order = typeof orders.$inferSelect;
```

## 🔄 How It Works

1. **Query Collection**: Scans your codebase for `db.llm()` calls
2. **Schema Analysis**: Analyzes your Drizzle schema to understand table structure
3. **SQL Generation**: Uses LLM to generate optimized SQL from natural language
4. **Code Generation**: Creates type-safe client code with generated queries
5. **Caching**: Caches results to speed up subsequent builds

```mermaid
graph LR
    A[Natural Language] --> B[AST Parser]
    B --> C[Schema Analyzer] 
    C --> D[LLM Generator]
    D --> E[SQL Validator]
    E --> F[Type-safe Client]
    F --> G[Runtime Execution]
```

## ⚙️ Configuration

### DrizzleLLMConfig

```typescript
interface DrizzleLLMConfig {
  provider: {
    type: 'openai' | 'anthropic';
    apiKey: string;
    model?: string; // e.g., 'gpt-4', 'claude-3-sonnet'
  };
  paths: {
    schema: string;           // Path to your Drizzle schema
    output: string;           // Where to write generated queries
    queries: string | string[]; // Glob patterns for query files
  };
  cache?: {
    enabled: boolean;         // Enable query caching
    directory: string;        // Cache directory
  };
}
```

### Environment Variables

```bash
# .env
OPENAI_API_KEY=sk-...
# or
ANTHROPIC_API_KEY=sk-ant-...

# Optional: Auto-approve query generation
DRIZZLE_LLM_AUTO_APPROVE=true
```

## 🛠️ API Reference

### Runtime Functions

```typescript
// Extend existing Drizzle instance with LLM capabilities
createLLMExtension(
  db: DrizzleDB, 
  generatedQueries: GeneratedQueries,
  intentToId?: Record<string, string>
): ExtendedDB

// Auto-discover distributed query files
extendDrizzleFromDistributed(
  db: DrizzleDB,
  pattern?: string
): Promise<ExtendedDB>

// Create standalone LLM client
new DrizzleLLMClient(
  executor: QueryExecutor, 
  generatedQueries: GeneratedQueries
)
```

### Extended Database Methods

```typescript
// Execute natural language query
db.llm<T>(intent: string, params?: Record<string, any>): Promise<T[]>

// Get query information for debugging
db._llmClient.getQueryInfo(intent: string): QueryInfo | null

// List all available queries
db._llmClient.listAvailableQueries(): string[]
```

## 🧪 Development Workflow

### 1. Write Queries
```typescript
const users = await db.llm<User>("Get active users created this week");
```

### 2. Build Project
```bash
npm run build
# Analyzes schema, generates SQL, creates type-safe client
```

### 3. Review Generated SQL
```typescript
// Check generated queries file
import { generatedQueries } from './generated/queries';
console.log(generatedQueries['query-id'].sql);
```

### 4. Validate Queries
```bash
npx drizzle-llm validate
# Validates all generated queries against schema
```

## 🔍 Advanced Features

### Multi-language Support

```typescript
// English
await db.llm<User>("Get all active users");

// 日本語
await db.llm<User>("アクティブなユーザーを全て取得");

// Français
await db.llm<User>("Obtenir tous les utilisateurs actifs");
```

### Distributed Query Files

Enable modular query organization:

```typescript
// vite.config.ts
drizzleLLM({
  // ... other config
  paths: {
    queries: ['./src/queries/**/*.ts'],
    // Generates individual .query.ts files alongside source files
  }
})
```

### Custom Query Validation

```typescript
// Custom validation rules
import { QueryValidator } from 'drizzle-llm/validator';

const validator = new QueryValidator(schema);
const result = validator.validateQueries(queries);
```

## 📊 Performance & Costs

- **Build Time**: ~2-3 seconds per query (with caching: instant)
- **Runtime**: Zero overhead - pre-generated queries
- **API Costs**: Only during development/build (cached results reduce costs)
- **Bundle Size**: Minimal impact (~2KB runtime client)

## 🔧 Troubleshooting

### Common Issues

1. **Schema not found**: Ensure schema path is correct in config
2. **LLM API errors**: Check API key and rate limits
3. **Type errors**: Ensure generated queries file is committed
4. **Cache issues**: Clear cache with `rm -rf .drizzle-llm-cache`

### Debug Mode

```bash
DEBUG=drizzle-llm* npm run build
```

### Query Validation

```bash
npx drizzle-llm validate ./src/db/schema.ts ./src/generated/queries.ts
```

## 📚 Examples

Check out the `examples/` directory for complete working examples:

- **E-commerce**: Multi-table queries with relationships
- **Blog Platform**: Content management with complex filtering
- **Analytics**: Aggregation queries with time-based grouping

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

### Development Setup

```bash
git clone https://github.com/your-org/drizzle-llm
cd drizzle-llm
npm install
npm run build
npm test
```

## 📄 License

MIT © [Your Organization]

## 🔗 Links

- [Documentation](https://your-docs-site.com)
- [Examples](./examples/)
- [Changelog](CHANGELOG.md)
- [Issues](https://github.com/your-org/drizzle-llm/issues)

---

Built with ❤️ for the TypeScript and Drizzle ORM community.