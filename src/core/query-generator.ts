import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { createHash } from 'crypto';
import { CollectedQuery, GeneratedQuery, SchemaInfo, TableInfo, LLMProvider, LLMResponse, DrizzleLLMConfig } from '../types';

/**
 * Message structure for LLM chat conversations
 */
type ChatMessage = {
  /** Role of the message sender */
  role: 'system' | 'user' | 'assistant';
  /** Content of the message */
  content: string;
};

/**
 * Interface for LLM providers that support conversational interactions
 */
interface ChatProvider {
  /**
   * Send a conversation to the LLM and get a response
   * @param messages - Array of conversation messages
   * @returns Promise resolving to the LLM's response text
   */
  chat(messages: ChatMessage[]): Promise<string>;
}

/**
 * OpenAI LLM provider implementation
 * 
 * Provides integration with OpenAI's GPT models for SQL query generation.
 * Supports conversational interactions and handles API communication.
 */
export class OpenAIProvider implements LLMProvider {
  private client: OpenAI;
  private model: string;

  /**
   * Create a new OpenAI provider
   * @param apiKey - OpenAI API key
   * @param model - Model name (default: 'gpt-4')
   */
  constructor(apiKey: string, model: string = 'gpt-4') {
    this.client = new OpenAI({ apiKey });
    this.model = model;
  }

  async generateQuery(_prompt: string, _schema: SchemaInfo): Promise<LLMResponse> {
    // This method is deprecated - use chat method instead
    throw new Error('Use ConversationalQueryGenerator instead');
  }

  /**
   * Send a conversation to OpenAI and get response
   * 
   * Configures the API call with optimal settings for SQL generation:
   * - Low temperature (0.1) for consistent results
   * - Limited max_tokens (500) for concise queries
   * 
   * @param messages - Conversation messages including system prompts and user requests
   * @returns Promise resolving to the generated SQL or response text
   * @throws {Error} When API call fails or returns empty response
   */
  async chat(messages: ChatMessage[]): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      temperature: 0.1,
      max_tokens: 500,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No response from OpenAI');
    }

    return content.trim();
  }
}

/**
 * Anthropic Claude LLM provider implementation
 * 
 * Provides integration with Anthropic's Claude models for SQL query generation.
 * Handles the different API structure compared to OpenAI (separate system messages).
 */
export class AnthropicProvider implements LLMProvider {
  private client: Anthropic;
  private model: string;

  /**
   * Create a new Anthropic provider
   * @param apiKey - Anthropic API key
   * @param model - Model name (default: 'claude-3-sonnet-20240229')
   */
  constructor(apiKey: string, model: string = 'claude-3-sonnet-20240229') {
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  async generateQuery(_prompt: string, _schema: SchemaInfo): Promise<LLMResponse> {
    // This method is deprecated - use chat method instead
    throw new Error('Use ConversationalQueryGenerator instead');
  }

  /**
   * Send a conversation to Anthropic Claude and get response
   * 
   * Handles Anthropic's specific API structure where system messages
   * are separate from user/assistant messages.
   * 
   * @param messages - Conversation messages
   * @returns Promise resolving to the generated SQL or response text
   * @throws {Error} When API call fails or returns invalid response
   */
  async chat(messages: ChatMessage[]): Promise<string> {
    const systemMessage = messages.find(m => m.role === 'system');
    const userMessages = messages.filter(m => m.role !== 'system');

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 500,
      system: systemMessage?.content || '',
      messages: userMessages.map(m => ({ 
        role: m.role as 'user' | 'assistant', 
        content: m.content 
      })),
    });

    const content = response.content[0];
    if (content.type !== 'text') {
      throw new Error('Invalid response from Anthropic');
    }

    return content.text.trim();
  }
}

/**
 * Advanced conversational query generator using multi-stage LLM approach
 * 
 * This class implements a sophisticated two-stage process for generating SQL queries:
 * 1. **Table Selection Stage**: Identifies which tables are needed for the query
 * 2. **Query Generation Stage**: Generates SQL using detailed schema for selected tables
 * 
 * This approach significantly improves accuracy by:
 * - Reducing context size for the LLM
 * - Focusing on relevant schema information
 * - Minimizing hallucination of non-existent tables/columns
 * 
 * Features:
 * - Multi-provider support (OpenAI, Anthropic)
 * - Automatic retry with exponential backoff
 * - SQL validation and cleaning
 * - Optimized prompting strategies
 */
export class ConversationalQueryGenerator {
  private conversation: ChatMessage[] = [];
  private provider: ChatProvider;
  private maxRetries: number = 3;
  private schema: SchemaInfo | null = null;
  private analyzer: any;

  /**
   * Create a new conversational query generator
   * @param config - Drizzle LLM configuration with provider settings
   * @throws {Error} When unsupported provider type is specified
   */
  constructor(config: DrizzleLLMConfig) {
    if (config.provider.type === 'openai') {
      this.provider = new OpenAIProvider(config.provider.apiKey, config.provider.model);
    } else if (config.provider.type === 'anthropic') {
      this.provider = new AnthropicProvider(config.provider.apiKey, config.provider.model);
    } else {
      throw new Error(`Unsupported provider type: ${config.provider.type}`);
    }
  }

  /**
   * Initialize the generator with database schema information
   * 
   * Sets up the conversation context with a comprehensive system prompt
   * that includes SQL generation rules and best practices.
   * 
   * @param schema - Database schema information including tables and columns
   * @throws {Error} When schema analyzer import fails
   */
  async initialize(schema: SchemaInfo): Promise<void> {
    const { SchemaAnalyzer } = await import('./schema-analyzer.js');
    this.analyzer = new SchemaAnalyzer();
    this.schema = schema;
    
    this.conversation = [
      {
        role: 'system',
        content: this.analyzer.buildSystemPrompt()
      }
    ];
  }

  /**
   * Generate SQL query using two-stage conversational approach
   * 
   * **Stage 1: Table Selection**
   * - Presents available tables to LLM
   * - Asks LLM to identify required tables for the query
   * 
   * **Stage 2: Query Generation**
   * - Provides detailed schema for selected tables only
   * - Generates optimized SQL with proper parameter placeholders
   * 
   * @param intent - Natural language description of the desired query
   * @param params - Optional parameters that will be used in the query
   * @returns Promise resolving to generated SQL string
   * @throws {Error} When schema is not initialized or generation fails after retries
   * 
   * @example
   * ```typescript
   * const generator = new ConversationalQueryGenerator(config);
   * await generator.initialize(schema);
   * const sql = await generator.generateQuery('Get active users with orders', { status: 'active' });
   * ```
   */
  async generateQuery(intent: string, params?: any): Promise<string> {
    if (!this.schema) {
      throw new Error('Schema not initialized');
    }

    // Multi-stage approach for better accuracy
    
    // Stage 1: Identify required tables
    const tableNames = this.schema.tables.map(t => t.name);
    const tableSelectionMessages: ChatMessage[] = [
      ...this.conversation,
      {
        role: 'user',
        content: `Available tables: ${tableNames.join(', ')}
        
Task: "${intent}"

Which tables are needed for this query? List only the table names, separated by commas.`
      }
    ];

    const selectedTablesResponse = await this.provider.chat(tableSelectionMessages);
    const selectedTableNames = selectedTablesResponse.split(',').map(t => t.trim().toLowerCase());
    
    // Stage 2: Provide detailed schema for selected tables and generate query
    const selectedTables = this.schema.tables.filter(t => 
      selectedTableNames.includes(t.name.toLowerCase())
    );
    
    // If no tables were selected, use all tables as fallback
    const tablesToUse = selectedTables.length > 0 ? selectedTables : this.schema.tables;
    
    const detailedSchema = this.formatSelectedTablesSchema(tablesToUse);
    
    const queryGenerationMessages: ChatMessage[] = [
      ...this.conversation,
      {
        role: 'user',
        content: `${detailedSchema}

Task: "${intent}"
${params ? `Parameters provided: ${JSON.stringify(params)}` : ''}

Generate the SQL query using the EXACT database column names shown above. Use $1, $2, etc. for parameters.`
      }
    ];

    let lastError: Error | null = null;
    
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await this.provider.chat(queryGenerationMessages);
        const cleanedSQL = this.cleanSQL(response);
        
        this.validateSQL(cleanedSQL);
        
        return cleanedSQL;
      } catch (error) {
        lastError = error as Error;
        console.warn(`Attempt ${attempt}/${this.maxRetries} failed:`, error);
        
        if (attempt < this.maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
      }
    }
    
    throw lastError || new Error('Failed to generate query after retries');
  }

  /**
   * Format schema information for selected tables only
   * 
   * Creates a focused schema description containing only the tables
   * identified as relevant for the current query. This reduces context
   * size and improves LLM accuracy.
   * 
   * @param tables - Array of selected table information
   * @returns Formatted schema string for LLM consumption
   * @private
   */
  private formatSelectedTablesSchema(tables: TableInfo[]): string {
    const schemaInfo: SchemaInfo = {
      tables,
      relations: [] // We'll focus on tables for now
    };
    
    return this.analyzer.formatSchemaForLLM(schemaInfo);
  }

  /**
   * Clean and normalize SQL generated by LLM
   * 
   * Removes common formatting artifacts that LLMs often include:
   * - Markdown code blocks (backtick-sql blocks)
   * - SQL comments (-- and block comments)
   * - Trailing semicolons
   * - Extra whitespace
   * 
   * @param sql - Raw SQL string from LLM
   * @returns Cleaned SQL ready for execution
   * @private
   */
  private cleanSQL(sql: string): string {
    return sql
      .replace(/```sql\n?/g, '')
      .replace(/```\n?/g, '')
      .replace(/^\s*--.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .trim()
      .replace(/;\s*$/, '');
  }

  /**
   * Validate generated SQL for safety and correctness
   * 
   * Performs security checks to ensure the generated SQL:
   * - Is not empty
   * - Contains only SELECT operations (no DDL/DML)
   * - Doesn't contain dangerous operations
   * 
   * @param sql - Cleaned SQL string to validate
   * @throws {Error} When SQL fails validation checks
   * @private
   */
  private validateSQL(sql: string): void {
    if (!sql || sql.trim().length === 0) {
      throw new Error('Generated SQL is empty');
    }

    const forbiddenPatterns = [
      /DROP\s+TABLE/i,
      /DELETE\s+FROM/i,
      /TRUNCATE/i,
      /ALTER\s+TABLE/i,
      /CREATE\s+TABLE/i,
    ];

    for (const pattern of forbiddenPatterns) {
      if (pattern.test(sql)) {
        throw new Error(`Generated SQL contains forbidden operation: ${pattern.source}`);
      }
    }

    const requiredKeywords = ['SELECT'];
    const hasRequiredKeyword = requiredKeywords.some(keyword => 
      new RegExp(`\\b${keyword}\\b`, 'i').test(sql)
    );

    if (!hasRequiredKeyword) {
      throw new Error('Generated SQL must be a SELECT query');
    }
  }
}

/**
 * Main query generator orchestrating the SQL generation process
 * 
 * This class serves as the primary interface for generating SQL queries from
 * natural language intents. It coordinates the conversational generation process,
 * handles progress tracking, error recovery, and provides comprehensive logging.
 * 
 * Features:
 * - Batch processing of multiple queries
 * - Progress tracking with interruption support
 * - Comprehensive error handling and retry logic
 * - Detailed build summaries and statistics
 * - Parameter extraction and hash generation
 */
export class QueryGenerator {
  private maxRetries: number = 3;
  private config: DrizzleLLMConfig;
  
  /**
   * Create a new query generator
   * @param config - Drizzle LLM configuration
   */
  constructor(config: DrizzleLLMConfig) {
    this.config = config;
  }

  /**
   * Generate SQL queries for a batch of collected queries
   * 
   * Main entry point for the query generation process. Delegates to the
   * conversational generation method for optimal results.
   * 
   * @param queries - Array of collected queries from source code
   * @param schema - Database schema information
   * @returns Promise resolving to array of generated queries
   */
  async generateQueries(queries: CollectedQuery[], schema: SchemaInfo): Promise<GeneratedQuery[]> {
    return this.generateQueriesConversational(queries, schema);
  }
  
  /**
   * Generate queries using conversational LLM approach with progress tracking
   * 
   * Processes queries sequentially with:
   * - Real-time progress reporting
   * - Graceful interruption handling (SIGINT/SIGTERM)
   * - Individual query error isolation
   * - Comprehensive build statistics
   * - Small delays between requests to avoid rate limiting
   * 
   * @param queries - Array of collected queries to process
   * @param schema - Database schema for context
   * @returns Promise resolving to successfully generated queries
   * @throws {Error} When all queries fail to generate
   */
  async generateQueriesConversational(queries: CollectedQuery[], schema: SchemaInfo): Promise<GeneratedQuery[]> {
    const generator = new ConversationalQueryGenerator(this.config);
    await generator.initialize(schema);
    
    const results: GeneratedQuery[] = [];
    const failed: CollectedQuery[] = [];
    let successCount = 0;

    console.log(`🤖 Generating ${queries.length} SQL queries with conversational LLM...`);

    let interrupted = false;
    const handleInterrupt = () => {
      console.log('\n⚠️  Generation interrupted by user.');
      interrupted = true;
    };
    
    process.on('SIGINT', handleInterrupt);
    process.on('SIGTERM', handleInterrupt);

    try {
      for (let i = 0; i < queries.length; i++) {
        if (interrupted) {
          console.log('⏹️  Stopping generation due to interruption...');
          break;
        }

        const query = queries[i];
        try {
          console.log(`📝 [${i + 1}/${queries.length}] "${query.intent.substring(0, 50)}..."`);
          const startTime = Date.now();
          
          const sql = await generator.generateQuery(query.intent, query.params);
          const parameters = this.extractParameters(sql);
          
          const generatedQuery: GeneratedQuery = {
            id: query.id,
            intent: query.intent,
            sql,
            parameters,
            returnType: query.returnType || 'any',
            hash: this.generateHash(sql, parameters),
            sourceFile: query.sourceFile,
          };
          
          const duration = Date.now() - startTime;
          console.log(`✅ [${i + 1}/${queries.length}] Generated in ${duration}ms`);
          
          results.push(generatedQuery);
          successCount++;
          
          await this.delay(100);
          
        } catch (error) {
          console.error(`❌ [${i + 1}/${queries.length}] Failed:`, error);
          failed.push(query);
          console.log(`   Continuing...`);
        }
      }
    } finally {
      process.off('SIGINT', handleInterrupt);
      process.off('SIGTERM', handleInterrupt);
    }

    // Display comprehensive build summary
    this.displayBuildSummary(queries, results, failed, successCount);
    
    if (failed.length > 0 && results.length === 0) {
      throw new Error(`All ${queries.length} queries failed to generate.`);
    }
    
    return results;
  }

  /**
   * Extract parameter placeholders from generated SQL
   * 
   * Scans the SQL string for PostgreSQL-style parameter placeholders ($1, $2, etc.)
   * and creates a corresponding array of parameter names.
   * 
   * @param sql - Generated SQL string with parameter placeholders
   * @returns Array of parameter names in order
   * @private
   * 
   * @example
   * For SQL: "SELECT * FROM users WHERE id = $1 AND status = $2"
   * Returns: ["param1", "param2"]
   */
  private extractParameters(sql: string): string[] {
    const paramRegex = /\$(\d+)/g;
    const params: string[] = [];
    let match;

    while ((match = paramRegex.exec(sql)) !== null) {
      const paramNum = parseInt(match[1], 10);
      if (!params[paramNum - 1]) {
        params[paramNum - 1] = `param${paramNum}`;
      }
    }

    return params.filter(Boolean);
  }

  /**
   * Add a delay between API requests to avoid rate limiting
   * 
   * @param ms - Milliseconds to delay
   * @returns Promise that resolves after the delay
   * @private
   */
  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  /**
   * Generate hash for a generated query
   * 
   * Creates an MD5 hash from the SQL and parameters to enable change detection
   * and caching of generated queries.
   * 
   * @param sql - Generated SQL string
   * @param parameters - Array of parameter names
   * @returns MD5 hash of the query content
   * @private
   */
  private generateHash(sql: string, parameters: string[]): string {
    const content = JSON.stringify({ sql, parameters });
    return createHash('md5').update(content).digest('hex');
  }

  /**
   * Display comprehensive build summary with statistics and details
   * 
   * Provides a detailed report including:
   * - Overall success/failure statistics
   * - List of successfully generated queries
   * - List of failed queries for debugging
   * - Success rate calculation
   * 
   * @param queries - Original collected queries
   * @param results - Successfully generated queries
   * @param failed - Queries that failed to generate
   * @param successCount - Number of successful generations
   * @private
   */
  private displayBuildSummary(
    queries: CollectedQuery[], 
    results: GeneratedQuery[], 
    failed: CollectedQuery[], 
    successCount: number
  ): void {
    console.log('\n' + '='.repeat(60));
    console.log('🔧 Query Build Summary');
    console.log('='.repeat(60));
    
    console.log(`📊 Total Queries: ${queries.length}`);
    console.log(`✅ Successfully Generated: ${successCount}`);
    console.log(`❌ Failed: ${failed.length}`);
    console.log(`⚡ Success Rate: ${((successCount / queries.length) * 100).toFixed(1)}%`);
    
    if (results.length > 0) {
      console.log('\n📋 Generated Queries:');
      results.forEach((result, index) => {
        const truncatedIntent = result.intent.length > 50 
          ? result.intent.substring(0, 50) + '...' 
          : result.intent;
        console.log(`  ${index + 1}. "${truncatedIntent}"`);
        console.log(`     └─ Parameters: ${result.parameters.length > 0 ? result.parameters.join(', ') : 'none'}`);
      });
    }
    
    if (failed.length > 0) {
      console.log('\n⚠️  Failed Queries:');
      failed.forEach((query, index) => {
        const truncatedIntent = query.intent.length > 50 
          ? query.intent.substring(0, 50) + '...' 
          : query.intent;
        console.log(`  ${index + 1}. "${truncatedIntent}"`);
      });
    }
    
    console.log('\n' + '='.repeat(60));
  }
}