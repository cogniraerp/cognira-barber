import { bookPublic, enableOnlinePayments, firstFreeSlot, phone, setServiceCommission, viewPublic } from './support/api';
import { expect, login, test } from './support/fixtures';

/**
 * Fase 2 de punta a punta, como un día real en la barbería (escritorio, hora de Lima):
 *   cita reservada online → se cobra desde la agenda con pago mixto (efectivo + link/QR pagado en
 *   la pasarela) → la comisión del barbero se liquida desde la caja → arqueo y cierre del turno
 *   → el reporte del día cuadra con todo lo anterior.
 * Corte clásico S/ 35.00 · Carlos al 40 % → comisión S/ 14.00.
 * Caja: fondo 100 + 17.50 efectivo − 14.00 comisión = 103.50.
 */
test('cita → cobro mixto (efectivo + QR) → comisión → cierre de caja → reporte', async ({ page, context, shop }) => {
  await enableOnlinePayments(shop);
  await setServiceCommission(shop, shop.staff.carlos, 4000);
  const slot = await firstFreeSlot(shop.slug, [shop.services.corte], shop.staff.carlos);
  const booked = await bookPublic(shop.slug, {
    serviceIds: [shop.services.corte],
    staffId: shop.staff.carlos,
    startAt: slot.start,
    customer: { fullName: 'Lucía Ramos', phone: phone() },
  });

  await login(page, shop.owner.email);

  // 1) Abrir la caja con S/ 100 de fondo
  await page.goto(`/s/${shop.slug}/caja/turno`);
  await page.getByRole('button', { name: 'Abrir caja' }).click();
  const open = page.getByRole('dialog', { name: 'Abrir caja' });
  await open.getByLabel('Fondo inicial (S/)').fill('100');
  await open.getByRole('button', { name: 'Abrir caja' }).click();
  await expect(page.getByRole('button', { name: 'Cerrar caja' })).toBeVisible();

  // 2) Desde la agenda, cobrar la cita
  await page.goto(`/s/${shop.slug}/agenda?d=${slot.date}`);
  await page.locator('.rbc-event', { hasText: 'Lucía Ramos' }).click();
  await page.getByRole('link', { name: /^Cobrar/ }).click();
  await expect(page.getByText('Cobrando la cita de')).toBeVisible();
  await page.getByRole('button', { name: 'Cobrar S/ 35.00' }).click();

  // 3) Pago mixto: mitad en efectivo y mitad con link/QR de la pasarela
  const pay = page.getByRole('dialog', { name: 'Cobrar S/ 35.00' });
  await pay.getByRole('button', { name: 'Pago mixto (dividir)' }).click();
  await pay.getByLabel('Método del pago 2').selectOption({ label: 'En línea' });
  await expect(pay.getByLabel('Monto en Efectivo')).toHaveValue('17.50');
  await expect(pay.getByLabel('Monto en En línea')).toHaveValue('17.50');
  await expect(pay.getByRole('button', { name: 'Confirmar pago' })).toBeDisabled(); // falta que paguen el QR
  await pay.getByRole('button', { name: 'Generar link / QR' }).click();

  const qr = page.getByRole('dialog', { name: 'Cobro en línea · S/ 17.50' });
  await expect(qr.getByAltText(/Código QR/)).toBeVisible();
  const checkoutUrl = await qr.getByRole('link', { name: 'Abrir' }).getAttribute('href');

  // El cliente paga desde su celular (otra pestaña, checkout simulado)
  const customer = await context.newPage();
  await customer.goto(checkoutUrl!);
  await customer.getByRole('button', { name: 'Pagar S/ 17.50' }).click();
  await expect(customer.getByText('Pago aprobado')).toBeVisible();
  await customer.close();

  // La caja lo detecta sola
  await expect(qr.getByText('Pago recibido')).toBeVisible({ timeout: 15_000 });
  await qr.getByRole('button', { name: 'Usar este pago' }).click();
  await expect(pay.getByText(/^Pagado · sim_/)).toBeVisible();
  await pay.getByLabel('Efectivo recibido').fill('20');
  await expect(pay.getByText('Vuelto')).toBeVisible();
  await expect(pay.getByText('S/ 2.50')).toBeVisible();
  await pay.getByRole('button', { name: 'Confirmar pago' }).click();

  const done = page.getByRole('dialog', { name: 'Venta V-000001 cobrada' });
  await expect(done).toBeVisible();
  await expect(done.getByText(/En línea · sim_/)).toBeVisible();
  await expect(done.getByText('Efectivo', { exact: false }).first()).toBeVisible();
  await done.getByRole('button', { name: 'Nueva venta' }).click();
  await expect.poll(async () => (await viewPublic(booked.manageToken)).status).toBe('completed');

  // 4) Comisiones de hoy: Carlos ganó S/ 14.00 → se liquida en efectivo, saliendo de la caja
  await page.goto(`/s/${shop.slug}/comisiones?periodo=hoy`);
  const carlos = page.getByRole('row', { name: /Carlos/ });
  await expect(carlos).toContainText('S/ 14.00');
  await carlos.getByRole('button', { name: 'Liquidar' }).click();
  const payout = page.getByRole('dialog', { name: 'Liquidar a Carlos' });
  await expect(payout.getByLabel('Registrar la salida en la caja abierta')).toBeChecked();
  await payout.getByRole('button', { name: 'Pagar S/ 14.00' }).click();
  await expect(payout).toBeHidden();
  await expect(carlos.getByRole('button', { name: 'Liquidar' })).toHaveCount(0);

  // 5) Arqueo: en efectivo deben quedar 100 + 17.50 − 14.00 = 103.50; lo en línea no se cuenta
  await page.goto(`/s/${shop.slug}/caja/turno`);
  await page.getByRole('button', { name: 'Cerrar caja' }).click();
  const close = page.getByRole('dialog', { name: 'Cerrar caja' });
  await expect(close.getByRole('row', { name: /Efectivo/ })).toContainText('S/ 103.50');
  await expect(close.getByRole('row', { name: /En línea/ })).toContainText('S/ 17.50');
  await close.getByLabel('Efectivo contado').fill('103.50');
  await expect(close.getByText('Cuadra').first()).toBeVisible();
  await close.getByRole('button', { name: 'Cerrar caja' }).click();
  await expect(page.getByRole('button', { name: 'Abrir caja' })).toBeVisible();

  // 6) El reporte de hoy refleja la venta, los métodos y al barbero
  await page.goto(`/s/${shop.slug}/reportes?periodo=hoy`);
  await expect(page.getByText(/^Ingresos por día/)).toBeVisible();
  const kpi = (label: string) => page.locator('div', { has: page.getByText(label, { exact: true }) }).last();
  await expect(kpi('Ingresos')).toContainText('S/ 35.00');
  await expect(kpi('Ventas')).toContainText('1');
  await expect(page.getByRole('row', { name: /Carlos/ })).toContainText('S/ 35.00');
  await page.getByRole('tab', { name: 'Métodos de pago' }).click();
  await expect(page.getByRole('row', { name: /Efectivo/ })).toContainText('S/ 17.50');
  await expect(page.getByRole('row', { name: /En línea/ })).toContainText('S/ 17.50');
});
