import { bookPublic, firstFreeSlot, phone, viewPublic } from './support/api';
import { expect, limaTime, test } from './support/fixtures';

/** El cliente, desde el celular: landing → asistente → confirmación → gestionar (cambiar y cancelar). */
test.describe('reserva pública', () => {
  test('reserva desde la landing, la cambia de horario y la cancela por el enlace', async ({ page, shop }) => {
    const slot = await firstFreeSlot(shop.slug, [shop.services.corte]);

    // Landing
    await page.goto(`/b/${shop.slug}`);
    await expect(page.getByRole('heading', { level: 1, name: shop.name })).toBeVisible();
    await expect(page.getByText('Av. Pruebas 123, Miraflores').first()).toBeVisible();
    await page.getByRole('button', { name: 'Reservar Corte clásico' }).click();

    // Paso "¿Con quién?" (el servicio ya viene elegido desde la landing)
    await expect(page).toHaveURL(/reservar=barbero/);
    await expect(page.getByRole('heading', { name: '¿Con quién?' })).toBeVisible();
    await page.getByRole('button', { name: /Cualquiera disponible/ }).click();

    // Día y hora
    await expect(page.getByRole('heading', { name: 'Elige día y hora' })).toBeVisible();
    await page.locator(`[data-date="${slot.date}"]`).click();
    await page.locator(`[data-start="${slot.start}"]`).click();
    await expect(page.getByText('Corte clásico').last()).toBeVisible();
    await page.getByRole('button', { name: 'Continuar' }).click();

    // Datos y confirmación
    await expect(page.getByRole('heading', { name: 'Tus datos' })).toBeVisible();
    await page.getByLabel('Nombre y apellido').fill('Ana Torres');
    await page.getByLabel(/Celular/).fill(phone());
    await page.getByRole('button', { name: 'Confirmar reserva' }).click();
    await expect(page.getByRole('heading', { name: '¡Listo, Ana!' })).toBeVisible();
    await expect(page.getByText(limaTime(slot.start))).toBeVisible();

    // Gestionar por el enlace (sin cuenta)
    await page.getByRole('link', { name: 'Ver, cambiar o cancelar mi cita' }).click();
    await expect(page).toHaveURL(new RegExp(`/b/${shop.slug}/cita/`));
    const token = decodeURIComponent(page.url().split('/cita/')[1]!);
    expect((await viewPublic(token)).status).toBe('confirmed');

    // Cambiar a otro horario del mismo día
    await page.getByRole('button', { name: 'Cambiar día u hora' }).click();
    await page.locator(`[data-date="${slot.date}"]`).click();
    const other = page.locator('[data-start]').nth(4);
    const newStart = (await other.getAttribute('data-start'))!;
    await other.click();
    await page.getByRole('button', { name: /^Cambiar a las/ }).click();
    await expect(page.getByText('Cita cambiada; te enviamos la confirmación')).toBeVisible();
    expect((await viewPublic(token)).startAt).toBe(newStart);

    // De vuelta en la landing aparece "Tienes una cita" (guardada en el dispositivo)
    await page.getByRole('link', { name: `← ${shop.name}` }).click();
    await page.getByRole('link', { name: /Tienes una cita/ }).click();

    // Cancelar
    await page.getByRole('button', { name: 'Cancelar cita' }).click();
    await page.getByLabel('Motivo (opcional)').fill('Me surgió un viaje');
    await page.getByRole('button', { name: 'Sí, cancelar' }).click();
    await expect(page.getByText('Cita cancelada')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cambiar día u hora' })).toHaveCount(0);
    expect((await viewPublic(token)).status).toBe('canceled');

    // Al volver, el aviso ya no aparece
    await page.goto(`/b/${shop.slug}`);
    await expect(page.getByRole('heading', { level: 1, name: shop.name })).toBeVisible();
    await expect(page.getByText('Tienes una cita')).toHaveCount(0);
  });

  test('si alguien toma el horario justo antes, ofrece los libres y se puede reservar uno', async ({ page, shop }) => {
    const slot = await firstFreeSlot(shop.slug, [shop.services.barba], shop.staff.diego);

    await page.goto(`/b/${shop.slug}?reservar=servicios`);
    await page.getByRole('button', { name: /Perfilado de barba/ }).click();
    await page.getByRole('button', { name: 'Continuar' }).click();
    await page.getByRole('button', { name: /^Diego/ }).click();
    await page.locator(`[data-date="${slot.date}"]`).click();
    await page.locator(`[data-start="${slot.start}"]`).click();
    await page.getByRole('button', { name: 'Continuar' }).click();
    await page.getByLabel('Nombre y apellido').fill('Luis Paredes');
    await page.getByLabel(/Celular/).fill(phone());

    // Otra persona reserva ese mismo horario con Diego mientras Luis completa sus datos.
    await bookPublic(shop.slug, {
      serviceIds: [shop.services.barba],
      staffId: shop.staff.diego,
      startAt: slot.start,
      customer: { fullName: 'Otra Persona', phone: phone() },
    });

    await page.getByRole('button', { name: 'Confirmar reserva' }).click();
    const alert = page.getByRole('alert').filter({ hasText: 'Alguien acaba de tomar ese horario.' });
    await expect(alert).toBeVisible();
    const alternative = alert.getByRole('button').first();
    const label = (await alternative.textContent())!;
    await alternative.click();
    await expect(page.getByText(label).first()).toBeVisible(); // el resumen ya muestra la nueva hora
    await page.getByRole('button', { name: 'Confirmar reserva' }).click();
    await expect(page.getByRole('heading', { name: '¡Listo, Luis!' })).toBeVisible();
    await expect(page.getByText(label)).toBeVisible();
    await expect(page.getByText(/con Diego/)).toBeVisible();
  });
});
