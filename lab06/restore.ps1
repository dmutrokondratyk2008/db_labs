# =====================================================================
# Лабораторна робота 6. restore.ps1
# Відновлення архіву mongodump у базу (за замовчуванням у нову базу
# library_restore, щоб не зачепити робочу) і порівняння кількості
# документів та індексів з оригіналом.
# Запуск: powershell -ExecutionPolicy Bypass -File .\restore.ps1 [-Archive <файл>]
# =====================================================================
param(
    [string]$Uri      = 'mongodb://localhost:27017',
    [string]$Db       = 'library',
    [string]$TargetDb = 'library_restore',
    [string]$Archive  = ''
)
$ErrorActionPreference = 'Stop'
$tools = (Get-ChildItem 'C:\Program Files\MongoDB\Tools\*\bin' -Directory | Sort-Object FullName | Select-Object -Last 1).FullName
if (-not $Archive) {
    $Archive = (Get-ChildItem (Join-Path $PSScriptRoot 'backups') -Filter "${Db}_*.archive.gz" |
                Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName
}
Write-Host "Архів: $(Split-Path $Archive -Leaf) -> база $TargetDb"
$err = Join-Path $env:TEMP 'mongorestore_restore.txt'
$p = Start-Process -FilePath (Join-Path $tools 'mongorestore.exe') -NoNewWindow -Wait -PassThru -RedirectStandardError $err `
     -ArgumentList "--uri=`"$Uri`"", '--gzip', "--archive=`"$Archive`"", '--drop',
                   "--nsFrom=`"$Db.*`"", "--nsTo=`"$TargetDb.*`""
Get-Content $err -Encoding UTF8 | Select-String 'restored successfully|finished restoring|error' | ForEach-Object { '  ' + ($_.Line -replace '^\S+\s+', '') }
Remove-Item $err
if ($p.ExitCode -ne 0) { Write-Host "ПОМИЛКА mongorestore, код $($p.ExitCode)"; exit 1 }

# Порівняння: документи та індекси кожної колекції
$js = @"
const a = db.getSiblingDB('$Db'), b = db.getSiblingDB('$TargetDb');
print('колекція          ' + '$Db'.padStart(9) + '$TargetDb'.padStart(17) + '   індекси   збіг');
let ok = true;
a.getCollectionNames().filter(n => !n.startsWith('system.')).sort().forEach(n => {
  const isView = a.getCollectionInfos({ name: n })[0].type === 'view';
  const ca = a[n].countDocuments(), cb = b[n].countDocuments();
  const ia = isView ? '-' : a[n].getIndexes().length, ib = isView ? '-' : b[n].getIndexes().length;
  const same = ca === cb && ia === ib; ok = ok && same;
  print(n.padEnd(18) + String(ca).padStart(9) + String(cb).padStart(17) + ('   ' + ia + '/' + ib).padEnd(13) + (same ? 'так' : 'НІ'));
});
print(ok ? 'Відновлення повне' : 'Є розбіжності');
"@
mongosh $Uri --quiet --eval $js
