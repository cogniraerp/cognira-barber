import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// Las migraciones corren con el usuario dueño de las tablas (MIGRATION_DATABASE_URL).
// En runtime la API usa DATABASE_URL, un usuario sometido a RLS.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: process.env['MIGRATION_DATABASE_URL'] ?? process.env['DATABASE_URL'] ?? '',
  },
});
