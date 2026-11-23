-- Un usuario puede leer las barberías donde es miembro o cliente con login
-- (selector "mis barberías" y "mis citas"), sin necesidad de fijar app.barbershop_id.
CREATE POLICY barbershop_member_read ON barbershops FOR SELECT TO barbersaas_app
  USING (
    app.user_id() IS NOT NULL AND (
      EXISTS (SELECT 1 FROM memberships m
              WHERE m.barbershop_id = barbershops.id AND m.user_id = app.user_id() AND m.deleted_at IS NULL)
      OR EXISTS (SELECT 1 FROM customers c
                 WHERE c.barbershop_id = barbershops.id AND c.user_id = app.user_id() AND c.deleted_at IS NULL)
    )
  );
