-- Defensa en profundidad: la API solo borra de verdad en 5 tablas de detalle (se reescriben enteras).
-- Todo lo demás usa borrado lógico (deleted_at), así que se le quita DELETE: un fallo en el código
-- no puede borrar clientes, ventas, facturas ni usuarios.
-- Conservan DELETE: staff_services, staff_hours, business_hours, appointment_services, message_logs.
REVOKE DELETE ON
  cash_registers, gallery_images, locations, holidays, schedule_exceptions, staff, memberships,
  barbershop_settings, staff_time_off, service_categories, barbershops, customers, appointments,
  whatsapp_configs, usage_counters, invoices, plans, platform_settings, customer_notes, services,
  subscriptions, auth_sessions, message_templates, stored_files, products, shop_roles,
  product_stocks, users
FROM barbersaas_app;
