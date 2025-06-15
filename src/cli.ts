#!/usr/bin/env node

import { existsSync } from "fs";
import { resolve } from "path";
import { buildQueries } from "./core/build.js";
import type { DrizzleLLMConfig } from "./types.js";

async function main() {
  const command = process.argv[2];

  switch (command) {
    case "build":
      await runBuild();
      break;
    default:
      console.log(`
drizzle-llm - LLM-powered SQL query generator for Drizzle ORM

Usage:
  drizzle-llm build     Generate SQL queries using LLM

Options:
  --config <path>       Path to config file (default: drizzle-llm.config.js)
      `);
      process.exit(1);
  }
}

async function runBuild() {
  try {
    const config = await loadConfig();
    console.log("🚀 Starting Drizzle LLM build...");
    await buildQueries(config);
    console.log("✅ Build completed successfully");
  } catch (error) {
    console.error("❌ Build failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

async function loadConfig(): Promise<DrizzleLLMConfig> {
  const configPath = process.argv.includes("--config")
    ? process.argv[process.argv.indexOf("--config") + 1]
    : findConfigFile();

  try {
    const configFile = resolve(process.cwd(), configPath);

    // Handle TypeScript config files
    if (configPath.endsWith(".ts")) {
      // Use tsx to compile and load TypeScript files
      const { spawn } = await import("child_process");
      const { promisify } = await import("util");
      const _execAsync = promisify(spawn);

      // Create a temporary JS file using tsx
      const _tempFile = configFile.replace(".ts", ".temp.js");
      const _tsxPath = resolve(process.cwd(), "node_modules/.bin/tsx");

      try {
        // Compile TS to JS using tsx
        const result = await new Promise<string>((resolve, reject) => {
          const tsx = spawn(
            "node",
            [
              "-r",
              "tsx/cjs",
              "-e",
              `
            const config = require('${configFile}');
            console.log(JSON.stringify(config.default || config));
          `,
            ],
            { stdio: "pipe" }
          );

          let output = "";
          tsx.stdout?.on("data", (data) => (output += data.toString()));
          tsx.stderr?.on("data", (data) => console.error(data.toString()));
          tsx.on("close", (code) => {
            if (code === 0) resolve(output.trim());
            else reject(new Error(`tsx failed with code ${code}`));
          });
        });

        return JSON.parse(result);
      } catch (tsxError) {
        // Fallback: try dynamic import with file:// protocol
        try {
          const { pathToFileURL } = await import("url");
          const fileUrl = pathToFileURL(configFile).href;
          const module = await import(fileUrl);
          return module.default || module;
        } catch (_importError) {
          throw new Error(`Failed to load TypeScript config: ${tsxError}`);
        }
      }
    } else {
      // Handle JavaScript files normally
      const { default: config } = await import(configFile);
      return config;
    }
  } catch (error) {
    throw new Error(
      `Failed to load config from ${configPath}: ${error instanceof Error ? error.message : error}`
    );
  }
}

function findConfigFile(): string {
  const candidates = ["drizzle-llm.config.ts", "drizzle-llm.config.js", "drizzle-llm.config.mjs"];

  for (const candidate of candidates) {
    if (existsSync(resolve(process.cwd(), candidate))) {
      return candidate;
    }
  }

  // Default to .ts if none found
  return "drizzle-llm.config.ts";
}

main().catch((error) => {
  console.error("❌ Unexpected error:", error);
  process.exit(1);
});
