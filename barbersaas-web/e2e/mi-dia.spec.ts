import { expect, login, test } from './support/fixtures';

/** El barbero, en el celular: entra directo a "Mi día", registra un walk-in y lo completa. */
test('el barbero registra un walk-in en "Mi día" y lo completa', async ({ page, shop }) => {
  await login(page, shop.barber.email);
  await page.goto(`/s/${shop.slug}`);
  await expect(page).toHaveURL(new RegExp(`/s/${shop.slug}/mi-dia`)); // el inicio del barbero es "Mi día"
  await expect(page.getByRole('heading', { name: 'Hola, Carlos' })).toBeVisible();

  await page.getByRole('button', { name: 'Walk-in' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('label', { hasText: 'Corte clásico' }).getByRole('checkbox').check();
  await dialog.getByLabel(/^Cliente/).fill('Jorge Walk-in');
  await dialog.getByLabel('Teléfono').fill('987 000 111');
  await dialog.getByRole('button', { name: 'Registrar walk-in' }).click();
  await expect(dialog).toBeHidden();

  const card = page.getByRole('region', { name: 'En atención' });
  await expect(card).toContainText('En el sillón');
  await expect(card).toContainText('Jorge Walk-in');
  await card.getByRole('button', { name: /^Completar/ }).click();

  await expect(page.getByRole('region', { name: 'En atención' })).toHaveCount(0);
  const stats = page.locator('header dl');
  await expect(stats).toContainText('Atendido');
  await expect(stats).toContainText('S/ 35');
  await expect(page.getByRole('region', { name: 'Citas del día' })).toContainText('Jorge Walk-in');
});
