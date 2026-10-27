#!/bin/sh

set -e

cd /var/www/html

: "${DB_HOST:=db}"
: "${DB_PORT:=3306}"
: "${DB_NAME:=glpi}"
: "${DB_USER:=glpi}"
: "${DB_PASSWORD:?DB_PASSWORD requerida}"
: "${GLPI_LANGUAGE:=es_MX}"
: "${GLPI_ADMIN_USER:=admin}"
: "${GLPI_ADMIN_PASSWORD:?GLPI_ADMIN_PASSWORD requerida}"
: "${GLPI_CONSULTA_USER:=consulta}"
: "${GLPI_CONSULTA_PASSWORD:=consulta}"

rm -f files/_eticket-ready
echo "Esperando a MariaDB en ${DB_HOST}:${DB_PORT}..."
attempt=0
until php -r 'try { $m = @new mysqli(getenv("DB_HOST"), getenv("DB_USER"), getenv("DB_PASSWORD"), getenv("DB_NAME"), (int) getenv("DB_PORT")); if ($m->connect_errno) { exit(1); } $m->close(); exit(0); } catch (Throwable $e) { exit(1); }'; do
    attempt=$((attempt + 1))
    if [ "$attempt" -ge 90 ]; then echo "ERROR: MariaDB no disponible" >&2; exit 1; fi
    sleep 2
done

if [ ! -f config/config_db.php ]; then
    echo "Instalando la base de datos de GLPI..."
    php bin/console database:install \
        --allow-superuser \
        --no-interaction \
        --db-host="${DB_HOST}" \
        --db-port="${DB_PORT}" \
        --db-name="${DB_NAME}" \
        --db-user="${DB_USER}" \
        --db-password="${DB_PASSWORD}" \
        --default-language="${GLPI_LANGUAGE}" \
        --no-telemetry

    echo "Creando usuario administrador..."
    php bin/console user:create "${GLPI_ADMIN_USER}" \
        --password="${GLPI_ADMIN_PASSWORD}" \
        --allow-superuser \
        --no-interaction

    php bin/console user:grant "${GLPI_ADMIN_USER}" \
        --profile=4 \
        --entity=0 \
        --recursive \
        --allow-superuser \
        --no-interaction
fi

mkdir -p \
    files/_cache \
    files/_cron \
    files/_graphs \
    files/_inventories \
    files/_locales \
    files/_lock \
    files/_log \
    files/_pictures \
    files/_plugins \
    files/_rss \
    files/_sessions \
    files/_themes \
    files/_tmp \
    files/_uploads \
    marketplace

chown -R www-data:www-data config files marketplace

su -s /bin/sh www-data -c 'php /usr/local/bin/configure-glpi.php'
su -s /bin/sh www-data -c 'php /usr/local/bin/provision-hub.php'
touch files/_eticket-ready
chown www-data:www-data files/_eticket-ready

echo "GLPI listo en el puerto 80 del contenedor."
exec "$@"
