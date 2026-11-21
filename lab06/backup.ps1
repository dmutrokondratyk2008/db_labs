# =====================================================================
# Лабораторна робота 6. backup.ps1
# Автоматизоване резервне копіювання бази MongoDB утилітою mongodump.
#   - архів зі стисненням gzip: backups\<db>_<дата_час>.archive.gz;
#   - перевірка архіву: mongorestore --dryRun (читання всіх колекцій);
#   - ротація: зберігаються лише останні -Keep архівів;
#   - журнал: backups\backup.log;
#   - -Register: реєстрація щоденного завдання в Планувальнику Windows.
# Запуск: powershell -ExecutionPolicy Bypass -File .\backup.ps1 [-Keep 7]
# =====================================================================
param(
    [string]$Uri    = 'mongodb://localhost:27017',
    [string]$Db     = 'library',
    [string]$OutDir = (Join-Path $PSScriptRoot 'backups'),
    [int]$Keep      = 7,
    [switch]$Register,
    [string]$At     = '23:00'
)
$ErrorActionPreference = 'Stop'
$tools = (Get-ChildItem 'C:\Program Files\MongoDB\Tools\*\bin' -Directory | Sort-Object FullName | Select-Object -Last 1).FullName
$mongodump = Join-Path $tools 'mongodump.exe'
$mongorestore = Join-Path $tools 'mongorestore.exe'
New-Item -ItemType Directory -Force $OutDir | Out-Null
$log = Join-Path $OutDir 'backup.log'
function Write-Log([string]$m) {
    $line = '{0:yyyy-MM-dd HH:mm:ss}  {1}' -f (Get-Date), $m
    Write-Host $line
    Add-Content -Path $log -Value $line -Encoding UTF8
}

if ($Register) {
    # Щоденне завдання від імені поточного користувача
    $act = New-ScheduledTaskAction -Execute 'powershell.exe' `
        -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PSCommandPath`" -Db $Db -Keep $Keep"
    $trg = New-ScheduledTaskTrigger -Daily -At $At
    Register-ScheduledTask -TaskName "MongoDB backup $Db" -Action $act -Trigger $trg `
        -Description "Лаб. 6: щоденний mongodump бази $Db" -Force | Out-Null
    Get-ScheduledTask -TaskName "MongoDB backup $Db" |
        Select-Object TaskName, State, @{n='Next';e={(Get-ScheduledTaskInfo $_).NextRunTime}} | Format-Table -AutoSize
    return
}

$stamp   = Get-Date -Format 'yyyyMMdd_HHmmss'
$archive = Join-Path $OutDir "${Db}_$stamp.archive.gz"
Write-Log "СТАРТ резервного копіювання бази $Db ($Uri)"

# 1. Дамп. mongodump пише прогрес у stderr, тому stderr збирається у файл
$errFile = Join-Path $env:TEMP "mongodump_$stamp.txt"
$sw = [Diagnostics.Stopwatch]::StartNew()
$p = Start-Process -FilePath $mongodump -NoNewWindow -Wait -PassThru -RedirectStandardError $errFile `
     -ArgumentList "--uri=`"$Uri`"", "--db=$Db", "--gzip", "--archive=`"$archive`""
$sw.Stop()
$dumped = Select-String -Path $errFile -Pattern 'done dumping' | ForEach-Object {
    if ($_.Line -match 'done dumping (\S+) \((\d+) documents?\)' -and $Matches[2] -ne '0') {
        '{0}={1}' -f ($Matches[1].Trim('`').Split('.')[1]), $Matches[2] } }
Remove-Item $errFile
if ($p.ExitCode -ne 0) { Write-Log "ПОМИЛКА mongodump, код $($p.ExitCode)"; exit 1 }
$size = (Get-Item $archive).Length / 1MB
Write-Log ("mongodump: {0:N2} МБ за {1:N1} с -> {2}" -f $size, $sw.Elapsed.TotalSeconds, (Split-Path $archive -Leaf))
Write-Log ("колекції: " + ($dumped -join ', '))

# 2. Перевірка цілісності архіву: пробне відновлення без запису
$chk = Join-Path $env:TEMP "mongorestore_$stamp.txt"
$p = Start-Process -FilePath $mongorestore -NoNewWindow -Wait -PassThru -RedirectStandardError $chk `
     -ArgumentList "--uri=`"$Uri`"", "--gzip", "--archive=`"$archive`"", "--dryRun", "--nsFrom=`"$Db.*`"", "--nsTo=`"${Db}_check.*`""
Remove-Item $chk
if ($p.ExitCode -ne 0) { Write-Log "ПОМИЛКА перевірки архіву, код $($p.ExitCode)"; exit 2 }
Write-Log "перевірка mongorestore --dryRun: архів читається повністю (код 0)"

# 3. Ротація
$all = Get-ChildItem $OutDir -Filter "${Db}_*.archive.gz" | Sort-Object LastWriteTime -Descending
$old = $all | Select-Object -Skip $Keep
foreach ($f in $old) { Remove-Item $f.FullName; Write-Log "ротація: видалено $($f.Name)" }
Write-Log ("ГОТОВО. Архівів: {0} (ліміт {1}), разом {2:N2} МБ" -f ($all.Count - @($old).Count), $Keep,
           ((Get-ChildItem $OutDir -Filter "${Db}_*.archive.gz" | Measure-Object Length -Sum).Sum / 1MB))
