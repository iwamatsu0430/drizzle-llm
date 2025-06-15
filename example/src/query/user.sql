-- 8c381e8b6af5a90ebcf8c72a27bd3a49
-- Find the user name by id ${0}
SELECT name FROM user WHERE id = $1

-- 5eed765f7bd9b64c48e08823ad321f38
-- ユーザーを全件取得する
SELECT id, name, age FROM user

-- 1cc99f0e4ef8e0aa88d7ed06d7f43bd1
-- ユーザーの平均年齢を取得する
SELECT AVG(age) FROM user
