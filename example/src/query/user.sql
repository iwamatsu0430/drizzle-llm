-- 66ca7bdd273aaa80668e05b7a1f0a72c
-- ユーザーIDが ${0} のユーザーを取得
SELECT id, name, age FROM "user" WHERE id = $1

-- 169949bcfea717f3fe214df933bdf379
-- すべてのユーザーを取得する
SELECT id, name, age FROM user

-- 5eba36b56e582656ff53935dd8550bbd
-- Find users with age ${0}
SELECT "id", "name", "age" FROM "user" WHERE "age" = $1
