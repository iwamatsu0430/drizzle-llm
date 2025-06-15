# Drizzle LLM

Build-time SQL generation using LLM with natural language queries.

## Installation

```bash
npm install drizzle-llm
```

## Quick Start

### 1. Configure

```typescript
// drizzle-llm.config.ts
export default {
  provider: {
    type: 'openai',
    apiKey: process.env.OPENAI_API_KEY,
  },
  paths: {
    schema: './src/schema',
    queries: './src/**/*.ts',
  }
};
```

### 2. Write Queries

```typescript
// src/user.ts
import { llm } from "drizzle-llm";

export async function getUser(db: any, id: string) {
  return db.all(llm`ユーザーを${id}で取得する`);
}
```

### 3. Build

```bash
npx drizzle-llm build
```

This generates `user.sql`:
```sql
-- 4a5f9c682c34d6ec808677691ea62d47
-- ユーザーを${0}で取得する
SELECT * FROM user WHERE id = $1
```

## How It Works

1. **Scan**: Finds `llm\`...\`` calls in your code
2. **Generate**: Uses LLM to create SQL from natural language
3. **Cache**: Stores results to avoid redundant API calls
4. **Runtime**: Loads pre-generated SQL at runtime

## Environment Variables

```bash
OPENAI_API_KEY=sk-...
DRIZZLE_LLM_AUTO_APPROVE=true  # Skip confirmation prompts
```

## CLI Commands

```bash
$ npx drizzle-llm build    # Generate SQL queries
```

## Configuration

```typescript
interface DrizzleLLMConfig {
  provider: {
    type: 'openai' | 'anthropic';
    apiKey: string;
    model?: string;
  };
  paths: {
    schema: string;
    queries: string | string[];
  };
  cache?: {
    enabled: boolean;
    directory: string;
  };
}
```

## License

MIT
