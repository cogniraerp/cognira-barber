-- Fase 3 · paso 28: estado de cita que espera el pago del adelanto (va solo: un valor nuevo de
-- enum no se puede usar en la misma transacción en que se agrega).
ALTER TYPE "appointment_status" ADD VALUE IF NOT EXISTS 'awaiting_payment' BEFORE 'pending';
