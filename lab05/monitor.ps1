<#
  monitor.ps1 - автоматизований моніторинг продуктивності бази car_import.

  Виконує sql/19_monitoring.sql у контейнері car_import_db, виводить звіт
  на екран, зберігає його у reports/monitor_<дата_час>.txt і підсвічує
  попередження.

  Приклади:
    .\monitor.ps1                          # один звіт
    .\monitor.ps1 -Count 12 -IntervalSec 300   # 12 звітів кожні 5 хвилин
  Для запуску за розкладом:
    Register-ScheduledTask -TaskName "car_import monitor" `
      -Trigger (New-ScheduledTaskTrigger -Daily -At 08:00) `
      -Action (New-ScheduledTaskAction -Execute "powershell.exe" `
               -Argument "-File `"$PSScriptRoot\monitor.ps1`"")
#>
param(
    [int]$Count = 1,
    [int]$IntervalSec = 60,
    [string]$Container = "car_import_db",
    [string]$Database = "car_import"
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8   # вивід psql у UTF-8

$reports = Join-Path $PSScriptRoot "reports"
New-Item -ItemType Directory -Force -Path $reports | Out-Null
docker cp "$PSScriptRoot\sql\19_monitoring.sql" "${Container}:/tmp/19_monitoring.sql" | Out-Null

for ($i = 1; $i -le $Count; $i++) {
    $stamp  = Get-Date -Format "yyyyMMdd_HHmmss"
    $file   = Join-Path $reports "monitor_$stamp.txt"
    $header = "Моніторинг $Database, $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), звіт $i з $Count"

    $out = docker exec $Container psql -U postgres -d $Database -P pager=off -f /tmp/19_monitoring.sql
    @($header) + $out | Set-Content -Path $file -Encoding UTF8

    Write-Host $header -ForegroundColor Cyan
    foreach ($line in $out) {
        if ($line -match "УВАГА|заблоковано") { Write-Host $line -ForegroundColor Yellow }
        elseif ($line -like "===*")            { Write-Host $line -ForegroundColor Green }
        else                                   { Write-Host $line }
    }
    $warnings = @($out | Where-Object { $_ -match "УВАГА|заблоковано" }).Count
    Write-Host "Попереджень: $warnings. Звіт збережено: $file" -ForegroundColor Cyan

    if ($i -lt $Count) { Start-Sleep -Seconds $IntervalSec }
}
