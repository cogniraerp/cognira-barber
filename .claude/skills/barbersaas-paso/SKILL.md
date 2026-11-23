---
name: barbersaas-paso
description: Implementa el siguiente paso de BarberSaaS (Cognira Barber) de punta a punta con la receta fija del proyecto (migración → módulo API → pruebas → cliente web → página → QA → README) y verificación de salida corta. Úsalo cuando el usuario diga "sigue", "sigamos" o pida un paso o una funcionalidad nueva de BarberSaaS.
---

# Implementar un paso de BarberSaaS

Las convenciones están en `CLAUDE.md` (raíz). No releas el código para redescubrirlas: lee solo los archivos que vas a tocar, y solo las líneas necesarias (`sed -n`, `grep -n`).

## Receta (en este orden)
1. **Diseño en 5 líneas.** Tablas, endpoints, permisos y la pantalla. Si hay una decisión de producto que no está en `docs/`, pregunta una sola vez.
2. **Esquema y migración.** Modelo en `prisma/schema.prisma` y SQL a mano con GRANT y RLS (plantillas en `CLAUDE.md`). Luego `npx prisma generate`.
3. **Lógica pura primero.** Reglas en un `rules.ts` o `metrics.ts` sin I/O, con su `*.spec.ts`.
4. **Servicio y controlador.** DTO con nestjs-zod; registra el módulo en `app.module.ts` o `shop.module.ts`.
5. **E2E de la API** en `test/e2e/<paso>.e2e.spec.ts`: camino feliz, validaciones (400/404/409), permisos (403) y aislamiento entre barberías.
6. **Verificar:** `bash .claude/skills/barbersaas-paso/check.sh api --e2e`.
7. **Reconstruir y regenerar el cliente** (comandos en `CLAUDE.md`).
8. **Web:**
   - la página en `src/areas/...`, con su ruta en `src/app/router.tsx`;
   - la entrada del menú en `shop-layout.tsx` o en `settings/sections.ts`;
   - las etiquetas en `src/locales/{es,en}/common.json` si el menú las usa.
9. **Verificar:** `bash .claude/skills/barbersaas-paso/check.sh web`.
10. **QA en el navegador:**
    - un script de Playwright en el scratchpad, corrido con el skill `browser-automation`;
    - **una** captura por pantalla nueva (escritorio; móvil solo si hay tablas o formularios grandes);
    - correcciones mínimas.
11. **README** de la API y de la web: una sección corta.
12. **Cierre al usuario,** en español:
    - qué se hizo;
    - cómo probarlo (usuario, ruta y clics);
    - lo pendiente, si lo hay;
    - "Siguiente: …. ¿Sigo?".

## Para gastar menos
- Comandos con salida filtrada: `| tail -n 20`, `| grep -E "Tests |FAIL|error"`. Nunca vuelques suites completas.
- No releas un archivo que acabas de escribir o editar.
- Las suites completas se corren una vez al final del paso (check.sh), no después de cada cambio.
- Corre `prettier --write` **antes** de los reemplazos de texto exactos, no después.
