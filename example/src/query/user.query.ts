// Generated queries for user
// This file is auto-generated. Do not edit manually.

import { registerQueries } from 'drizzle-llm/runtime';

import type { User } from './types';

export interface UserQueries {
  '8c381e8b6af5a90ebcf8c72a27bd3a49': string[];
  '5eed765f7bd9b64c48e08823ad321f38': User[];
  '1cc99f0e4ef8e0aa88d7ed06d7f43bd1': number[];
}

export const userQueries = {
  '8c381e8b6af5a90ebcf8c72a27bd3a49': {
    parameters: ["param1"]
  },
  '5eed765f7bd9b64c48e08823ad321f38': {
    parameters: []
  },
  '1cc99f0e4ef8e0aa88d7ed06d7f43bd1': {
    parameters: []
  }
};

// Intent to query ID mapping
export const userIntentToId: Record<string, string> = {
  "Find the user name by id ${0}": "8c381e8b6af5a90ebcf8c72a27bd3a49",
  "ユーザーを全件取得する": "5eed765f7bd9b64c48e08823ad321f38",
  "ユーザーの平均年齢を取得する": "1cc99f0e4ef8e0aa88d7ed06d7f43bd1"
};

// Auto-register queries when this file is imported
registerQueries(userQueries, userIntentToId);
