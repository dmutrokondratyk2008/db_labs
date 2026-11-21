# =====================================================================
# Лабораторна робота 6. replica/start-replica.ps1
# Запуск трьох екземплярів mongod як набору реплік rs0 на одному ПК
# (порти 27018, 27019, 27020). Основний сервер library (служба
# MongoDB, порт 27017) не змінюється.
# Запуск: powershell -ExecutionPolicy Bypass -File .\replica\start-replica.ps1
# =====================================================================
param(
    [int[]]$Ports = @(27018, 27019, 27020),
    [string]$ReplSet = 'rs0'
)
$ErrorActionPreference = 'Stop'
$mongod = (Get-ChildItem 'C:\Program Files\MongoDB\Server\*\bin\mongod.exe' | Sort-Object FullName | Select-Object -Last 1).FullName
$root   = Join-Path $PSScriptRoot 'data'

foreach ($p in $Ports) {
    $busy = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue
    if ($busy) { Write-Host "порт $p уже слухає (PID $($busy.OwningProcess)) - пропуск"; continue }
    $dir = Join-Path $root "rs$p"
    New-Item -ItemType Directory -Force $dir | Out-Null
    $argList = @('--replSet', $ReplSet, '--port', $p, '--bind_ip', '127.0.0.1',
              '--dbpath', "`"$dir`"", '--logpath', "`"$(Join-Path $root "rs$p.log")`"", '--logappend',
              '--wiredTigerCacheSizeGB', '0.25')
    $proc = Start-Process -FilePath $mongod -ArgumentList $argList -WindowStyle Hidden -PassThru
    Write-Host ("mongod {0} запущено: PID {1}, dbpath {2}" -f $p, $proc.Id, $dir)
}

# очікування, поки всі вузли почнуть приймати з'єднання
foreach ($p in $Ports) {
    for ($i = 0; $i -lt 30; $i++) {
        if (Test-NetConnection 127.0.0.1 -Port $p -InformationLevel Quiet -WarningAction SilentlyContinue) { break }
        Start-Sleep -Milliseconds 500
    }
}
Get-NetTCPConnection -LocalPort $Ports -State Listen |
    Select-Object LocalPort, OwningProcess, @{n='Process';e={(Get-Process -Id $_.OwningProcess).ProcessName}} |
    Sort-Object LocalPort | Format-Table -AutoSize
