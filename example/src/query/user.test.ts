import { describe, it, expect } from 'vitest';
import { TestDb } from '@/test/db';
import { findName, getAverageOfAge, list } from './user';
import './user.query'; // Import to register queries

describe('User Queries', () => {
  describe('findName', () => {
    it('should find user by id', async () => {
      await TestDb.using(async (db) => {
        const result = await findName(db, '1');
        expect(result).toBe('Alice');
      });
    });

    it('should return empty result for non-existent id', async () => {
      await TestDb.using(async (db) => {
        const result = await findName(db, '999');
        expect(result).toBe(null);
      });
    });
  });

  describe('list', () => {
    it('should return all users', async () => {
      await TestDb.using(async (db) => {
        const result = await list(db);
        expect(result).toBe([
          { id: '1', name: 'Alice', age: 30 },
          { id: '2', name: 'Bob', age: 25 },
          { id: '3', name: 'Charlie', age: 35 }
        ]);
      });
    });
  });

  describe('getAverageOfAge', () => {
    it('should return average age of users', async () => {
      await TestDb.using(async (db) => {
        const result = await getAverageOfAge(db);
        expect(result).toBe(30); // Assuming average of 30, 25, and 35
      });
    });
  });
});
