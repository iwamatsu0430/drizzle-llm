export interface User {
  id: string;
  name: string;
  age: number;
}

export interface Product {
  id: string;
  name: string;
  price: number;
  categoryId?: string;
  stock: number;
  description?: string;
  isActive: boolean;
  createdAt: string;
}

export interface Category {
  id: string;
  name: string;
  parentId?: string;
}

export interface Sales {
  id: string;
  userId: string;
  productId: string;
  quantity: number;
  unitPrice: number;
  totalAmount: number;
  saleDate: string;
  status: "pending" | "completed" | "cancelled";
}

export interface SalesSummary {
  id: string;
  userId: string;
  totalSales: number;
  totalAmount: number;
  lastSaleDate?: string;
}

export interface SalesReport {
  userId: string;
  userName: string;
  totalSales: number;
  totalAmount: number;
  averageOrderValue: number;
}

export interface ProductSalesReport {
  productId: string;
  productName: string;
  totalQuantity: number;
  totalRevenue: number;
  salesCount: number;
}
