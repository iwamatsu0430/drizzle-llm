// Generated queries for sales
// This file is auto-generated. Do not edit manually.

import { registerQueries } from 'drizzle-llm/runtime';

import type { SalesReport, ProductSalesReport } from './types';

export interface SalesQueries {
  'f57fc6baaa81b46afe1f87c83b4a9774': SalesReport[];
  'dafa77dc58e0dc13332d60a72cf76638': ProductSalesReport[];
  '2287ea2d950501175d198f178566ad05': {
    month: string;
    revenue: number;
    previousMonthRevenue: number;
    growthRate: number;
    cumulativeRevenue: number;
  }[];
}

export const salesQueries = {
  'f57fc6baaa81b46afe1f87c83b4a9774': {
    parameters: []
  },
  'dafa77dc58e0dc13332d60a72cf76638': {
    parameters: ["param1"]
  },
  '2287ea2d950501175d198f178566ad05': {
    parameters: ["param1"]
  }
};

// Intent to query ID mapping
export const salesIntentToId: Record<string, string> = {
  "ユーザー別の売上分析（総売上件数、総売上金額、平均注文金額）をユーザー名と共に売上金額降順で取得": "f57fc6baaa81b46afe1f87c83b4a9774",
  "過去${0}日間で最も売れた商品を、売上数量・売上金額・売上回数と前期比成長率と一緒に表示": "dafa77dc58e0dc13332d60a72cf76638",
  "${0}年の月別売上を取得し、前月比の成長率と年累計売上も一緒に表示": "2287ea2d950501175d198f178566ad05"
};

// Auto-register queries when this file is imported
registerQueries(salesQueries, salesIntentToId);
