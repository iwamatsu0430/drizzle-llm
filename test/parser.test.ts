import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { QueryParser } from '../src/parser';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';

describe('QueryParser', () => {
  let parser: QueryParser;
  const testDir = './test-temp';

  beforeEach(() => {
    parser = new QueryParser();
    
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

  it('should collect simple db.llm() calls', () => {
    const testFile = join(testDir, 'test.ts');
    const content = `
      const users = await db.llm("Get all users");
    `;
    
    writeFileSync(testFile, content);
    
    const queries = parser.collectQueries([testFile]);
    
    expect(queries).toHaveLength(1);
    expect(queries[0].intent).toBe('Get all users');
    expect(queries[0].params).toBeUndefined();
  });

  it('should collect db.llm() calls with parameters', () => {
    const testFile = join(testDir, 'test.ts');
    const content = `
      const users = await db.llm("Get users by status", { status: "active" });
    `;
    
    writeFileSync(testFile, content);
    
    const queries = parser.collectQueries([testFile]);
    
    expect(queries).toHaveLength(1);
    expect(queries[0].intent).toBe('Get users by status');
    expect(queries[0].params).toEqual({ status: "active" });
  });

  it('should collect db.llm() calls with type annotations', () => {
    const testFile = join(testDir, 'test.ts');
    const content = `async function test() {
  const users = await db.llm<User>("Get all users");
}`;
    
    writeFileSync(testFile, content);
    
    const queries = parser.collectQueries([testFile]);
    
    expect(queries).toHaveLength(1);
    expect(queries[0].returnType).toBe('User');
  });

  it('should ignore non-db.llm() calls', () => {
    const testFile = join(testDir, 'test.ts');
    const content = `
      const users = await db.select().from(userTable);
      const result = someOtherFunction.llm("test");
    `;
    
    writeFileSync(testFile, content);
    
    const queries = parser.collectQueries([testFile]);
    
    expect(queries).toHaveLength(0);
  });

  it('should generate unique IDs for different queries', () => {
    const testFile = join(testDir, 'test.ts');
    const content = `
      const users = await db.llm("Get all users");
      const posts = await db.llm("Get all posts");
    `;
    
    writeFileSync(testFile, content);
    
    const queries = parser.collectQueries([testFile]);
    
    expect(queries).toHaveLength(2);
    expect(queries[0].id).not.toBe(queries[1].id);
  });
});