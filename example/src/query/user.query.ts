// Generated queries for user
// This file is auto-generated. Do not edit manually.

import { registerQueries } from 'drizzle-llm/runtime';

import type { User } from './types';

export interface UserQueries {
  '66ca7bdd273aaa80668e05b7a1f0a72c': User[];
  '169949bcfea717f3fe214df933bdf379': User[];
  '5eba36b56e582656ff53935dd8550bbd': User[];
}

export const userQueries = {
  '66ca7bdd273aaa80668e05b7a1f0a72c': {
    parameters: ["param1"]
  },
  '169949bcfea717f3fe214df933bdf379': {
    parameters: []
  },
  '5eba36b56e582656ff53935dd8550bbd': {
    parameters: ["param1"]
  }
};

// Intent to query ID mapping
export const userIntentToId: Record<string, string> = {
  "ユーザーIDが ${0} のユーザーを取得": "66ca7bdd273aaa80668e05b7a1f0a72c",
  "すべてのユーザーを取得する": "169949bcfea717f3fe214df933bdf379",
  "Find users with age ${0}": "5eba36b56e582656ff53935dd8550bbd"
};

// Auto-register queries when this file is imported
registerQueries(userQueries, userIntentToId);
