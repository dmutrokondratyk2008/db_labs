<#
  maintenance.ps1 - повне обслуговування бази car_import.

  1) VACUUM (ANALYZE) усіх таблиць утилітою vacuumdb: VACUUM не можна
     виконати всередині процедури, бо він не працює в блоці транзакції;
  2) процедура maintain_database(): ANALYZE змінених таблиць, REINDEX
     фрагментованих індексів, оновлення матеріалізованих представлень;
  3) результат останнього запуску з maintenance_log.

  Для запуску щонеділі о 03:00:
    Register-ScheduledTask -TaskName "car_import maintenance" `
      -Trigger (New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At 03:00) `
      -Action (New-ScheduledTaskAction -Execute "powershell.exe" `
               -Argument "-File `"$PSScriptRoot\maintenance.ps1`"")
#>
param(
    [string]$Container = "car_import_db",
    [string]$Database  = "car_import"
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host "1. VACUUM (ANALYZE): vacuumdb, 4 паралельні процеси" -ForegroundColor Green
docker exec $Container vacuumdb -U postgres -d $Database --analyze --jobs 4

Write-Host "2. CALL maintain_database()" -ForegroundColor Green
docker exec $Container psql -U postgres -d $Database -c "CALL maintain_database();"

Write-Host "3. Журнал обслуговування" -ForegroundColor Green
docker exec $Container psql -U postgres -d $Database -P pager=off -c @"
SELECT operation, object_name, details, duration_ms
FROM maintenance_log
WHERE run_id = (SELECT MAX(run_id) FROM maintenance_log)
  AND operation IN ('REINDEX', 'REFRESH', 'SUMMARY')
ORDER BY log_id;
"@
