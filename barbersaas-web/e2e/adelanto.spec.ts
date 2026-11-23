import { bookPublic, enableOnlinePayments, firstFreeSlot, phone, setDeposit, viewPublic } from './support/api';
import { expect, login, test } from './support/fixtures';

/**
 * Fase 3 · adelanto al reservar, desde el celular: el cliente reserva, ve "Paga S/ 17.50 para
 * confirmar", paga en la pasarela (otra pestaña) y su cita se confirma sola, con el adelanto
 * descontado del total. Corte clásico S/ 35.00 · adelanto 50 %.
 */
test('reserva con adelanto: pagar en la pasarela confirma la cita sola', async ({ page, context, shop }) => {
  await enableOnlinePayments(shop);
  await setDeposit(shop, { required: true, type: 'percent', value: 50 });
  const slot = await firstFreeSlot(shop.slug, [shop.services.corte]);

  await page.goto(`/b/${shop.slug}`);
  await page.getByRole('button', { name: 'Reservar Corte clásico' }).click();
  await page.getByRole('button', { name: /Cualquiera disponible/ }).click();
  await page.locator(`[data-date="${slot.date}"]`).click();
  await page.locator(`[data-start="${slot.start}"]`).click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByLabel('Nombre y apellido').fill('Rosa Quispe');
  await page.getByLabel(/Celular/).fill(phone());
  await page.getByRole('button', { name: 'Confirmar reserva' }).click();

  // Va directo a su cita, apartada mientras paga
  await expect(page).toHaveURL(new RegExp(`/b/${shop.slug}/cita/`));
  const token = decodeURIComponent(page.url().split('/cita/')[1]!);
  await expect(page.getByText('Falta pagar el adelanto')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Paga S/ 17.50 para confirmar tu cita' })).toBeVisible();
  await expect(page.getByText(/Te guardamos el horario \d+:\d{2} min más/)).toBeVisible();
  expect((await viewPublic(token)).status).toBe('awaiting_payment');

  // Paga en la pasarela (se abre en otra pestaña)
  const [checkout] = await Promise.all([
    context.waitForEvent('page'),
    page.getByRole('link', { name: /Pagar adelanto S\/ 17.50/ }).click(),
  ]);
  await checkout.getByRole('button', { name: 'Pagar S/ 17.50' }).click();
  await expect(checkout.getByText('Pago aprobado')).toBeVisible();
  await checkout.close();

  // La página de la cita se actualiza sola
  await expect(page.getByText('Confirmada').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('heading', { name: /Paga S\/ 17.50/ })).toHaveCount(0);
  await expect(page.getByText('Adelanto pagado')).toBeVisible();
  await expect(page.getByText('Pagas en el local')).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: 'Pagas en el local' })).toContainText('S/ 17.50');
  expect((await viewPublic(token)).status).toBe('confirmed');

  // En la barbería: al cobrar la cita, el adelanto ya está pagado y solo se cobra el resto
  await login(page, shop.owner.email);
  await page.goto(`/s/${shop.slug}/caja/turno`);
  await page.getByRole('button', { name: 'Abrir caja' }).click();
  await page.getByRole('dialog', { name: 'Abrir caja' }).getByLabel('Fondo inicial (S/)').fill('0');
  await page.getByRole('dialog', { name: 'Abrir caja' }).getByRole('button', { name: 'Abrir caja' }).click();
  await expect(page.getByRole('button', { name: 'Cerrar caja' })).toBeVisible();
  await page.goto(`/s/${shop.slug}/agenda?d=${slot.date}`);
  await page.locator('.rbc-event', { hasText: 'Rosa Quispe' }).click();
  await expect(page.getByRole('dialog').getByText('Adelanto pagado S/ 17.50')).toBeVisible();
  await page.getByRole('link', { name: /^Cobrar/ }).click();
  await expect(page.getByText('Adelanto pagado S/ 17.50: solo se cobra el resto')).toBeVisible();
  await page.getByRole('button', { name: 'Cobrar S/ 35.00' }).click();
  const pay = page.getByRole('dialog', { name: 'Cobrar S/ 35.00' });
  await expect(pay.getByText('Pagado · Adelanto')).toBeVisible();
  await expect(pay.getByLabel('Monto en Efectivo')).toHaveValue('17.50');
  await pay.getByRole('button', { name: 'Confirmar pago' }).click();
  await expect(page.getByRole('dialog', { name: /Venta V-000001 cobrada/ })).toBeVisible();
  expect((await viewPublic(token)).status).toBe('completed');
});

/**
 * Fase 3 · cancelar a tiempo devuelve el adelanto por la pasarela: el cliente paga el adelanto,
 * cancela desde "gestionar mi cita", ve que se está devolviendo; la barbería ve la devolución en
 * Pagos en línea (la procesa el worker cada minuto, o "Reintentar" al instante) y el cliente ve
 * "Te devolvimos S/ 17.50".
 */
test('cancelar a tiempo devuelve el adelanto por la pasarela', async ({ page, context, shop }) => {
  await enableOnlinePayments(shop);
  await setDeposit(shop, { required: true, type: 'percent', value: 50 });
  const slot = await firstFreeSlot(shop.slug, [shop.services.corte], shop.staff.diego);
  const appt = await bookPublic(shop.slug, {
    serviceIds: [shop.services.corte],
    staffId: shop.staff.diego,
    startAt: slot.start,
    customer: { fullName: 'Luis Huamán', phone: phone() },
  });
  expect(appt.status).toBe('awaiting_payment');

  // Paga el adelanto desde su cita
  await page.goto(`/b/${shop.slug}/cita/${encodeURIComponent(appt.manageToken)}`);
  const [checkout] = await Promise.all([
    context.waitForEvent('page'),
    page.getByRole('link', { name: /Pagar adelanto S\/ 17.50/ }).click(),
  ]);
  await checkout.getByRole('button', { name: 'Pagar S/ 17.50' }).click();
  await expect(checkout.getByText('Pago aprobado')).toBeVisible();
  await checkout.close();
  await expect(page.getByText('Adelanto pagado')).toBeVisible({ timeout: 15_000 });

  // Cancela a tiempo (la barbería no exige anticipación): el adelanto se devuelve
  await page.getByRole('button', { name: 'Cancelar cita' }).click();
  await page.getByLabel('Motivo (opcional)').fill('Me surgió un viaje');
  await page.getByRole('button', { name: 'Sí, cancelar' }).click();
  await expect(page.getByText(/Tu adelanto se está devolviendo|Te devolvimos S\/ 17.50/)).toBeVisible();
  expect((await viewPublic(appt.manageToken)).status).toBe('canceled');

  // En la barbería: la devolución aparece en Pagos en línea y se completa por la pasarela
  await login(page, shop.owner.email);
  await page.goto(`/s/${shop.slug}/configuracion/pagos`);
  const row = page.getByRole('row').filter({ hasText: 'S/ 17.50' }).filter({ hasText: /En proceso|Devuelto/ });
  await expect(row).toBeVisible();
  const retry = row.getByRole('button', { name: 'Reintentar' });
  if (await retry.isVisible()) await retry.click();
  await expect(row.getByText('Devuelto')).toBeVisible();

  // El cliente ve que se lo devolvieron
  await page.goto(`/b/${shop.slug}/cita/${encodeURIComponent(appt.manageToken)}`);
  await expect(page.getByText('Te devolvimos S/ 17.50')).toBeVisible();
});
