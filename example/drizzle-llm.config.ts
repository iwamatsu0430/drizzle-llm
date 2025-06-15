import { DrizzleLLMConfig } from "drizzle-llm";

export default {
  provider: {
    type: "anthropic",
    apiKey: process.env.ANTHROPIC_API_KEY!,
    model: "claude-3-7-sonnet-20250219",
  },
  paths: {
    schema: "./src/schema",
    queries: ["./src/**/*.ts"],
  },
  output: {
    generateSqlFiles: true,
    generateQueryFiles: true,
  },
  // Optional: Uncomment to enable debug logging
  // debug: {
  //   verbose: true,
  //   logPrompts: true,
  //   logResponses: true,
  //   logTokenUsage: true,
  // },
} as DrizzleLLMConfig;
