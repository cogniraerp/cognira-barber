/**
 * Datos DEMO: 2 barberías de Lima con dueño, 3 barberos con login, servicios (con precios por barbero),
 * horarios con almuerzo, feriados, clientes con historial y citas pasadas/futuras sin solapamientos.
 *
 * Idempotente: si ya existen, no hace nada (salvo SEED_DEMO_RESET=true, que las borra y recrea).
 * Corre como dueño de las tablas (sin RLS). Nunca en producción.
 */
import argon2 from 'argon2';
import type { PrismaClient } from '../src/generated/prisma/client';
import { peruHolidays } from '../src/common/time/peru-holidays';

const PASSWORD = 'demo-1234';
const LIMA_OFFSET_H = 5; // Perú: UTC−5 todo el año

interface ShopSpec {
  slug: string;
  name: string;
  description: string;
  planCode: 'basico' | 'pro' | 'premium';
  subscription: 'active' | 'trialing';
  address: string;
  reference: string;
  lat: number;
  lng: number;
  phone: string;
  branding: {
    primaryColor: string;
    secondaryColor: string;
    font: string;
    welcomeMessage: string;
    socials: Record<string, string | null>;
  };
  /** día de semana → bloques [inicio, fin] */
  hours: Record<number, Array<[string, string]>>;
  owner: { email: string; fullName: string };
  staff: Array<{
    name: string;
    email: string;
    bio: string;
    specialties: string[];
    customHours?: Record<number, Array<[string, string]>>;
    lunch?: [string, string];
  }>;
  categories: Array<{
    name: string;
    services: Array<{
      name: string;
      price: number;
      duration: number;
      bufferAfter?: number;
      description: string;
    }>;
  }>;
  /** servicio → barbero (índice) → [precio, duración] */
  overrides: Array<{ service: string; staff: number; price?: number; duration?: number }>;
}

const SHOPS: ShopSpec[] = [
  {
    slug: 'el-clasico',
    name: 'Barbería El Clásico',
    description: 'Cortes clásicos y afeitado con navaja desde 1998, en el corazón de Miraflores.',
    planCode: 'pro',
    subscription: 'active',
    address: 'Av. José Larco 412, Miraflores',
    reference: 'A una cuadra del Parque Kennedy',
    lat: -12.1219,
    lng: -77.0297,
    phone: '+51 1 445 2020',
    branding: {
      primaryColor: '#1f2937',
      secondaryColor: '#b45309',
      font: 'playfair-display',
      welcomeMessage: '¡Bienvenido! Reserva tu corte en menos de un minuto.',
      socials: {
        instagram: '@elclasico.barberia',
        tiktok: null,
        facebook: 'elclasicobarberia',
        website: null,
        whatsapp: '+51987100200',
      },
    },
    hours: {
      1: [
        ['09:00', '13:00'],
        ['14:00', '21:00'],
      ],
      2: [
        ['09:00', '13:00'],
        ['14:00', '21:00'],
      ],
      3: [
        ['09:00', '13:00'],
        ['14:00', '21:00'],
      ],
      4: [
        ['09:00', '13:00'],
        ['14:00', '21:00'],
      ],
      5: [
        ['09:00', '13:00'],
        ['14:00', '21:00'],
      ],
      6: [['09:00', '18:00']],
    },
    owner: { email: 'owner@elclasico.pe', fullName: 'Ricardo Salazar' },
    staff: [
      {
        name: 'Carlos Mendoza',
        email: 'carlos@elclasico.pe',
        bio: '20 años de oficio. Especialista en navaja y cortes clásicos.',
        specialties: ['Navaja', 'Clásico', 'Barba'],
      },
      {
        name: 'Diego Huamán',
        email: 'diego@elclasico.pe',
        bio: 'Fades y diseños. Siempre al día con las tendencias.',
        specialties: ['Fade', 'Diseños'],
      },
      {
        name: 'Andrea Quispe',
        email: 'andrea@elclasico.pe',
        bio: 'Cortes modernos y coloración.',
        specialties: ['Moderno', 'Color'],
        customHours: {
          2: [['11:00', '20:00']],
          3: [['11:00', '20:00']],
          4: [['11:00', '20:00']],
          5: [['11:00', '20:00']],
          6: [['09:00', '17:00']],
        },
        lunch: ['15:00', '16:00'],
      },
    ],
    categories: [
      {
        name: 'Cortes',
        services: [
          {
            name: 'Corte clásico',
            price: 35,
            duration: 30,
            bufferAfter: 5,
            description: 'Tijera y máquina, lavado incluido.',
          },
          {
            name: 'Fade',
            price: 40,
            duration: 40,
            bufferAfter: 5,
            description: 'Degradado a elección (bajo, medio o alto).',
          },
          { name: 'Corte niño', price: 25, duration: 25, description: 'Hasta 12 años.' },
        ],
      },
      {
        name: 'Barba',
        services: [
          {
            name: 'Perfilado de barba',
            price: 20,
            duration: 20,
            description: 'Perfilado con máquina y navaja.',
          },
          {
            name: 'Afeitado con navaja',
            price: 30,
            duration: 30,
            bufferAfter: 10,
            description: 'Toalla caliente y navaja tradicional.',
          },
        ],
      },
      {
        name: 'Combos',
        services: [
          {
            name: 'Corte + barba',
            price: 50,
            duration: 50,
            bufferAfter: 10,
            description: 'Nuestro combo más pedido.',
          },
        ],
      },
    ],
    overrides: [
      { service: 'Corte clásico', staff: 0, price: 45 },
      { service: 'Afeitado con navaja', staff: 0, price: 40, duration: 40 },
      { service: 'Corte + barba', staff: 0, price: 65, duration: 60 },
      { service: 'Fade', staff: 1, duration: 35 },
    ],
  },
  {
    slug: 'studio-fade',
    name: 'Studio Fade',
    description: 'Barbería urbana en Barranco: fades, diseños y buena música.',
    planCode: 'basico',
    subscription: 'trialing',
    address: 'Av. Grau 255, Barranco',
    reference: 'Frente a la plaza de Barranco',
    lat: -12.1496,
    lng: -77.0216,
    phone: '+51 987 300 400',
    branding: {
      primaryColor: '#0f766e',
      secondaryColor: '#fbbf24',
      font: 'bebas-neue',
      welcomeMessage: 'Fades que hablan por ti. Reserva y llega puntual 🔥',
      socials: {
        instagram: '@studiofade.pe',
        tiktok: '@studiofade',
        facebook: null,
        website: null,
        whatsapp: '+51987300400',
      },
    },
    hours: {
      2: [['10:00', '20:00']],
      3: [['10:00', '20:00']],
      4: [['10:00', '20:00']],
      5: [['10:00', '21:00']],
      6: [['10:00', '21:00']],
      0: [['10:00', '16:00']],
    },
    owner: { email: 'owner@studiofade.pe', fullName: 'Valeria Torres' },
    staff: [
      {
        name: 'Kevin Rojas',
        email: 'kevin@studiofade.pe',
        bio: 'Rey del skin fade.',
        specialties: ['Skin fade', 'Diseños'],
        lunch: ['14:00', '15:00'],
      },
      {
        name: 'Joel Paredes',
        email: 'joel@studiofade.pe',
        bio: 'Freestyle y diseños con navaja.',
        specialties: ['Diseños', 'Freestyle'],
        lunch: ['15:00', '16:00'],
      },
      {
        name: 'Mía Castillo',
        email: 'mia@studiofade.pe',
        bio: 'Cortes texturizados y crop.',
        specialties: ['Crop', 'Texturizado'],
      },
    ],
    categories: [
      {
        name: 'Fades',
        services: [
          {
            name: 'Skin fade',
            price: 45,
            duration: 45,
            bufferAfter: 5,
            description: 'Degradado a piel con acabado navaja.',
          },
          {
            name: 'Taper fade',
            price: 40,
            duration: 40,
            description: 'Degradado en nuca y patillas.',
          },
          {
            name: 'Crop texturizado',
            price: 40,
            duration: 40,
            description: 'Corte corto con textura arriba.',
          },
        ],
      },
      {
        name: 'Extras',
        services: [
          {
            name: 'Diseño (líneas)',
            price: 15,
            duration: 15,
            description: 'Líneas o diseño a mano alzada.',
          },
          { name: 'Barba', price: 20, duration: 20, description: 'Perfilado y contorno.' },
        ],
      },
    ],
    overrides: [
      { service: 'Skin fade', staff: 0, price: 55 },
      { service: 'Diseño (líneas)', staff: 1, price: 20, duration: 20 },
    ],
  },
];

const FIRST = [
  'José',
  'Luis',
  'Carlos',
  'Jorge',
  'Miguel',
  'Juan',
  'Renzo',
  'Piero',
  'Diego',
  'Bruno',
  'Andrés',
  'Sebastián',
  'Mateo',
  'Gonzalo',
  'Rodrigo',
  'Kevin',
  'Brayan',
  'Cristian',
  'Álvaro',
  'Fernando',
  'Martín',
  'Raúl',
  'Óscar',
  'Iván',
  'Hugo',
];
const LAST = [
  'Quispe',
  'Flores',
  'Sánchez',
  'Rodríguez',
  'García',
  'Huamán',
  'Mamani',
  'Ramos',
  'Torres',
  'Díaz',
  'Vargas',
  'Castillo',
  'Rojas',
  'Chávez',
  'Mendoza',
  'Gutiérrez',
  'Paredes',
  'Salazar',
  'Cárdenas',
  'Ríos',
];
const NOTES = [
  'Degradado bajo, máquina 1 a los lados',
  'Prefiere tijera arriba, no muy corto',
  'Barba perfilada con navaja',
  'Alérgico a la loción con alcohol',
  'Le gusta conversar de fútbol ⚽',
  'Siempre llega 10 min antes',
  'Raya al costado izquierdo',
];
const TAGS = ['vip', 'fade', 'barba', 'clásico', 'puntual', 'nuevo'];

/** PRNG determinista: mismos datos en cada corrida. */
function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
const timeCol = (hhmm: string) =>
  new Date(Date.UTC(1970, 0, 1, Number(hhmm.slice(0, 2)), Number(hhmm.slice(3))));
/** Fecha local de Lima + minutos del día → instante UTC. */
const limaInstant = (y: number, m: number, d: number, minute: number) =>
  new Date(Date.UTC(y, m, d, Math.floor(minute / 60) + LIMA_OFFSET_H, minute % 60));

export async function seedDemo(prisma: PrismaClient): Promise<void> {
  const reset = process.env.SEED_DEMO_RESET === 'true';
  const passwordHash = await argon2.hash(PASSWORD, {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });

  for (const [index, spec] of SHOPS.entries()) {
    const existing = await prisma.barbershop.findFirst({
      where: { slug: spec.slug, deletedAt: null },
      select: { id: true },
    });
    if (existing && !reset) {
      // Fase 2: barberías demo creadas antes de existir los productos → se les agrega el catálogo.
      if (await seedProducts(prisma, existing.id))
        console.log(`• ${spec.slug}: productos demo agregados`);
      else console.log(`• ${spec.slug}: ya existe (usa SEED_DEMO_RESET=true para recrearla)`);
      continue;
    }
    if (existing) await wipe(prisma, existing.id);
    await createShop(prisma, spec, passwordHash, rng(1000 + index));
  }
}

/** Borra TODO lo de una barbería (orden inverso de dependencias). Solo para datos demo. */
async function wipe(prisma: PrismaClient, id: string): Promise<void> {
  const tables = [
    'inventory_movements',
    'product_stocks',
    'products',
    'message_logs',
    'message_templates',
    'whatsapp_configs',
    'appointment_services',
    'appointments',
    'customer_notes',
    'customers',
    'staff_services',
    'staff_time_off',
    'staff_hours',
    'services',
    'service_categories',
    'staff',
    'schedule_exceptions',
    'holidays',
    'business_hours',
    'gallery_images',
    'stored_files',
    'usage_counters',
    'invoices',
    'subscriptions',
    'memberships',
    'locations',
    'barbershop_settings',
    'audit_logs',
    'shop_roles',
  ];
  await prisma.$transaction(async (tx) => {
    for (const t of tables)
      await tx.$executeRawUnsafe(`DELETE FROM ${t} WHERE barbershop_id = $1::uuid`, id);
    await tx.$executeRawUnsafe(`DELETE FROM barbershops WHERE id = $1::uuid`, id);
  });
}

async function upsertUser(
  prisma: PrismaClient,
  email: string,
  fullName: string,
  passwordHash: string,
): Promise<string> {
  const u = await prisma.user.upsert({
    where: { email },
    create: { email, fullName, passwordHash },
    update: { fullName },
    select: { id: true },
  });
  return u.id;
}

async function createShop(
  prisma: PrismaClient,
  spec: ShopSpec,
  passwordHash: string,
  rand: () => number,
): Promise<void> {
  const plan = await prisma.plan.findUniqueOrThrow({ where: { code: spec.planCode } });
  const now = new Date();

  const shop = await prisma.barbershop.create({
    data: {
      slug: spec.slug,
      name: spec.name,
      description: spec.description,
      status: 'active',
      phone: spec.phone,
      branding: {
        ...spec.branding,
        logoUrl: null,
        faviconUrl: null,
        bannerUrl: null,
        theme: 'light',
      },
      onboarding: { completedSteps: ['branding', 'whatsapp', 'share'], dismissed: true },
      settings: {
        create: {
          bookingRules: {
            minNoticeMinutes: 60,
            maxAdvanceDays: 30,
            slotIntervalMinutes: 15,
            cancellationWindowHours: 2,
            rescheduleWindowHours: 2,
          },
          notifications: { reminderHours: [24, 2] },
        },
      },
    },
    select: { id: true },
  });
  const barbershopId = shop.id;

  const location = await prisma.location.create({
    data: {
      barbershopId,
      name: 'Sede principal',
      address: spec.address,
      reference: spec.reference,
      lat: spec.lat,
      lng: spec.lng,
      phone: spec.phone,
      isPrimary: true,
      timezone: 'America/Lima',
    },
  });
  await prisma.businessHour.createMany({
    data: Object.entries(spec.hours).flatMap(([dow, blocks]) =>
      blocks.map(([s, e]) => ({
        barbershopId,
        locationId: location.id,
        dayOfWeek: Number(dow),
        opensAt: timeCol(s),
        closesAt: timeCol(e),
      })),
    ),
  });
  const year = now.getUTCFullYear();
  await prisma.holiday.createMany({
    data: [...peruHolidays(year), ...peruHolidays(year + 1)].map((h) => ({
      barbershopId,
      date: new Date(`${h.date}T00:00:00Z`),
      name: h.name,
      source: 'pe_national' as const,
    })),
  });

  // Suscripción
  const trial = spec.subscription === 'trialing';
  const sub = await prisma.subscription.create({
    data: {
      barbershopId,
      planId: plan.id,
      status: spec.subscription,
      trialEndsAt: trial ? new Date(now.getTime() + 10 * 86_400_000) : null,
      currentPeriodEnd: new Date(now.getTime() + (trial ? 10 : 20) * 86_400_000),
    },
  });
  if (!trial) {
    await prisma.invoice.create({
      data: {
        barbershopId,
        subscriptionId: sub.id,
        number: `INV-DEMO-${spec.slug.toUpperCase()}`,
        amountCents: plan.priceMonthlyCents,
        currency: plan.currency,
        status: 'paid',
        periodStart: new Date(now.getTime() - 10 * 86_400_000),
        periodEnd: new Date(now.getTime() + 20 * 86_400_000),
        dueAt: new Date(now.getTime() - 3 * 86_400_000),
        paidAt: new Date(now.getTime() - 5 * 86_400_000),
        gatewayRef: 'YAPE-DEMO-001',
      },
    });
  }

  // Dueño y barberos (todos con login)
  const ownerId = await upsertUser(prisma, spec.owner.email, spec.owner.fullName, passwordHash);
  await prisma.membership.create({
    data: { barbershopId, userId: ownerId, role: 'owner', status: 'active' },
  });

  const staffIds: string[] = [];
  for (const [i, s] of spec.staff.entries()) {
    const userId = await upsertUser(prisma, s.email, s.name, passwordHash);
    const m = await prisma.membership.create({
      data: { barbershopId, userId, role: 'barber', status: 'active' },
    });
    const st = await prisma.staff.create({
      data: {
        barbershopId,
        membershipId: m.id,
        locationId: location.id,
        displayName: s.name.split(' ')[0]!,
        bio: s.bio,
        specialties: s.specialties,
        sortOrder: i,
        customHours: Boolean(s.customHours),
      },
    });
    staffIds.push(st.id);
    const rows: Array<{ dayOfWeek: number; startsAt: Date; endsAt: Date; kind: 'work' | 'break' }> =
      [];
    for (const [dow, blocks] of Object.entries(s.customHours ?? {}))
      for (const [a, b] of blocks)
        rows.push({
          dayOfWeek: Number(dow),
          startsAt: timeCol(a),
          endsAt: timeCol(b),
          kind: 'work',
        });
    if (s.lunch) {
      const days = Object.keys(s.customHours ?? spec.hours).map(Number);
      for (const d of days)
        rows.push({
          dayOfWeek: d,
          startsAt: timeCol(s.lunch[0]),
          endsAt: timeCol(s.lunch[1]),
          kind: 'break',
        });
    }
    if (rows.length)
      await prisma.staffHour.createMany({
        data: rows.map((r) => ({ ...r, barbershopId, staffId: st.id })),
      });
  }

  // Servicios
  const services: Array<{
    id: string;
    name: string;
    price: number;
    duration: number;
    bufferAfter: number;
  }> = [];
  for (const [ci, cat] of spec.categories.entries()) {
    const c = await prisma.serviceCategory.create({
      data: { barbershopId, name: cat.name, sortOrder: ci },
    });
    for (const sv of cat.services) {
      const row = await prisma.service.create({
        data: {
          barbershopId,
          categoryId: c.id,
          name: sv.name,
          description: sv.description,
          priceCents: sv.price * 100,
          durationMin: sv.duration,
          bufferAfterMin: sv.bufferAfter ?? 0,
          sortOrder: services.length,
        },
      });
      services.push({
        id: row.id,
        name: sv.name,
        price: sv.price * 100,
        duration: sv.duration,
        bufferAfter: sv.bufferAfter ?? 0,
      });
    }
  }
  await prisma.staffService.createMany({
    data: staffIds.flatMap((staffId, si) =>
      services.map((sv) => {
        const o = spec.overrides.find((x) => x.service === sv.name && x.staff === si);
        return {
          barbershopId,
          staffId,
          serviceId: sv.id,
          priceCentsOverride: o?.price ? o.price * 100 : null,
          durationMinOverride: o?.duration ?? null,
        };
      }),
    ),
  });
  const quote = (staffIdx: number, sv: (typeof services)[number]) => {
    const o = spec.overrides.find((x) => x.service === sv.name && x.staff === staffIdx);
    return { price: o?.price ? o.price * 100 : sv.price, duration: o?.duration ?? sv.duration };
  };

  await seedProducts(prisma, barbershopId);

  // Clientes
  const customers: Array<{ id: string; fullName: string }> = [];
  for (let i = 0; i < 25; i++) {
    const fullName = `${FIRST[(i * 7 + (spec.slug.length % 5)) % FIRST.length]} ${LAST[(i * 3 + 1) % LAST.length]}`;
    const phone = `+519${spec.slug === 'el-clasico' ? '81' : '82'}${String(100000 + i * 37).slice(-6)}`;
    const tags = TAGS.filter((_, k) => (i + k) % 4 === 0).slice(0, 2);
    const c = await prisma.customer.create({
      data: {
        barbershopId,
        fullName,
        phoneE164: phone,
        email:
          i % 3 === 0
            ? `${fullName.split(' ')[0]!.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')}.${i}@mail.pe`
            : null,
        tags,
        birthday: i % 4 === 0 ? new Date(Date.UTC(1985 + (i % 15), i % 12, 1 + (i % 27))) : null,
      },
    });
    customers.push({ id: c.id, fullName });
    if (i % 5 === 0)
      await prisma.customerNote.create({
        data: { barbershopId, customerId: c.id, body: NOTES[i % NOTES.length]! },
      });
  }

  // Citas: −30 a +14 días, por barbero y día, en secuencia (sin solapes, respetando almuerzo y buffers).
  const lastVisit = new Map<string, Date>();
  const noShows = new Map<string, number>();
  let created = 0;
  const today = new Date(now.getTime() - LIMA_OFFSET_H * 3_600_000);
  for (let offset = -30; offset <= 14; offset++) {
    const day = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + offset),
    );
    const [y, m, d, dow] = [
      day.getUTCFullYear(),
      day.getUTCMonth(),
      day.getUTCDate(),
      day.getUTCDay(),
    ];
    const iso = day.toISOString().slice(0, 10);
    if (!spec.hours[dow] || [...peruHolidays(y)].some((h) => h.date === iso)) continue;

    for (const [si, staffId] of staffIds.entries()) {
      const st = spec.staff[si]!;
      const work = (st.customHours ? st.customHours[dow] : spec.hours[dow]) ?? [];
      const density = offset < 0 ? 0.55 : offset <= 3 ? 0.5 : 0.35; // futuro cercano más lleno
      for (const [a, b] of work) {
        let cursor = toMin(a) + Math.floor(rand() * 3) * 15;
        while (cursor < toMin(b)) {
          const sv = services[Math.floor(rand() * services.length)]!;
          const q = quote(si, sv);
          const end = cursor + q.duration;
          const lunch = st.lunch ? [toMin(st.lunch[0]), toMin(st.lunch[1])] : null;
          if (end > toMin(b)) break;
          if (lunch && cursor < lunch[1]! && end > lunch[0]!) {
            cursor = lunch[1]!;
            continue;
          }
          if (rand() < density) {
            const startAt = limaInstant(y, m, d, cursor);
            const endAt = limaInstant(y, m, d, end);
            const isPast = endAt < now;
            const r = rand();
            const status = isPast
              ? r < 0.84
                ? 'completed'
                : r < 0.92
                  ? 'no_show'
                  : 'canceled'
              : r < 0.88
                ? 'confirmed'
                : 'pending';
            const customer =
              rand() < 0.12 ? null : customers[Math.floor(rand() * customers.length)]!;
            await prisma.appointment.create({
              data: {
                barbershopId,
                locationId: location.id,
                staffId,
                customerId: customer?.id ?? null,
                startAt,
                endAt,
                blockStartAt: startAt,
                blockEndAt: new Date(endAt.getTime() + sv.bufferAfter * 60_000),
                status,
                source: customer ? (rand() < 0.65 ? 'online' : 'phone') : 'walk_in',
                totalCents: q.price,
                currency: 'PEN',
                confirmedAt: status !== 'pending' ? startAt : null,
                completedAt: status === 'completed' ? endAt : null,
                canceledAt: status === 'canceled' ? new Date(startAt.getTime() - 86_400_000) : null,
                cancelReason: status === 'canceled' ? 'Cancelada por el cliente' : null,
                items: {
                  create: [
                    {
                      barbershopId,
                      serviceId: sv.id,
                      nameSnapshot: sv.name,
                      priceCents: q.price,
                      durationMin: q.duration,
                    },
                  ],
                },
              },
            });
            created++;
            if (
              customer &&
              status === 'completed' &&
              (!lastVisit.get(customer.id) || lastVisit.get(customer.id)! < startAt)
            )
              lastVisit.set(customer.id, startAt);
            if (customer && status === 'no_show')
              noShows.set(customer.id, (noShows.get(customer.id) ?? 0) + 1);
          }
          cursor = end + sv.bufferAfter + (rand() < 0.5 ? 0 : 15);
          cursor = Math.ceil(cursor / 15) * 15;
        }
      }
    }
  }
  for (const c of customers) {
    await prisma.customer.update({
      where: { id: c.id },
      data: { lastVisitAt: lastVisit.get(c.id) ?? null, noShowCount: noShows.get(c.id) ?? 0 },
    });
  }
  await prisma.usageCounter.upsert({
    where: {
      barbershopId_period_metric: {
        barbershopId,
        period: now.toISOString().slice(0, 7),
        metric: 'whatsappPerMonth',
      },
    },
    create: {
      barbershopId,
      period: now.toISOString().slice(0, 7),
      metric: 'whatsappPerMonth',
      count: 42,
    },
    update: {},
  });
  await prisma.whatsappConfig.create({
    data: { barbershopId, provider: 'platform', status: 'ok', verifiedAt: now },
  });

  console.log(
    `✔ ${spec.name} (${spec.slug}): ${staffIds.length} barberos, ${services.length} servicios, ${customers.length} clientes, ${created} citas`,
  );
}

export const DEMO_ACCOUNTS = SHOPS.flatMap((s) => [
  { shop: s.slug, role: 'owner', email: s.owner.email },
  ...s.staff.map((st) => ({ shop: s.slug, role: 'barber', email: st.email })),
]);
export const DEMO_PASSWORD = PASSWORD;

const PRODUCTS: Array<
  [
    name: string,
    category: string,
    price: number,
    cost: number,
    stock: number,
    min: number,
    sku: string,
  ]
> = [
  ['Cera mate fijación fuerte 100 g', 'Ceras y pomadas', 35, 18, 14, 4, 'CER-MAT-100'],
  ['Pomada brillo 100 g', 'Ceras y pomadas', 32, 16, 3, 4, 'POM-BRI-100'],
  ['Aceite para barba 30 ml', 'Barba', 30, 14, 9, 3, 'ACE-BAR-30'],
  ['Bálsamo para barba 60 g', 'Barba', 28, 13, 6, 3, 'BAL-BAR-60'],
  ['Shampoo anticaspa 250 ml', 'Cuidado', 25, 11, 12, 4, 'SHA-ANT-250'],
  ['Shampoo para barba 120 ml', 'Barba', 22, 10, 0, 2, 'SHA-BAR-120'],
  ['After shave 100 ml', 'Afeitado', 27, 12, 7, 2, 'AFT-SHV-100'],
  ['Peine de madera', 'Accesorios', 15, 5, 20, 5, 'PEI-MAD'],
];

/** Catálogo demo con stock en la sede principal (incluye uno bajo y uno agotado). Idempotente. */
async function seedProducts(prisma: PrismaClient, barbershopId: string): Promise<boolean> {
  if (await prisma.product.count({ where: { barbershopId } })) return false;
  const loc = await prisma.location.findFirst({
    where: { barbershopId, isPrimary: true, deletedAt: null },
    select: { id: true },
  });
  if (!loc) return false;
  for (const [name, category, price, cost, stock, min, sku] of PRODUCTS) {
    const p = await prisma.product.create({
      data: {
        barbershopId,
        name,
        category,
        sku,
        priceCents: price * 100,
        costCents: cost * 100,
        stockMin: min,
      },
    });
    await prisma.productStock.create({
      data: { barbershopId, productId: p.id, locationId: loc.id, quantity: stock },
    });
    if (stock > 0) {
      await prisma.inventoryMovement.create({
        data: {
          barbershopId,
          productId: p.id,
          locationId: loc.id,
          kind: 'purchase',
          quantity: stock,
          balance: stock,
          unitCostCents: cost * 100,
          note: 'Stock inicial (demo)',
        },
      });
    }
  }
  return true;
}
