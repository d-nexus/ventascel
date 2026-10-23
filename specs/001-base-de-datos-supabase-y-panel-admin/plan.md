# Plan 001 — Base de datos Supabase y panel de administración

Spec: `specs/001-base-de-datos-supabase-y-panel-admin/spec.md` (aprobada: 42 RF, 14 RNF, 18 criterios).
Constitución: `docs/constitution.md`. Comandos: `AGENTS.md`. Estado: `MEMORY.md`.

---

## 1. Índice por fases

La implementación **no cabe en 10 tareas**: son 18 tareas de 20-30 min. Se ejecuta por fases, en este orden, porque cada una desbloquea a la siguiente (no se puede escribir en el panel antes de que existan la tabla y las políticas; no se puede publicar la clave publicable antes de que la RLS esté comprobada).

| Fase | Objetivo | RF cubiertos | RNF | Tareas |
|---|---|---|---|---|
| **A** | Esquema, RLS, bucket y cuenta administradora | RF-13, RF-19, RF-26, RF-27, RF-28 | RNF-3, RNF-7, RNF-12, RNF-13 | T1-T5 |
| **B** | Carga inicial del catálogo e imágenes | RF-1..RF-6, RF-12, RF-15 | RNF-10, RNF-11 | T6-T8 |
| **C** | Lógica de negocio pura compartida y tests | RF-11, RF-15, RF-16, RF-20, RF-34, RF-39, RF-40 | RNF-8 | T9-T10 |
| **D** | Acceso del panel por Supabase Auth | RF-24..RF-32 | RNF-12, RNF-14 | T11-T12 |
| **E** | CRUD del panel contra la base de datos | RF-7..RF-23, RF-30, RF-31 | RNF-1, RNF-2 | T13-T15 |
| **F** | Catálogo público, respaldo y degradación | RF-33..RF-42 | RNF-2, RNF-4, RNF-9 | T16-T18 |

Dependencias: **A → B → C → D → E → F**. D y E dependen de B (el catálogo tiene que existir) y C (la lógica pura se usa en el panel). F depende de B y C.

---

## 2. Ficheros que se crean o modifican

| Fichero | Acción | Responsabilidad |
|---|---|---|
| `supabase/migrations/001_initial_schema.sql` | **nuevo** | Esquema de `products` (con `id` como clave primaria), `catalog_state`, secuencia de ids, triggers de auditoría y de versión, RLS de la tabla, bucket `product-images` y sus políticas. Idempotente (se puede aplicar dos veces). |
| `catalog-core.js` | **nuevo** | Lógica de negocio ** pura y determinista**: mapeo fila↔producto, precios CUP/USD, validación, normalización de la copia local, diff de importación, reglas de precio anterior, badge y agotado. Sin DOM, sin red, sin `localStorage`, sin reloj. |
| `test/catalog-core.test.js` | **nuevo** | Suite `node:test` de `catalog-core.js`. |
| `env.js` | **nuevo** | Lectura de `.env` a `process.env` (sin dependencias), compartida por los scripts Node. |
| `create-admin-user.js` | **nuevo** | Provisionado de cuentas por la Admin API: crea el administrador (confirmado, con `app_metadata.role = 'admin'`), compara la contraseña nueva con el hash publicado e informa **solo sí/no**; crea y borra la cuenta de prueba sin rol. No imprime ninguna clave. |
| `migrate-to-supabase.js` | **modificar** | Pasa de «migración destructiva» a **carga inicial idempotente por id**: envía `id`, hace upsert, sube imágenes (y la imagen por defecto), limpia el badge de oferta, fija la versión heredada del maestro. `--force` queda como acción explícita y destructiva con aviso. |
| `index.html` | **modificar** | Acceso al panel con Supabase Auth, CRUD contra la base de datos, lectura pública del catálogo, precios CUP+USD, existencias/agotado, subida de imágenes al bucket, textos corregidos, retirada de «Restaurar original», reintento rearmado. |
| `package.json` | **modificar** | Añadir el script `"test": "node --test"` (tras aprobar la propuesta de §8). |
| `AGENTS.md` | **modificar** | Documentar el comando `npm test` en «Comandos». |
| `MEMORY.md` | **modificar** | Actualizar el estado y las decisiones al cerrar la fase (regla de la skill). |

No se tocan: `products.json` (el maestro solo se regenera por exportación, con copia `*_backup_*.json`), `products.js` (autogenerado), `img/` (salvo decisión pendiente D-4), `opencode.json`, `docs/constitution.md` (ya enmendada).

---

## 3. Lógica de negocio separada de la interfaz

`catalog-core.js` es un **script clásico** (no módulo ES) que se carga en el navegador con `<script src="catalog-core.js">` y se consume en Node con `require('./catalog-core.js')`. El export es dual con una guarda:

```
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.VentasCelCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () { /* ... */ });
```

**Por qué un script clásico y no un módulo ES** (requisito 2 de la tarea): los **módulos ES locales no cargan bajo `file://`** (el origen `null` no tiene CORS), pero el `import` desde CDN sí funciona (jsdelivr responde `Access-Control-Allow-Origin: *`, verificado). El sitio debe seguir funcionando abierto como archivo local (RNF-2). Por tanto:
- El **cliente del servicio** se importa desde CDN en un `<script type="module">` **en línea** dentro de `index.html` (una entrada en línea no suffer CORS; el `import` remoto sí).
- La **lógica pura** va en un script clásico aparte: así se carga con `<script src>` bajo `file://` **y** se importa en Node con `require` para los tests, sin duplicar código ni copiar ficheros.
- Los scripts clásicos se ejecutan al analizarse; los módulos son diferidos. El módulo en línea se ejecuta antes de `DOMContentLoaded`, así que `window.VentasCelCore` y `window.VentasCel` están disponibles cuando arranca el controlador de la interfaz.

### 3.1 Funciones puras de `catalog-core.js`

Todas reciben sus datos por parámetro y devuelven valores; ninguna toca `window`, `document`, `localStorage`, `fetch` ni `Date.now()`.

| Función | Entrada → salida | RF |
|---|---|---|
| `PRICE_RATE` (constante) | `400` CUP por 1 USD | RNF-11 |
| `cupToUsd(cup)` | número → número (2 decimales) | RF-11 |
| `usdToCup(usd)` | número → número (2 decimales) | RF-11 |
| `formatCup(n)` / `formatUsd(n)` | número → texto con separador de miles | RF-11 |
| `normalizeBadge(badge, oldPriceCup)` | texto+número → texto (limpia «¡Oferta!» sin precio anterior) | RF-15 |
| `shouldShowOldPrice(price, oldPrice)` | números → booleano (`oldPrice > price`) | RF-16 |
| `isSoldOut(product)` | producto → booleano (`stock === 0`) | RF-34 |
| `canAddToCart(product)` | producto → booleano | RF-34 |
| `validateProductForm(form)` | objeto de formulario → `{ valid, errors }` | RF-14 |
| `normalizeProduct(raw)` | objeto → producto normalizado (o `null` si es inválido) | RF-14, RF-39 |
| `mapRowToProduct(row)` | fila de BD → producto de cliente (`id, name, category, badge, price, oldPrice, rating, reviews, image, description, specs, stock, active`) | RF-2, RF-40 |
| `mapProductToRow(product)` | producto de cliente → fila de BD (`price_cup, price_usd, old_price_cup, old_price_usd, image_url, ...`) | RF-11, RF-12 |
| `catalogContentKey(product)` | producto → cadena canónica (para detectar si el contenido cambió de verdad) | RF-6, RF-18 |
| `normalizeLocalCopy(parsed)` | objeto parseado → `{ valid, version, products }` (acepta `_format:2` y el array antiguo) | RF-39 |
| `serializeLocalCopy(version, products)` | → `{_format:2, version, products}` | RF-39 |
| `parseImportedCatalog(raw)` | objeto o array → `{ ok, products, error }` (acepta el objeto maestro **y** el array) | RF-20 |
| `diffCatalog(current, imported)` | dos listas → `{ added, updated, removed, unchanged }` | RF-20 |
| `isLocalCopyStale(localVersion, publishedVersion)` | números → booleano | RF-6, RF-38 |
| `filterAndSort(products, { category, query, sort })` | lista + filtros → lista (misma semántica que el filtrado actual) | RF-33 |
| `pickDefaultImage(product)` | producto → URL (o la del bucket) | RF-12 |

### 3.2 Dependencias inyectadas

Fuera de `catalog-core.js` hay **adaptadores** que sí hacen E/S, y reciben todo por parámetro:

- **Red**: `supabase` (cliente) y `fetchImpl` + `timeoutMs` inyectados en `createClient(url, key, { global: { fetch: fetchConTimeout } })`. `fetchConTimeout` es una fábrica pura que envuelve `fetch` con `AbortController` a 12 s (RNF-4). Verificado en la documentación: `supabase-js` acepta `global.fetch`.
- **Almacenamiento**: `storage` (objeto `localStorage`-like) inyectado en las funciones que leen/escriben la copia local y el carrito; en el navegador es `window.localStorage`, en los tests un objeto en memoria.
- **Reloj**: `now()` inyectado donde haga falta una marca de tiempo en cliente (el servidor ya pone `updated_at`; el cliente solo lo usa para mensajes).

---

## 4. Esquema de datos (SQL de la migración)

`supabase/migrations/001_initial_schema.sql`, idempotente. Se aplica con `apply_migration` (MCP), que corre como propietario y por tanto puede crear políticas en `storage.objects`.

```sql
-- 1) Secuencia de ids para productos NUEVOS.
--    Arranca en 1000: reserva el hueco 1..999 (ids heredados del maestro 1..75),
--    y como solo avanza, nunca reutiliza el id de un producto retirado (RF-3).
create sequence if not exists public.product_id_seq start with 1000;

-- 2) Catálogo. `id` es clave primaria y lo asigna el servidor (RF-2, RF-3).
create table if not exists public.products (
  id            bigint primary key default nextval('public.product_id_seq'),
  name          text         not null,
  category      text         not null default 'General',
  badge         text         not null default '',
  price_cup     numeric(12,2) not null default 0 check (price_cup >= 0),
  price_usd     numeric(12,2) check (price_usd is null or price_usd >= 0),
  old_price_cup numeric(12,2) check (old_price_cup is null or old_price_cup >= 0),
  old_price_usd numeric(12,2) check (old_price_usd is null or old_price_usd >= 0),
  rating        numeric(2,1) not null default 4.5 check (rating >= 0 and rating <= 5),
  reviews       integer      not null default 0 check (reviews >= 0),
  image_url     text         not null default '',
  description   text         not null default '',
  specs         jsonb        not null default '[]'::jsonb check (jsonb_typeof(specs) = 'array'),
  stock         integer      check (stock is null or stock >= 0),
  active        boolean      not null default true,
  updated_at    timestamptz  not null default now(),
  updated_by    uuid references auth.users(id) on delete set null
);
create index if not exists products_active_idx on public.products (active);

-- 3) Versión del catálogo: una sola fila (id = 1) (RF-6).
create table if not exists public.catalog_state (
  id         smallint primary key default 1 check (id = 1),
  version    integer     not null default 1,
  updated_at timestamptz not null default now()
);

-- 4) Auditoría: quién y cuándo, decidido por el servidor (RF-19).
create or replace function public.products_set_audit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();   -- NULL en la carga inicial (credencial de servicio)
  return new;
end $$;
drop trigger if exists products_audit_trg on public.products;
create trigger products_audit_trg
  before insert or update on public.products
  for each row execute function public.products_set_audit();

-- 5) La versión SOLO avanza si el contenido cambia de verdad (RF-6).
create or replace function public.products_bump_version()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_changed boolean := false;
begin
  if tg_op = 'INSERT' then v_changed := true;
  elsif tg_op = 'DELETE' then v_changed := true;
  else
    v_changed := row(new.name, new.category, new.badge, new.price_cup, new.price_usd,
                     new.old_price_cup, new.old_price_usd, new.rating, new.reviews,
                     new.image_url, new.description, new.specs, new.stock, new.active)
               is distinct from
                 row(old.name, old.category, old.badge, old.price_cup, old.price_usd,
                     old.old_price_cup, old.old_price_usd, old.rating, old.reviews,
                     old.image_url, old.description, old.specs, old.stock, old.active);
  end if;
  if v_changed then
    update public.catalog_state set version = version + 1, updated_at = now() where id = 1;
  end if;
  return null;
end $$;
drop trigger if exists products_version_trg on public.products;
create trigger products_version_trg
  after insert or update or delete on public.products
  for each row execute function public.products_bump_version();

-- 6) RLS: el público solo lee productos activos; escribir exige rol admin (RF-13, RF-26).
alter table public.products enable row level security;
alter table public.catalog_state enable row level security;

drop policy if exists products_public_read on public.products;
create policy products_public_read on public.products
  for select using (active = true);

drop policy if exists products_admin_read on public.products;
create policy products_admin_read on public.products
  for select to authenticated
  using ((auth.jwt() -> 'app_meta' ->> 'role') = 'admin');

drop policy if exists products_admin_insert on public.products;
create policy products_admin_insert on public.products
  for insert to authenticated
  with check ((auth.jwt() -> 'app_meta' ->> 'role') = 'admin');

drop policy if exists products_admin_update on public.products;
create policy products_admin_update on public.products
  for update to authenticated
  using ((auth.jwt() -> 'app_meta' ->> 'role') = 'admin')
  with check ((auth.jwt() -> 'app_meta' ->> 'role') = 'admin');

drop policy if exists products_admin_delete on public.products;
create policy products_admin_delete on public.products
  for delete to authenticated
  using ((auth.jwt() -> 'app_meta' ->> 'role') = 'admin');

drop policy if exists catalog_state_public_read on public.catalog_state;
create policy catalog_state_public_read on public.catalog_state
  for select using (true);

-- 7) El anónimo no puede ni ver las columnas internas (RNF-5):
--    `updated_at` y `updated_by` no son seleccionables por el rol `anon`.
revoke select (updated_at, updated_by) on public.products from anon;
revoke insert, update, delete on public.products from anon;
revoke insert, update, delete on public.catalog_state from anon, authenticated;

-- 8) Bucket de imágenes: lectura pública, escritura solo admin (RF-13).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 5242880,
        array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "product-images public read" on storage.objects;
create policy "product-images public read" on storage.objects
  for select using (bucket_id = 'product-images');

drop policy if exists "product-images admin insert" on storage.objects;
create policy "product-images admin insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'product-images' and (auth.jwt() -> 'app_meta' ->> 'role') = 'admin');

drop policy if exists "product-images admin update" on storage.objects;
create policy "product-images admin update" on storage.objects
  for update to authenticated
  using (bucket_id = 'product-images' and (auth.jwt() -> 'app_meta' ->> 'role') = 'admin')
  with check (bucket_id = 'product-images' and (auth.jwt() -> 'app_meta' ->> 'role') = 'admin');

drop policy if exists "product-images admin delete" on storage.objects;
create policy "product-images admin delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'product-images' and (auth.jwt() -> 'app_meta' ->> 'role') = 'admin');
```

**Notas de orden y de despliegue**

- El proyecto corre **PostgreSQL 17.11** (verificado), así que `security_invoker`, los `check` y las políticas por columna funcionan sin reservas.
- Tras aplicar la migración hay que **recargar la caché de esquema de PostgREST** (`notify pgrst, 'reload schema';`) para que los cambios de privilegios y políticas se apliquen a las peticiones.
- El `revoke select (updated_at, updated_by)` impide que un visitante los pida, en vez de confiar en que el cliente no los pide (RNF-5 se cumple en el servidor).
- La **lectura del panel** la hace la sesión de administrador con el rol `admin` (`products_admin_read`): ve activos **y** retirados (RF-30). La **lectura pública** usa `products_public_read`: solo activos (RF-34).

---

## 5. Algoritmos (pseudocódigo)

### 5.1 Carga inicial (`migrate-to-supabase.js`)

```
cargarCatalogo({ dry, force }):
  env = loadEnv()                       # .env si existe, si no process.env
  url = env.SUPABASE_URL; key = env.SUPABASE_SERVICE_KEY
  maestro = readJson('products.json')    # { catalog, version: 26, products[] }
  wasEmpty = (SELECT count(*) FROM products) == 0      # vía REST

  for cada p del maestro:
      fila = mapProductToRow(p)          # pure: price_cup/price_usd/old_*/image_url/specs
      fila.id = p.id                     # RF-2: se envía el id
      fila.image_url = await subirImagen(p.image)   # bucket; base64 → fichero; img/... → fichero
      if fila.badge =~ /oferta/i and not fila.old_price_cup: fila.badge = ''   # RF-15
      fila.stock = null; fila.active = true
      await upsertPorId(fila)            # POST con Prefer: resolution=merge-duplicates + on_conflict=id
      # RF-4: upsert; nunca DELETE

  if wasEmpty:
      insert catalog_state (id=1, version=maestro.version=26) on conflict do update
  # si no estaba vacía, la versión la ha subido el trigger solo si cambió el contenido (RF-6)

  if force:                               # RF-5: acción explícita y destructiva
      avisar('Esto borra TODOS los productos de la base de datos y no se puede deshacer')
      if confirmado:
          DELETE FROM products WHERE id > 0
          recargar como carga inicial (wasEmpty = true)

  reportar: filas insertadas/actualizadas, imágenes subidas, versión final
```

- **Idempotencia**: `upsert` por `id` con `Prefer: resolution=merge-duplicates`. Una segunda ejecución con el mismo maestro no cambia ninguna fila → el trigger no bumpea la versión → no se duplica nada y no se pierde lo creado desde el panel (RF-4, RNF-10).
- **Las 21 imágenes embebidas en base64** se decodifican y se suben al bucket con nombre `p<id>.<ext>`; las 54 rutas `img/...` se leen del disco y se suben con su nombre saneado. **La imagen por defecto** (`img/logo.jpg`) se sube como `default.jpg` y su URL es la que se guarda cuando un producto no tiene imagen (RF-12).
- El script **no vuelve a escribir `products.json`**: el maestro del repositorio no se toca (constitución, principio 5).

### 5.2 Provisionado de la cuenta administradora (`create-admin-user.js`)

```
crearAdmin({ email, password }):
  env = loadEnv()
  hashNuevo = sha256(password)
  hashPublicado = leerAdminShaDeIndexHtml()   # regex sobre index.html; aborta si ya no está
  if hashPublicado and hashNuevo == hashPublicado:
      imprimir('La contraseña coincide con la publicada: NO'); salir(1)   # solo sí/no (RF-28)
  # nunca se imprime el hash nuevo ni la clave

  POST {SUPABASE_URL}/auth/v1/admin/users
      headers: apikey = SECRET, Authorization: Bearer SECRET
      body: { email, password, email_confirm: true, app_metadata: { role: 'admin' } }
  imprimir('Cuenta creada con rol admin')     # sin credenciales
```

- La **secret key se lee de `.env`** (ignorado por git) y **no se imprime** en ningún momento: el script solo imprime mensajes de estado.
- El rol va en **`app_metadata`** (no `user_metadata`), que el usuario no puede editar (RF-26).
- La comparación con el `ADMIN_SHA` **exige que `index.html` todavía lo contenga**: por eso la Fase A (que crea la cuenta) va **antes** que la Fase D (que lo borra). Si ya no está, el script avisa y se puede pasar el hash por variable de entorno.

### 5.3 Verificación del rol (cuenta de prueba)

```
verificarRol():
  crear usuario de prueba con app_metadata = {}   (sin rol)   # vía Admin API
  iniciar sesión con ese usuario                    # vía /auth/v1/token?grant_type=password
  POST /rest/v1/products con su access token        # intenta escribir
  esperado: 403                                       # RNF-13, criterio 5
  DELETE /auth/v1/admin/users/<id>                   # se elimina al terminar
```

### 5.4 Ciclo de vida de la sesión del panel

```
alAbrirElPanel():
  sesion = await supabase.auth.getSession()
  if not sesion: mostrarVistaDeAcceso()
  else if not esAdmin(sesion.user): mostrarAviso('Sin permisos'); cerrar()
  else: mostrarPanel()

supabase.auth.onAuthStateChange((evento, sesion) => {
  if evento == 'SIGNED_OUT': bloquearPanel('Sesión cerrada')
  if evento == 'TOKEN_REFRESHED': refrescarVista()      # renewal silencioso (RF-29)
  if evento == 'SIGNED_IN': si esAdmin(sesion) mostrarPanel()
})

alGuardar():
  if guardando: return                                   # doble «Guardar» → una vez (RF-17)
  guardando = true
  try:
      resultado = await guardarEnBd(formulario)
      if resultado.conflicto: avisar('El registro había cambiado')   # RF-18
      else: confirmar('Guardado')                                       # RF-7
  catch (e):
      avisar('No se pudo guardar: ...')   # no da el cambio por guardado (RF-23)
      conservarElFormulario()              # no se borra lo escrito (RF-23, RF-29)
  finally: guardando = false
```

### 5.5 Catálogo público y degradación (`initCatalog`)

```
async initCatalog():
  try:
      { productos, version } = await leerCatalogoPublicado()   # RLS: solo activos
      aplicarCatalogo(productos, version)
      guardarCopiaLocal(version, productos)   # respaldo fresco (RF-38)
      limpiarAvisoDeDegradacion()
  catch (e):
      copia = leerCopiaLocal()                # RF-38: se conserva mientras la BD no responde
      semilla = window.VENTASCEL_CATALOG
      aplicarCatalogo(copia?.products ?? semilla.products, copia?.version ?? semilla.version)
      mostrarAvisoUnico('Sin conexión con el catálogo: la información puede estar desactualizada')  # RF-36
      programarReintento()

programarReintento(delay = 15000):
  clearTimeout(timer)
  timer = setTimeout(async () => {
      try:
          { productos, version } = await leerCatalogoPublicado()
          aplicarCatalogo(productos, version)
          guardarCopiaLocal(version, productos)
          limpiarAvisoDeDegradacion()
      catch (e):
          programarReintento(delay)      # se rearma en cada fallo (RNF-4, RF-36)
  }, delay)
```

- `leerCatalogoPublicado()` usa el cliente con `fetch` inyectado y **timeout de 12 s** (RNF-4).
- El aviso de degradación es **uno en pantalla**, con botón de cerrar, y **no reaparece** en cada reintento (RF-36).
- `guardarCopiaLocal` **nunca** se llama cuando la BD no ha respondido: así la copia local previa no se sobrescribe (RF-38) y no se pierde nada del navegador (RF-37).

### 5.6 Importación de un catálogo

```
importarCatalogo(archivo):
  crudo = JSON.parse(texto)                       # puede fallar
  { ok, productos, error } = parseImportedCatalog(crudo)   # acepta objeto maestro o array
  if not ok: avisar('Archivo inválido: ...'); return       # la BD queda como estaba (RF-20)
  actual = await leerCatalogoPublicado(incluirRetirados)
  diff = diffCatalog(actual, productos)
  if diff.removed.length > 0:
      if not confirm('Se retirarán N productos (se conservan como bajas lógicas). ¿Continuar?'):
          return                                     # confirmación previa (RF-20)
  aplicar diff: altas, ediciones y retiradas (active = false)   # bajas lógicas, se conserva el registro
  avisar('Añadidos X · Actualizados Y · Retirados Z')
```

---

## 6. Cómo se muestra en la interfaz

**Pantalla de acceso del panel** (sustituye la de contraseña): campo de **correo** y campo de **contraseña**, botón «Entrar». Error genérico («Credenciales incorrectas») sin revelar si la cuenta existe (RF-25). Se elimina el hash y su fallback del código (RF-32).

**Lista del panel**: cada fila muestra nombre, categoría, precio en **CUP** y su equivalente en **USD**, estado (**activo** / **retirado** / **agotado**) y existencias. Se listan **activos y retirados**; los retirados se distinguen visualmente y pueden republicarse (RF-30, RF-9).

**Formulario de producto**: nombre, categoría, etiqueta, **precio actual (CUP)**, **precio anterior (CUP)**, **existencias** (entero ≥ 0 o vacío), **estado activo/retirado**, valoración, reseñas, descripción, especificaciones e **imagen**: solo subida de fichero (el campo de texto libre desaparece) con vista previa; la imagen se sube al bucket y se guarda su URL (RF-12). Las etiquetas dejan de decir «($)» (RF-11).

**Aviso de cambios**: el toast tras guardar deja de ofrecer «Descargar products.json» como paso obligatorio y explica que el catálogo ya está publicado; el botón de exportación sigue disponible como respaldo (RF-21, RF-31). Se elimina el botón **«Restaurar original»** (RF-22).

**Tienda pública**: cada tarjeta muestra el precio en **CUP** y, debajo, el equivalente en **USD** («1 500 CUP · 3,75 USD»). Los productos **agotados** llevan una marca «Agotado» y su botón «Añadir al carrito» no añade (RF-34). El carrito, los totales, la ficha ampliada y el **mensaje de WhatsApp** muestran también CUP y USD (RF-11). Con la base de datos caída aparece **un único aviso** cerrable en lugar de la tienda (RF-36).

---

## 7. Decisiones técnicas (con la alternativa descartada)

| # | Decisión | Alternativa descartada | Por qué |
|---|---|---|---|
| D-1 | **Cliente `@supabase/supabase-js@2.118.0` por CDN ESM**, versión fijada | Cargar `+esm` sin versión («latest») | RNF-14: el sitio no puede romperse por un cambio del proveedor. `2.118.0` es la versión estable publicada (npm, 2026-10-15). |
| D-2 | **`catalog-core.js` como script clásico con export dual** | Módulo ES local | Los módulos ES locales no cargan bajo `file://` (RNF-2). Un script clásico se carga con `<script src>` y se importa en Node con `require` → un solo código para el navegador y los tests. |
| D-3 | **Lógica pura en `catalog-core.js`; adaptadores de E/S aparte** | Todo el JS dentro de `index.html` | Constitución, principio 3: sin DOM, red ni almacenamiento dentro de la lógica de negocio. Permite probar con `node:test` sin navegador. |
| D-4 | **El acceso al servicio con `supabase-js`, no con `fetch` a pelo** | API REST directa | El usuario lo ha elegido y la constitución lo permite. `supabase-js` además centraliza sesión, refresco y almacenamiento. |
| D-5 | **`id` como `bigint` con secuencia desde 1000** | `bigserial` desde 1, o id calculado en el cliente | 1-999 queda reservado para los ids heredados (1..75); la secuencia solo avanza → **nunca** reutiliza el id de un producto retirado (RF-3); y el id lo pone el servidor (el cliente nunca lo calcula: se elimina `nextProductId`). |
| D-6 | **Baja lógica (`active = false`), nunca `DELETE`** | Borrado físico | RF-8 exige conservar el registro; permite republicar (RF-5/RF-30). El `DELETE` físico queda solo para la acción destructiva explícita. |
| D-7 | **Versión en `catalog_state` + trigger que solo bumpea si el contenido cambia** | Incrementar la versión en el cliente | El cliente podría saltarse un cambio o inventarse uno; el trigger lo decide en el servidor y con la fila de la base de datos (RF-6). |
| D-8 | **`revoke select (updated_at, updated_by) from anon`** | Confiar en que el cliente no pide esas columnas | RNF-5 se cumple en el servidor: un visitante no puede pedirlas ni aunque lo intente. |
| D-9 | **El panel lee la tabla (ve retirados); el público lee la tabla con la política `active = true`** | Una vista `catalog` con las columnas públicas | Menos objetos y una sola fuente de verdad; el RLS ya filtra por rol y por `active`. La vista se reserva para una spec futura si hiciera falta. |
| D-10 | **La carga inicial es idempotente por id (upsert)** | `DELETE` + re-inserción (lo que hace hoy `--force`) | Hoy `--force` borra todo lo que el administrador haya creado (choca con RF-4/RNF-10 y con la constitución). El borrado masivo queda como acción explícita con aviso (RF-5). |
| D-11 | **`migrate-to-supabase.js` conserva su nombre** | Renombrarlo a `load-catalog.js` | Evitaría tocar `AGENTS.md` y `MEMORY.md` por un cambio de nombre; la semántica nueva se documenta en la cabecera del script y en `MEMORY.md`. |
| D-12 | **Los 9 sitios de precio se tocan de forma explícita** | Un formateador único ya aplicado | Los precios se pintan en 9 plantillas distintas (tarjeta, carrito, totales ×3, drawer de favoritos, mensaje de WhatsApp, modal, panel). Se unifican con `formatCup`/`formatUsd` de `catalog-core.js`. |
| D-13 | **La cuenta de admin se crea por la Admin API desde un script Node** | Crearla a mano en el dashboard | Es reproducible, verificable (mismo hash público = mismo código) y no exige que el usuario clickee en un panel. El MCP no tiene herramienta de usuarios de Auth. |
| D-14 | **`npm test` → `node --test`** (propuesta, §8) | Instalar un framework (vitest/jest) | La constitución prohíbe dependencias npm; Node 18+ ya trae `node:test` y `node:assert`. |

---

## 8. Estrategia de tests

### 8.1 Propuesta de comando de tests (pendiente de aprobación)

El proyecto **no tiene comando de tests** (`AGENTS.md` solo define `npm run build` y `npm run serve`), y la constitución (principio 4) exige que la lógica se pruebe. Node 18+ trae el runner incorporado, así que la propuesta es:

```json
"scripts": {
  "build": "node build-catalog.js",
  "serve": "python3 -m http.server 8080",
  "test": "node --test"
}
```

`npm test` ejecutaría `node --test`, que descubre `test/*.test.js` y usa `node:test` + `node:assert` **sin instalar nada**. Si la versión local de Node fuera anterior a 18.13, se usaría `node --test test/` explícito o habría que subir Node: **hay que confirmar la versión local de Node antes de dar por buena la propuesta**.

### 8.2 Reparto de la verificación

| Tipo | Qué cubre | Cómo se comprueba |
|---|---|---|
| **Tests automáticos** (`npm test`) | Toda la lógica pura de `catalog-core.js`: conversión CUP↔USD (400) y redondeo; mapeo fila↔producto y nombres de campo de cliente; validación del formulario; limpieza del badge de oferta; precio anterior solo si es mayor; detección de agotado y `canAddToCart`; normalización de la copia local `{_format:2}` y rechazo de copias corruptas; parseo de importación (objeto maestro **y** array) y diff (añadidos/actualizados/retirados); comparación de versiones y regla de reemplazo de la copia local; clave canónica de contenido | `npm test` en verde |
| **SQL / MCP** | Esquema y tipos; RLS (lectura pública solo de activos; escritura admin); políticas del bucket; triggers de auditoría y de versión; recuento e ids de la carga; `catalog_state.version`; 403 de una cuenta sin rol; `get_advisors` sin avisos críticos | `execute_sql`, `list_tables`, `get_advisors` del MCP de Supabase |
| **Verificación manual en el navegador** | Acceso al panel y error genérico; alta/edición/baja contra la BD; lista con retirados y agotados; precios CUP+USD en los 9 sitios; imagen subida al bucket; mensaje de WhatsApp; **modo degradado** (BD caída → aviso único, reintento y recuperación sin recargar en ≤ 15 s); sitio abierto como `file://`; **ancho 375 px**; carrito y favoritos preexistentes siguen leyéndose | `npm run serve` + navegador |
| **Puerta de la constitución** | `npm run build` en verde (valida el maestro y regenera la semilla) | `npm run build` |

**Regla de avance**: ninguna tarea se da por cerrada con la verificación en rojo (constitución, principio 4). El plan **no** añade `npm test` al `package.json`: lo hará el implementer tras la aprobación de esta propuesta.

---

## 9. Riesgos y contingencias

| Riesgo | Mitigación |
|---|---|
| La clave publicable se publica antes de que la RLS esté comprobada (RNF-12) | El orden de las tareas lo impide: la clave solo se incrusta en la Fase D, y la Fase D exige la Fase A cerrada (políticas aplicadas y `get_advisors` limpio). |
| El MCP de Supabase pide un `project_ref` inválido | Usar siempre `project_id` explícito (`hilyinvdcscekeaofbmw`) o la versión a nivel de cuenta (`MEMORY.md`). |
| La secret key no existe todavía | Es un paso del usuario (crear la clave y el `.env`) y es previo a T4. Las tareas A.1-A.3 no la necesitan. |
| La API acepta peticiones desde `file://` (CORS `*` y `Origin: null`) | No se apoya en el origen para proteger nada: la escritura la bloquea la RLS del servidor (RF-26). Hay un caso límite explícito. |
| La carga inicial se repite y pisa cambios del administrador | Upsert por id + el trigger solo bumpea si el contenido cambia (RF-4, RNF-10). |
| El panel queda con productos «retirados» que el público no ve | El panel lista activos y retirados con su estado (RF-30). |
| El sitio crece con el cliente CDN | `supabase-js` por CDN ESM añade ~40-50 KB comprimidos; se acepta (es la alternativa elegida y el sitio sigue siendo estático). |
| La semilla desfasada (54 vs 75) | La carga inicial regenera la semilla (`npm run build`) y el criterio 16 lo comprueba. |

---

## 10. Decisiones pendientes de aprobación

| # | Decisión | Recomendación |
|---|---|---|
| **P-1** | **Comando de tests**: ¿se añade `"test": "node --test"` al `package.json` y `npm test` a `AGENTS.md`? | **Sí.** Es lo único que permite probar la lógica pura sin dependencias npm (constitución, principios 1 y 4). Requiere Node ≥ 18.13 (comprobar la versión local). |
| **P-2** | **Versión de `supabase-js` a fijar**: `2.118.0` (la estable actual, publicada el 2026-10-15; verificado en el registro de npm) o `2.117.3` (la anterior). | **2.118.0.** Es la que el proveedor marca como estable; fijarla por versión exacta cumple RNF-14. |
| **P-3** | **Qué hacer con `img/` (7 MB)**: la semilla de respaldo sigue apuntando a `img/...`, así que la carpeta **debe seguir en el repositorio** para que el modo degradado muestre imágenes sin red. Alternativa: regenerar el maestro desde la exportación (URLs del bucket) y borrar `img/`, pero eso sobrescribe el maestro (con copia) y cambia su formato. | **Mantener `img/`** (no destructivo, cero riesgo). El catálogo *publicado* ya no depende de ella (RF-12); solo el respaldo local. |
| **P-4** | **Cuenta de prueba para verificar la RLS**: se crea con la Admin API y se borra al terminar (RNF-13). Su correo y contraseña se generan en cada ejecución (nunca en el repo). | **Aceptar tal cual.** Es la única forma de comprobar el criterio 5. |

---

## 11. Correspondencia requisito → fase

| RF | Fase | Tareas |
|---|---|---|
| RF-1, RF-2, RF-4, RF-5, RF-6 | B | T6, T7 |
| RF-3 | A (esquema) + B | T1, T6, T13 |
| RF-7, RF-8, RF-9, RF-10, RF-11, RF-12, RF-14, RF-15, RF-16, RF-17, RF-18, RF-19, RF-22, RF-23 | E (+ C para la lógica pura) | T9, T13, T14, T15 |
| RF-13 | A | T1, T2, T5 |
| RF-20, RF-21 | E | T9, T14 |
| RF-24, RF-25, RF-26, RF-27, RF-28, RF-29, RF-30, RF-31, RF-32 | D (+ E para RF-30/31) | T11, T12, T13 |
| RF-33, RF-34, RF-35, RF-36, RF-37, RF-38, RF-39, RF-40, RF-41, RF-42 | F (+ C) | T9, T16, T17 |
| RNF-1, RNF-14 | D | T11 |
| RNF-2, RNF-3, RNF-5, RNF-10, RNF-11, RNF-12, RNF-13 | A, B, F | T1-T8, T18 |
| RNF-4 | F | T17 |
| RNF-7 | A | T3, T4 |
| RNF-8 | C | T9, T10 |
| RNF-9 | F | T18 |

Fin del plan. **El cambio queda en el working tree para revisión**: no se hace commit ni push sin que lo pidas.
