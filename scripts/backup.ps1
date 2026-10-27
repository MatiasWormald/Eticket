[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$directory = Join-Path (Get-Location) "backups/$stamp"
New-Item -ItemType Directory -Path $directory | Out-Null
$runningBefore = @(docker compose ps --status running --services)
if ($LASTEXITCODE -ne 0) { throw 'No se pudo consultar el estado de los servicios.' }
$restartServices = @($runningBefore | Where-Object { $_ -in @('glpi', 'cron') })
# Quiesce también cron: una copia de files junto con una DB modificándose no es consistente.
docker compose stop cron glpi
if ($LASTEXITCODE -ne 0) { throw 'No fue posible detener GLPI. No se creó respaldo.' }
try {
    docker compose exec -T db sh -c 'umask 077; mariadb-dump --single-transaction --routines --triggers -u"$MARIADB_USER" -p"$MARIADB_PASSWORD" "$MARIADB_DATABASE" > /tmp/eticket-backup.sql'
    if ($LASTEXITCODE -ne 0) { throw 'Falló el volcado SQL.' }
    docker compose cp db:/tmp/eticket-backup.sql "$directory/database.sql"
    if ($LASTEXITCODE -ne 0) { throw 'Falló la copia del volcado.' }
    docker compose run --rm --no-deps --entrypoint tar -v "${directory}:/backup" glpi --exclude=files/_cache --exclude=files/_sessions --exclude=files/_tmp --exclude=files/_lock -czf /backup/glpi-data.tgz config files marketplace plugins
    if ($LASTEXITCODE -ne 0) { throw 'Falló el respaldo de archivos.' }
    Copy-Item -LiteralPath '.env' -Destination "$directory/.env"
    Get-FileHash "$directory/database.sql", "$directory/glpi-data.tgz" | Select-Object Algorithm,Hash,Path | ConvertTo-Json | Set-Content "$directory/checksums.json"
    Write-Host "Respaldo completo: $directory. Contiene secretos y datos: mantener fuera de GitHub."
} finally {
    docker compose exec -T db rm -f /tmp/eticket-backup.sql
    if ($restartServices.Count -gt 0) {
        docker compose start @restartServices
        if ($LASTEXITCODE -ne 0) { throw 'El respaldo terminó pero no se pudieron reiniciar todos los servicios. Revisa docker compose ps.' }
    }
}
