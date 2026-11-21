# =====================================================================
# Лабораторна робота 6. replica/stop-replica.ps1
# Коректна зупинка вузлів набору реплік (або одного вузла -Ports 27018)
# командою shutdown; -Kill імітує аварійне падіння вузла.
# =====================================================================
param(
    [int[]]$Ports = @(27018, 27019, 27020),
    [switch]$Kill
)
foreach ($p in $Ports) {
    $c = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $c) { Write-Host "порт ${p}: вузол не запущено"; continue }
    if ($Kill) {
        Stop-Process -Id $c.OwningProcess -Force
        Write-Host "порт ${p}: процес $($c.OwningProcess) примусово завершено (імітація збою)"
    } else {
        mongosh --port $p --quiet --eval "try { db.adminCommand({ shutdown: 1, force: true }) } catch (e) {}" | Out-Null
        Write-Host "порт ${p}: вузол зупинено командою shutdown"
    }
}
