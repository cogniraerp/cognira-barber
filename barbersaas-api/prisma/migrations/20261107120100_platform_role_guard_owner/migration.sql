-- El trigger que impide auto-asignarse platform_role solo debe aplicar al rol de runtime.
-- El dueño de las tablas (migraciones / operaciones por SQL) sí puede promover o degradar usuarios.
CREATE OR REPLACE FUNCTION app.guard_platform_role() RETURNS trigger
  LANGUAGE plpgsql AS
$fn$
BEGIN
  IF NEW.platform_role IS DISTINCT FROM OLD.platform_role
     AND NOT app.is_privileged()
     AND current_user IN (
       SELECT m.rolname FROM pg_roles m
       JOIN pg_auth_members am ON am.member = m.oid
       JOIN pg_roles g ON g.oid = am.roleid
       WHERE g.rolname = 'barbersaas_app'
     )
  THEN
    RAISE EXCEPTION 'platform_role can only be changed by the platform' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$fn$;
