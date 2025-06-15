-- f3ea3c1d75f832a989180fcf6b5da8e9
-- アクティブな商品を名前順で取得する
SELECT id, name, price, categoryId, stock, description, isActive, createdAt FROM product WHERE isActive = true ORDER BY name ASC

-- 6a4bc30e62edac15fbcae689f5af1384
-- 価格が ${0} 円以上 ${${1} 円以下の商品を検索
SELECT id, name, price, categoryId, stock, description, isActive, createdAt FROM product WHERE price >= $1 AND price <= $2

-- 2d0af163c73b30e1568baa1db0eb1de4
-- 在庫が${0}個以下のアクティブな商品を在庫の少ない順で表示
SELECT id, name, price, categoryId, stock, description, isActive, createdAt FROM product WHERE stock <= $1 AND isActive = true ORDER BY stock ASC

-- f96635a2e44515858ba642ab42a6ff29
-- すべての商品をカテゴリ名と一緒に表示する
SELECT product.id, product.name, product.price, product.category_id, product.stock, product.description, product.is_active, product.created_at, category.name AS category_name
FROM product
LEFT JOIN category ON product.category_id = category.id
