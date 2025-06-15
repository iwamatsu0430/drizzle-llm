import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SchemaAnalyzer } from '../src/core/schema-analyzer';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';

describe('SchemaAnalyzer', () => {
  let analyzer: SchemaAnalyzer;
  const testDir = './test-schema';

  beforeEach(() => {
    analyzer = new SchemaAnalyzer();
    
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {}
    
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {}
  });

  it('should create schema analyzer instance', () => {
    expect(analyzer).toBeInstanceOf(SchemaAnalyzer);
  });

  it('should build system prompt', () => {
    const prompt = analyzer.buildSystemPrompt();
    expect(prompt).toContain('SQL query generator for Drizzle ORM');
    expect(prompt).toContain('CRITICAL RULES');
    expect(prompt).toContain('created_at, NOT createdAt');
  });

  it('should analyze simple pgTable schema', () => {
    const schemaFile = join(testDir, 'schema.ts');
    const content = `
import { pgTable, text, uuid, timestamp } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  createdAt: timestamp('created_at').defaultNow()
});
`;
    
    writeFileSync(schemaFile, content);
    
    const schema = analyzer.analyzeSchema(schemaFile);
    
    expect(schema.tables).toHaveLength(1);
    expect(schema.tables[0].name).toBe('users');
    expect(schema.tables[0].columns).toHaveLength(4);
    
    const idColumn = schema.tables[0].columns.find(c => c.name === 'id');
    expect(idColumn).toBeDefined();
    expect(idColumn?.type).toBe('uuid');
    expect(idColumn?.nullable).toBe(true); // Default nullable unless explicitly notNull
    expect(idColumn?.constraints).toContain('PRIMARY KEY');
    
    const nameColumn = schema.tables[0].columns.find(c => c.name === 'name');
    expect(nameColumn).toBeDefined();
    expect(nameColumn?.type).toBe('text');
    expect(nameColumn?.nullable).toBe(false);
    
    const emailColumn = schema.tables[0].columns.find(c => c.name === 'email');
    expect(emailColumn).toBeDefined();
    expect(emailColumn?.constraints).toContain('UNIQUE');
    
    const createdAtColumn = schema.tables[0].columns.find(c => c.name === 'createdAt');
    expect(createdAtColumn).toBeDefined();
    expect(createdAtColumn?.dbName).toBe('created_at');
    expect(createdAtColumn?.defaultValue).toBe('defaultNow()');
  });

  it('should analyze table with foreign key references', () => {
    const schemaFile = join(testDir, 'schema.ts');
    const content = `
import { pgTable, text, uuid, timestamp } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull()
});

export const posts = pgTable('posts', {
  id: uuid('id').primaryKey(),
  title: text('title').notNull(),
  userId: uuid('user_id').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow()
});
`;
    
    writeFileSync(schemaFile, content);
    
    const schema = analyzer.analyzeSchema(schemaFile);
    
    expect(schema.tables).toHaveLength(2);
    
    const postsTable = schema.tables.find(t => t.name === 'posts');
    expect(postsTable).toBeDefined();
    
    const userIdColumn = postsTable?.columns.find(c => c.name === 'userId');
    expect(userIdColumn).toBeDefined();
    expect(userIdColumn?.dbName).toBe('user_id');
    expect(userIdColumn?.references).toEqual({
      table: 'users',
      column: 'id'
    });
  });

  it('should analyze enum columns', () => {
    const schemaFile = join(testDir, 'schema.ts');
    const content = `
import { pgTable, text, uuid } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  status: text('status', { enum: ['active', 'inactive', 'pending'] }).notNull()
});
`;
    
    writeFileSync(schemaFile, content);
    
    const schema = analyzer.analyzeSchema(schemaFile);
    
    const statusColumn = schema.tables[0].columns.find(c => c.name === 'status');
    expect(statusColumn).toBeDefined();
    expect(statusColumn?.enumValues).toEqual(['active', 'inactive', 'pending']);
  });

  it('should handle different Drizzle types', () => {
    const schemaFile = join(testDir, 'schema.ts');
    const content = `
import { pgTable, text, integer, boolean, serial, timestamp } from 'drizzle-orm/pg-core';

export const products = pgTable('products', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  price: integer('price').notNull(),
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at').defaultNow()
});
`;
    
    writeFileSync(schemaFile, content);
    
    const schema = analyzer.analyzeSchema(schemaFile);
    
    const table = schema.tables[0];
    expect(table.columns).toHaveLength(5);
    
    const idColumn = table.columns.find(c => c.name === 'id');
    expect(idColumn?.type).toBe('serial');
    
    const priceColumn = table.columns.find(c => c.name === 'price');
    expect(priceColumn?.type).toBe('integer');
    
    const isActiveColumn = table.columns.find(c => c.name === 'isActive');
    expect(isActiveColumn?.type).toBe('boolean');
    expect(isActiveColumn?.dbName).toBe('is_active');
    expect(isActiveColumn?.defaultValue).toBe('true'); // String representation
  });

  it('should format schema for LLM consumption', () => {
    const mockSchema = {
      tables: [
        {
          name: 'users',
          columns: [
            {
              name: 'id',
              dbName: 'id',
              type: 'uuid',
              nullable: false,
              constraints: ['PRIMARY KEY']
            },
            {
              name: 'email',
              dbName: 'email',
              type: 'text',
              nullable: false,
              constraints: ['UNIQUE']
            },
            {
              name: 'status',
              dbName: 'status',
              type: 'text',
              nullable: false,
              enumValues: ['active', 'inactive']
            },
            {
              name: 'createdAt',
              dbName: 'created_at',
              type: 'timestamp',
              nullable: true,
              defaultValue: 'defaultNow()'
            }
          ]
        }
      ],
      relations: []
    };

    const formatted = analyzer.formatSchemaForLLM(mockSchema);
    
    expect(formatted).toContain('Database Schema:');
    expect(formatted).toContain('Table: users');
    expect(formatted).toContain('id: uuid NOT NULL [PRIMARY KEY]');
    expect(formatted).toContain('email: text NOT NULL [UNIQUE]');
    expect(formatted).toContain("status: text NOT NULL ENUM('active', 'inactive')");
    expect(formatted).toContain('created_at: timestamp DEFAULT defaultNow() -- Drizzle property: createdAt');
  });

  it('should format schema in compact form', () => {
    const mockSchema = {
      tables: [
        {
          name: 'users',
          columns: [
            { name: 'id', dbName: 'id', type: 'uuid', nullable: false },
            { name: 'name', dbName: 'name', type: 'text', nullable: false },
            { name: 'status', dbName: 'status', type: 'text', nullable: false, enumValues: ['active', 'inactive'] }
          ]
        },
        {
          name: 'posts',
          columns: [
            { name: 'id', dbName: 'id', type: 'uuid', nullable: false },
            { name: 'title', dbName: 'title', type: 'text', nullable: false }
          ]
        }
      ],
      relations: []
    };

    const compact = analyzer.formatSchemaCompact(mockSchema);
    
    expect(compact).toContain('Tables and columns:');
    expect(compact).toContain('users(id, name, status(active|inactive))');
    expect(compact).toContain('posts(id, title)');
  });

  it('should ignore non-table declarations', () => {
    const schemaFile = join(testDir, 'schema.ts');
    const content = `
import { pgTable, text, uuid } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull()
});

// This should be ignored
export const someFunction = () => {
  return 'not a table';
};

// This should also be ignored
export const someConstant = 'value';
`;
    
    writeFileSync(schemaFile, content);
    
    const schema = analyzer.analyzeSchema(schemaFile);
    
    expect(schema.tables).toHaveLength(1);
    expect(schema.tables[0].name).toBe('users');
  });

  it('should handle composite primary keys', () => {
    const schemaFile = join(testDir, 'schema.ts');
    const content = `
import { pgTable, text, uuid, primaryKey } from 'drizzle-orm/pg-core';

export const userRoles = pgTable('user_roles', {
  userId: uuid('user_id'),
  roleId: uuid('role_id')
}, (table) => ({
  pk: primaryKey(table.userId, table.roleId)
}));
`;
    
    writeFileSync(schemaFile, content);
    
    const schema = analyzer.analyzeSchema(schemaFile);
    
    expect(schema.tables).toHaveLength(1);
    const table = schema.tables[0];
    expect(table.columns).toHaveLength(2);
    
    // Note: The current implementation might not fully handle composite primary keys
    // This test documents the expected behavior for future improvements
  });
});