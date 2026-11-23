/**
 * Seed base (idempotente): planes por defecto + superadmin.
 * Corre con el usuario dueño de las tablas (MIGRATION_DATABASE_URL), así que no pasa por RLS.
 *
 *   SEED_SUPERADMIN_EMAIL=admin@barbersaas.pe SEED_SUPERADMIN_PASSWORD=... pnpm db:seed
 *
 * Los datos demo (barberías, barberos, citas) se añaden en el paso 10.
 */
import 'dotenv/config';
import argon2 from 'argon2';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { DEMO_ACCOUNTS, DEMO_PASSWORD, seedDemo } from './seed-demo';

const url = process.env.MIGRATION_DATABASE_URL;
if (!url) throw new Error('Falta MIGRATION_DATABASE_URL');
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

const PLANS = [
  {
    code: 'basico',
    name: 'Básico',
    description: 'Para barberías que empiezan: 1 sede y hasta 3 barberos.',
    priceMonthlyCents: 4900,
    priceYearlyCents: 49000,
    trialDays: 14,
    sortOrder: 1,
    limits: { staff: 3, locations: 1, services: 20, bookingsPerMonth: 500, whatsappPerMonth: 300, storageMb: 500 },
    features: {},
  },
  {
    code: 'pro',
    name: 'Pro',
    description: 'Más barberos, fidelización y reportes avanzados.',
    priceMonthlyCents: 9900,
    priceYearlyCents: 99000,
    trialDays: 14,
    sortOrder: 2,
    limits: { staff: 10, locations: 1, services: 60, bookingsPerMonth: 2000, whatsappPerMonth: 1500, storageMb: 2000 },
    features: { loyalty: true, advancedReports: true, onlinePayments: true },
  },
  {
    code: 'premium',
    name: 'Premium',
    description: 'Multi-sede, dominio propio, sin marca "Powered by" y API.',
    priceMonthlyCents: 19900,
    priceYearlyCents: 199000,
    trialDays: 14,
    sortOrder: 3,
    limits: { staff: null, locations: 5, services: null, bookingsPerMonth: null, whatsappPerMonth: 5000, storageMb: 10000 },
    features: { loyalty: true, advancedReports: true, onlinePayments: true, multiLocation: true, api: true, customDomain: true, removeBranding: true },
  },
];

async function main(): Promise<void> {
  for (const plan of PLANS) {
    await prisma.plan.upsert({ where: { code: plan.code }, create: plan, update: {} });
  }
  console.log(`✔ Planes: ${PLANS.map((p) => p.code).join(', ')}`);

  await prisma.platformSettings.upsert({
    where: { id: 1 },
    create: { id: 1, data: { name: 'BarberSaaS', defaultPlanCode: 'basico', defaultCurrency: 'PEN', defaultTimezone: 'America/Lima' } },
    update: {},
  });

  const email = process.env.SEED_SUPERADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_SUPERADMIN_PASSWORD;
  if (!email || !password) {
    console.log('ℹ Sin SEED_SUPERADMIN_EMAIL / SEED_SUPERADMIN_PASSWORD: no se crea superadmin.');
  } else {
    await seedSuperadmin(email, password);
  }

  // Datos demo: por defecto en desarrollo; nunca en producción.
  if (process.env.NODE_ENV === 'production' || process.env.SEED_DEMO === 'false') return;
  await seedDemo(prisma);
  console.log(`\nCuentas demo (contraseña: ${DEMO_PASSWORD}):`);
  for (const a of DEMO_ACCOUNTS) console.log(`  ${a.shop.padEnd(12)} ${a.role.padEnd(7)} ${a.email}`);
}

async function seedSuperadmin(email: string, password: string): Promise<void> {
  if (password.length < 8) throw new Error('SEED_SUPERADMIN_PASSWORD debe tener al menos 8 caracteres');
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 });
  await prisma.user.upsert({
    where: { email },
    create: { email, fullName: 'Superadmin', passwordHash, platformRole: 'superadmin' },
    update: { platformRole: 'superadmin' },
  });
  console.log(`✔ Superadmin: ${email}`);
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
