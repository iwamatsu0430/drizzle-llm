// Generated queries for analytics
// This file is auto-generated. Do not edit manually.

import { registerQueries } from 'drizzle-llm/runtime';

import type { {
    totalUsers: number;
    totalProducts: number;
    totalSales: number;
    totalRevenue: number;
  }, {
    categoryId: string;
    categoryName: string;
    productCount: number;
    totalRevenue: number;
    avgProductPrice: number;
  }, {
    productId: string;
    productName: string;
    currentStock: number;
    salesLastMonth: number;
    estimatedDaysLeft: number;
  } } from './analytics';

export interface AnalyticsQueries {
  '43406fa2281aaff9e9dbec90fdaf80bd': {
    totalUsers: number;
    totalProducts: number;
    totalSales: number;
    totalRevenue: number;
  }[];
  '72a7b3b3dd8d152da0213f7213da7696': {
    categoryId: string;
    categoryName: string;
    productCount: number;
    totalRevenue: number;
    avgProductPrice: number;
  }[];
  '623d6a160d31cff2bfe85eb5e0eb4c19': {
    productId: string;
    productName: string;
    currentStock: number;
    salesLastMonth: number;
    estimatedDaysLeft: number;
  }[];
}

export const analyticsQueries = {
  '43406fa2281aaff9e9dbec90fdaf80bd': {
    parameters: []
  },
  '72a7b3b3dd8d152da0213f7213da7696': {
    parameters: []
  },
  '623d6a160d31cff2bfe85eb5e0eb4c19': {
    parameters: []
  }
};

// Intent to query ID mapping
export const analyticsIntentToId: Record<string, string> = {
  "Get dashboard metrics: count of users, active products, completed sales, and total revenue in a single query": "43406fa2281aaff9e9dbec90fdaf80bd",
  "Analyze performance by category showing product count, total revenue, and average product price": "72a7b3b3dd8d152da0213f7213da7696",
  "Generate inventory alerts for products that might run out soon based on current stock and sales velocity from last 30 days": "623d6a160d31cff2bfe85eb5e0eb4c19"
};

// Auto-register queries when this file is imported
registerQueries(analyticsQueries, analyticsIntentToId);
