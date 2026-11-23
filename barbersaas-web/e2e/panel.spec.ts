import { bookPublic, firstFreeSlot, phone, viewPublic } from './support/api';
import { expect, limaTime24, login, test } from './support/fixtures';

/**
 * La dueña, en escritorio y con el navegador en Tokio (ver playwright.config): la reserva hecha
 * online aparece en su agenda a la hora de Lima, la mueve y la atiende; el cliente queda en el CRM.
 */
test('la reserva online aparece en la agenda (hora de Lima), se mueve y se atiende', async ({ page, shop }) => {
  const slot = await firstFreeSlot(shop.slug, [shop.services.corte], shop.staff.carlos);
  const booked = await bookPublic(shop.slug, {
    serviceIds: [shop.services.corte],
    staffId: shop.staff.carlos,
    startAt: slot.start,
    customer: { fullName: 'Mateo Díaz', phone: phone() },
  });

  await login(page, shop.owner.email);
  await page.goto(`/s/${shop.slug}/agenda?d=${slot.date}`);
  const event = page.locator('.rbc-event', { hasText: 'Mateo Díaz' });
  await expect(event).toBeVisible();
  await expect(event).toContainText(limaTime24(slot.start)); // hora de la sede, no la de Tokio
  await expect(page.locator('.rbc-header', { hasText: 'Carlos' })).toBeVisible(); // columna por barbero

  // Detalle → mover 1 h más tarde (alternativa accesible a arrastrar)
  await event.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Mateo Díaz' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Mover' }).click();
  const later = new Date(Date.parse(slot.start) + 60 * 60_000).toISOString();
  await dialog.getByLabel('Hora', { exact: true }).fill(limaTime24(later));
  await dialog.getByRole('button', { name: 'Mover cita' }).click();
  await expect(page.getByText('Cita movida; se avisa al cliente')).toBeVisible();
  const token = booked.manageToken;
  expect((await viewPublic(token)).startAt).toBe(later);
  await expect(event).toContainText(limaTime24(later));

  // Empezar la atención
  await event.click();
  await dialog.getByRole('button', { name: 'Empezar' }).click();
  // "En atención" también es una etiqueta de la leyenda: se espera al estado real en la API y al chip del detalle.
  await expect.poll(async () => (await viewPublic(token)).status).toBe('in_progress');
  await expect(dialog.getByText('En atención')).toBeVisible();
  await page.keyboard.press('Escape');

  // El cliente quedó en el CRM con su teléfono
  await page.goto(`/s/${shop.slug}/clientes?q=Mateo`);
  await page.getByRole('link', { name: 'Mateo Díaz' }).click();
  await expect(page.getByRole('heading', { name: 'Mateo Díaz' })).toBeVisible();
  await expect(page.getByText('Historial de citas')).toBeVisible();
  await expect(page.getByText('Corte clásico').first()).toBeVisible();
});
