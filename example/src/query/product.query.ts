// Generated queries for product
// This file is auto-generated. Do not edit manually.

import { registerQueries } from 'drizzle-llm/runtime';

import type { Product } from './types';

export interface ProductQueries {
  'f3ea3c1d75f832a989180fcf6b5da8e9': Product[];
  '6a4bc30e62edac15fbcae689f5af1384': Product[];
  '2d0af163c73b30e1568baa1db0eb1de4': Product[];
  'f96635a2e44515858ba642ab42a6ff29': Product & { categoryName?: string }[];
}

export const productQueries = {
  'f3ea3c1d75f832a989180fcf6b5da8e9': {
    parameters: []
  },
  '6a4bc30e62edac15fbcae689f5af1384': {
    parameters: ["param1","param2"]
  },
  '2d0af163c73b30e1568baa1db0eb1de4': {
    parameters: ["param1"]
  },
  'f96635a2e44515858ba642ab42a6ff29': {
    parameters: []
  }
};

// Intent to query ID mapping
export const productIntentToId: Record<string, string> = {
  "アクティブな商品を名前順で取得する": "f3ea3c1d75f832a989180fcf6b5da8e9",
  "価格が ${0} 円以上 ${${1} 円以下の商品を検索": "6a4bc30e62edac15fbcae689f5af1384",
  "在庫が${0}個以下のアクティブな商品を在庫の少ない順で表示": "2d0af163c73b30e1568baa1db0eb1de4",
  "すべての商品をカテゴリ名と一緒に表示する": "f96635a2e44515858ba642ab42a6ff29"
};

// Auto-register queries when this file is imported
registerQueries(productQueries, productIntentToId);
