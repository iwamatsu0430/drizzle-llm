-- 43406fa2281aaff9e9dbec90fdaf80bd
-- Get dashboard metrics: count of users, active products, completed sales, and total revenue in a single query
SELECT 
  (SELECT COUNT(*) FROM user) AS totalUsers,
  (SELECT COUNT(*) FROM product WHERE isActive = 'true') AS totalProducts,
  (SELECT COUNT(*) FROM sales WHERE status = 'completed') AS totalSales,
  (SELECT COALESCE(SUM(totalAmount), 0) FROM sales WHERE status = 'completed') AS totalRevenue

-- 72a7b3b3dd8d152da0213f7213da7696
-- Analyze performance by category showing product count, total revenue, and average product price
SELECT 
  c.id as "categoryId", 
  c.name as "categoryName", 
  COUNT(p.id) as "productCount", 
  SUM(s.total_amount) as "totalRevenue", 
  AVG(p.price) as "avgProductPrice"
FROM 
  category c
  LEFT JOIN product p ON c.id = p.category_id
  LEFT JOIN sales s ON p.id = s.product_id
GROUP BY 
  c.id, c.name

-- 623d6a160d31cff2bfe85eb5e0eb4c19
-- Generate inventory alerts for products that might run out soon based on current stock and sales velocity from last 30 days
SELECT 
  p.id AS "productId",
  p.name AS "productName", 
  p.stock AS "currentStock",
  COALESCE(SUM(s.quantity), 0) AS "salesLastMonth",
  CASE 
    WHEN COALESCE(SUM(s.quantity), 0) > 0 
    THEN ROUND((p.stock * 30.0) / SUM(s.quantity))
    ELSE NULL 
  END AS "estimatedDaysLeft"
FROM 
  product p
LEFT JOIN 
  sales s ON p.id = s.productId AND s.saleDate >= datetime('now', '-30 days') AND s.status != 'cancelled'
WHERE 
  p.is_active = 'true'
GROUP BY 
  p.id, p.name, p.stock
HAVING 
  p.stock < 20 OR (COALESCE(SUM(s.quantity), 0) > 0 AND (p.stock * 30.0) / SUM(s.quantity) < 15)
ORDER BY 
  "estimatedDaysLeft" ASC NULLS LAST
