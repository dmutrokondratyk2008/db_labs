# =====================================================================
# Лабораторна робота 7. run-all.ps1
# Повний прогін: створення бази, наповнення, усі скрипти mongosh,
# реляційна модель у PostgreSQL, тести API, кешу і порівняльний бенчмарк.
# Вивід кожного кроку зберігається в results\NN_назва.txt.
# Перед запуском: служба MongoDB, контейнер car_import_db (docker start car_import_db).
# Сервер blog-app має бути запущений окремо (npm start) для кроків 16-17.
# Запуск: powershell -ExecutionPolicy Bypass -File .\run-all.ps1
# =====================================================================
$ErrorActionPreference = 'Continue'   # NOTICE-повідомлення psql і docker ідуть у stderr - це не помилки
$root = $PSScriptRoot
$res = Join-Path $root 'results'
New-Item -ItemType Directory -Force $res | Out-Null
$env:PYTHONIOENCODING = 'utf-8'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

function Step($name, [scriptblock]$cmd) {
    Write-Host "== $name" -ForegroundColor Cyan
    $out = & $cmd 2>&1 | Out-String
    $out | Set-Content -Encoding utf8 (Join-Path $res "$name.txt")
    if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { Write-Host $out; throw "Крок $name завершився з помилкою" }
}

$scripts = '01_create_collections', '02_indexes', '03_seed', '04_aggregations', '05_index_check', '06_tags_fulltext',
           '07_ratings_views', '08_pagination', '09_moderation', '10_versioning', '11_nested_comments',
           '12_notifications', '13_geo', '14_bench_generate'
foreach ($s in $scripts) { Step $s { mongosh --quiet --file (Join-Path $root "scripts\$s.js") } }

# PostgreSQL: база blog_system у контейнері car_import_db
Step 'pg_00_prepare' {
    docker exec car_import_db psql -U postgres -c 'DROP DATABASE IF EXISTS blog_system' -c 'CREATE DATABASE blog_system'
    docker exec car_import_db rm -rf /tmp/lab07 /tmp/lab07sql
    docker cp (Join-Path $root 'export') car_import_db:/tmp/lab07
    docker cp (Join-Path $root 'sql') car_import_db:/tmp/lab07sql
}
Step 'pg_01_schema'  { docker exec car_import_db psql -U postgres -d blog_system -f /tmp/lab07sql/01_schema.sql }
Step 'pg_02_load'    { docker exec car_import_db psql -U postgres -d blog_system -f /tmp/lab07sql/02_load_bench.sql; $global:LASTEXITCODE = 0 }
Step 'pg_03_queries' { docker exec car_import_db psql -U postgres -d blog_system -f /tmp/lab07sql/03_queries.sql }

Push-Location (Join-Path $root 'blog-app')
Step '16_api_test'   { node test/api-test.js }
Step '17_cache_bench' { node bench/cache-bench.js }
Step '18_compare'    { node bench/compare.js }
Pop-Location
Step '19_optimization' { mongosh --quiet --file (Join-Path $root 'scripts\15_optimization.js') }

Write-Host "Готово. Результати: $res" -ForegroundColor Green
