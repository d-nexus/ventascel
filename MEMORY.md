# MEMORY.md — VentasCel

## Estado actual
- Tienda estática en `index.html` (~5.300 líneas), publicada en GitHub Pages (`d-nexus/ventascel`, rama `main`). Todo el trabajo de la spec 001 está **completado, con commit y push en `main`**.
- Catálogo maestro: `products.json` (`version: 26`, 75 productos). `products.js` es la semilla autogenerada por `npm run build` y **ya está regenerada**: no editarla a mano.
- **Comandos**: `npm run build` (valida y regenera `products.js`), `npm test` (`node --test`), `npm run serve` (sitio en `http://localhost:8080`), `node migrate-to-supabase.js --dry` y `node create-admin-user.js --help`.
- Panel de administración: **acceso con Supabase Auth** (`signInWithPassword`), sin hashes en cliente. CRUD conectado a `public.products`. Respaldo local en clave `ventascel_catalog` (formato `_format:2`).
- Supabase (`hilyinvdcscekeaofbmw`): migración aplicada (`001_initial_schema.sql`), tabla `public.products` (75 filas, `active = true`), `catalog_state` (`version: 38`), bucket `product-images` (76 objetos), secuencia `product_id_seq` en 1012, y triggers de auditoría/versión.
- RLS activa: público lee solo activos; escritura y lectura total exigen rol `admin` en `app_metadata`.
- Cuenta administrador: `dnexus.dev@gmail.com` (rol `admin` en `app_metadata`).
- Especificación 002 (Dashboard, POS & Contabilidad) aprobada y cerrada (T1–T8). `npm test` 112/0, `npm run build` 0, `catalog-core.js` limpio de DOM/red/reloj. Tasa vigente real corregida: **820 CUP = 1 USD** (no 400).

## Decisiones
- Supabase como único backend; sin frameworks ni bundler; `supabase-js` por CDN ESM fijado.
- Precios en CUP con equivalente USD a tasa configurable (inicial 820 CUP = 1 USD); `public.settings` (`exchange_rate`) editables; `public.sales` conserva `rate_used` histórico inmutable; `public.expenses` registra gastos operativos; `public.products` incluye `cost_price`; `register_sale` atómica (`security definer`, `for update`, descuento de stock).
- IDs de productos nuevos asignados por la secuencia del servidor (desde 1000).
- Rol `admin` validado estrictamente en `app_metadata`.
- Copia local del navegador como respaldo (`ventascel_catalog`), sin competir con la BD.
- Panel admin con 5 pestañas: Productos, POS, Gastos, Dashboard, Ajustes.
- Aviso único de degradación (`#catalogNotice`) y reintento recursivo de 15 s sin bloquear almacenamiento.
- Nota pendiente (no corregida en esta spec): `docs/constitution.md` principio 4 afirma que no hay framework de tests, pero `npm test` (`node --test`) existe; la corrección queda pendiente para **Specs 003** o tarea independiente, fuera de esta entrega.

## Errores a evitar
- No escribir credenciales, hashes ni claves en el repo ni en `MEMORY.md`.
- `products.js` no se edita a mano; `products.json` no se sobrescribe sin copia de respaldo.
- Usar `npm run serve` para probar con `fetch` local.
- Para llamadas administrativas a Supabase usar la secret key de `.env`, no la publishable.
- Cuidado con la lógica de baja lógica (`active = false`) vs republicar (`active = true`).
- `updated_at` es `timestamptz`: usar la cadena exacta devuelta por PostgREST para el control optimista de concurrencia.
