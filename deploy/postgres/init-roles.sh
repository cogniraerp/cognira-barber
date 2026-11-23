#!/bin/sh
# Se ejecuta una sola vez, al crear el volumen de la base.
#   barbersaas_app : rol de grupo, sin login y sin bypass de RLS (recibe los GRANT de las migraciones).
#   barbersaas_api : usuario con el que se conectan la API y el worker (miembro de barbersaas_app).
set -eu
psql -v ON_ERROR_STOP=1 -v app_pw="$APP_DB_PASSWORD" --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
CREATE ROLE barbersaas_app NOLOGIN NOBYPASSRLS;
CREATE ROLE barbersaas_api LOGIN NOBYPASSRLS NOSUPERUSER IN ROLE barbersaas_app PASSWORD :'app_pw';
GRANT CONNECT ON DATABASE barbersaas TO barbersaas_app;
SQL
