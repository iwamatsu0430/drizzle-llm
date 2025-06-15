-- f57fc6baaa81b46afe1f87c83b4a9774
-- ユーザー別の売上分析（総売上件数、総売上金額、平均注文金額）をユーザー名と共に売上金額降順で取得
SELECT 
  u.name,
  COUNT(s.id) as total_sales,
  SUM(s.totalAmount) as total_revenue,
  AVG(s.totalAmount) as average_order_value
FROM 
  sales s
JOIN 
  user u ON s.userId = u.id
GROUP BY 
  s.userId, u.name
ORDER BY 
  total_revenue DESC

-- dafa77dc58e0dc13332d60a72cf76638
-- 過去${0}日間で最も売れた商品を、売上数量・売上金額・売上回数と前期比成長率と一緒に表示
SELECT
  p.id,
  p.name,
  p.price,
  SUM(s.quantity) as total_quantity,
  SUM(s.total_amount) as total_revenue,
  COUNT(s.id) as sale_count,
  (SUM(s.total_amount) - LAG(SUM(s.total_amount)) OVER (PARTITION BY p.id ORDER BY p.id)) / LAG(SUM(s.total_amount)) OVER (PARTITION BY p.id ORDER BY p.id) * 100 as growth_rate
FROM product p
JOIN sales s ON p.id = s.product_id
WHERE s.sale_date >= datetime('now', '-' || $1 || ' days')
  AND s.status = 'completed'
GROUP BY p.id, p.name, p.price
ORDER BY total_quantity DESC
LIMIT 10

-- 2287ea2d950501175d198f178566ad05
-- ${0}年の月別売上を取得し、前月比の成長率と年累計売上も一緒に表示
WITH monthly_revenue AS (
  SELECT 
    strftime('%Y-%m', sale_date) as month,
    SUM(total_amount) as revenue
  FROM sales
  WHERE strftime('%Y', sale_date) = $1
  GROUP BY strftime('%Y-%m', sale_date)
),
with_previous AS (
  SELECT 
    month,
    revenue,
    LAG(revenue) OVER (ORDER BY month) as previous_month_revenue
  FROM monthly_revenue
),
with_cumulative AS (
  SELECT 
    month,
    revenue,
    previous_month_revenue,
    CASE 
      WHEN previous_month_revenue IS NULL OR previous_month_revenue = 0 THEN NULL
      ELSE (revenue - previous_month_revenue) / previous_month_revenue * 100
    END as growth_rate,
    SUM(revenue) OVER (ORDER BY month) as cumulative_revenue
  FROM with_previous
)
SELECT 
  month,
  revenue,
  previous_month_revenue,
  growth_rate,
  cumulative_revenue
FROM with_cumulative
ORDER BY month
