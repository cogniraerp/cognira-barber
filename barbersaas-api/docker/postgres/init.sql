-- Solo para desarrollo local (docker-compose). Se ejecuta una vez al crear el volumen.
-- barbersaas_app  : rol de grupo, NOLOGIN, sin BYPASSRLS. Recibe GRANTs y políticas (lo crea la migración si no existe).
-- barbersaas_api  : usuario de login de la API/worker, miembro de barbersaas_app.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'barbersaas_app') THEN
    CREATE ROLE barbersaas_app NOLOGIN NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'barbersaas_api') THEN
    CREATE ROLE barbersaas_api LOGIN PASSWORD 'barbersaas_api' NOBYPASSRLS NOSUPERUSER IN ROLE barbersaas_app;
  END IF;
END $$;

GRANT CONNECT ON DATABASE barbersaas TO barbersaas_app;

-- Base de datos aparte para tests e2e
CREATE DATABASE barbersaas_test;
GRANT CONNECT ON DATABASE barbersaas_test TO barbersaas_app;
