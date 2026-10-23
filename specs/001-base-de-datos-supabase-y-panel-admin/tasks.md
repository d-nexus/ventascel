# Tareas 001 — Base de datos Supabase y panel de administración

Plan: `specs/001-base-de-datos-supabase-y-panel-admin/plan.md` · Spec: `specs/001-base-de-datos-supabase-y-panel-admin/spec.md` (aprobada).

**18 tareas** de 20-30 min, agrupadas en 6 fases (A→F) con dependencias estrictas. La Fase A deja el servidor listo y protegido; la Fase B mete el catálogo; la Fase C crea la lógica pura y sus tests; la Fase D abre el panel con Supabase Auth; la Fase E mueve el CRUD a la base de datos; la Fase F pone la tienda a leer de la base de datos.

Regla de avance (constitución, principio 4): **ninguna tarea se cierra con la verificación en rojo**. Todo el cambio queda en el working tree para revisión: **no se hace commit ni push** sin que lo pidas.

---

## Fase A — Esquema, políticas y cuenta administradora

- [x] **T1. Escribir la migración de esquema, RLS, bucket y políticas.** RF-1, RF-2, RF-3, RF-6, RF-13, RF-19, RF-26, RF-27, RNF-3
  - Crear `supabase/migrations/001_initial_schema.sql` con el SQL del §4 del plan: tabla `products` (`id bigint` con `default nextval('public.product_id_seq')`, secuencia desde 1000), tabla `catalog_state` (una fila, `id = 1`), trigger de auditoría (`updated_by = auth.uid()`), trigger de versión (solo bumpea si el contenido cambia), RLS de `products` (público solo `active = true`; admins autenticados leen todo y escriben), política de lectura de `catalog_state`, `revoke select (updated_at, updated_by) from anon`, bucket `product-images` público y sus cuatro políticas (lectura pública; escritura solo `admin`).
  - Hecho cuando: el fichero existe, es idempotente (se puede aplicar dos veces sin error) y `node -e "require('fs').readFileSync('supabase/migrations/001_initial_schema.sql','utf8')"` no falla.

- [x] **T2. Aplicar la migración y comprobar que el servidor queda protegido.** RF-13, RF-26, RNF-3, RNF-12
  - Aplicar el contenido de la migración con `apply_migration` del MCP de Supabase (`project_id: hilyinvdcscekeaofbmw`) y después ejecutar `notify pgrst, 'reload schema';`.
  - Hecho cuando: `list_tables` devuelve `products` y `catalog_state`; `get_advisors` no reporta avisos críticos; una consulta con la clave publishable (`select id,name from products`) devuelve 0 filas sin error de permisos; y una escritura con la misma clave devuelve error de RLS.

- [x] **T3. Crear el cargador de `.env` y el script de provisionado de cuentas.** RF-27, RF-28, RNF-7
  - Crear `env.js` (lee `.env` a `process.env`, sin dependencias, con precedencia a `process.env`) y `create-admin-user.js` (Node, sin dependencias): usa la Admin API (`POST {SUPABASE_URL}/auth/v1/admin/users`, cabeceras `apikey` + `Authorization: Bearer <secret>`), crea la cuenta con `email_confirm: true` y `app_metadata: { role: 'admin' }`, y **antes** compara el SHA-256 de la contraseña nueva con el `ADMIN_SHA` que hay hoy en `index.html`, informando **solo sí/no**; nunca imprime la clave ni el hash nuevo.
  - Hecho cuando: `node create-admin-user.js --help` responde sin error; el script **no contiene** ninguna clave ni contraseña en su código; y `grep -rn "sb_secret\|eyJhbGci" --include="*.js" .` no devuelve nada.

- [x] **T4. Crear la secret key y el `.env` (usuario) y dar de alta la cuenta administradora.** RF-27, RF-28, RNF-7
  - El usuario crea la secret key en el panel del proyecto y escribe `.env` con `SUPABASE_URL`, `SUPABASE_SECRET_KEY` y `SUPABASE_SERVICE_KEY` (`.env` ya está en `.gitignore`).
  - Ejecutar `node create-admin-user.js --email <correo> --password <contraseña>`.
  - Hecho cuando: el script informa «cuenta creada con rol admin» **sin imprimir credenciales**; `git status` no muestra `.env`; y la contraseña usada **no** coincide con la que hoy está publicada (el script lo dice explícitamente).

- [x] **T5. Verificar que una cuenta sin rol `admin` no puede escribir.** RF-13, RF-26, RNF-13
  - Crear con la Admin API una cuenta de prueba **sin** `app_metadata.role`, iniciar sesión con ella, intentar un `POST /rest/v1/products` y un `POST /storage/v1/object/product-images/...` con su token, y borrar la cuenta al terminar.
  - Hecho cuando: los dos intentos de escritura devuelven **403**; la lectura pública de `products` sigue funcionando; y la cuenta de prueba **ya no existe** (verificado con la Admin API).

---

## Fase B — Carga inicial del catálogo e imágenes

- [x] **T6. Convertir `migrate-to-supabase.js` en carga idempotente por id.** RF-1, RF-2, RF-3, RF-4, RF-5, RF-6, RF-12, RF-15, RNF-10, RNF-11
  - Que envíe el `id` de cada producto (upsert por `id` con `Prefer: resolution=merge-duplicates`), **nunca** borre filas que solo existan en la base de datos, suba al bucket las 54 imágenes `img/...` y las 21 embebidas en base64, suba también la imagen por defecto (`img/logo.jpg` → `default.jpg`), limpie la etiqueta de oferta sin precio anterior, ponga `stock = null` y `active = true`, use `RATE = 400` para `price_usd`/`old_price_usd`, y fije la versión heredada del maestro (26) solo cuando la tabla estaba vacía. `--force` queda como borrado masivo **explícito**, con aviso previo y confirmación, fuera del flujo normal.
  - Hecho cuando: `node migrate-to-supabase.js --dry` informa de 75 filas a insertar y no escribe nada; y el código **no contiene** ningún `DELETE` fuera de la rama `--force`.

- [x] **T7. Ejecutar la carga inicial y comprobar el resultado.** RF-1, RF-2, RF-6, RF-12, RF-15, RNF-10, RNF-11
  - Ejecutar `node migrate-to-supabase.js` y verificar por SQL.
  - Hecho cuando: `select count(*) from products` = **75**; `select min(id), max(id) from products` = 1 y 75; `select count(*) from products where image_url like '%/storage/v1/object/public/product-images/%'` = 75; `select count(*) from products where badge ilike '%oferta%' and old_price_cup is null` = 0; `select version from catalog_state` = 26; y `select count(*) from products where stock is not null` = 0.

- [x] **T8. Regenerar la semilla del sitio.** RNF-2
  - Ejecutar `npm run build` (el maestro sigue siendo `products.json`, sin tocarlo).
  - Hecho cuando: `npm run build` termina con código 0 y `products.js` contiene **75** productos (antes 54) y `version: 26`.

---

## Fase C — Lógica de negocio pura compartida y tests

- [x] **T9. Crear `catalog-core.js` con la lógica pura.** RF-11, RF-14, RF-15, RF-16, RF-20, RF-34, RF-39, RF-40, RNF-8
  - Script clásico con export dual (`module.exports` en Node / `window.VentasCelCore` en el navegador) y las funciones de §3.1 del plan: `cupToUsd`, `usdToCup`, `formatCup`, `formatUsd`, `normalizeBadge`, `shouldShowOldPrice`, `isSoldOut`, `canAddToCart`, `validateProductForm`, `normalizeProduct`, `mapRowToProduct`, `mapProductToRow`, `catalogContentKey`, `normalizeLocalCopy`, `serializeLocalCopy`, `parseImportedCatalog`, `diffCatalog`, `isLocalCopyStale`, `filterAndSort`. Sin DOM, red, almacenamiento ni `Date`.
  - Hecho cuando: `node -e "const c=require('./catalog-core.js'); console.log(c.cupToUsd(1500))"` imprime `3.75`; y `grep -n "document\.\|localStorage\|fetch(\|Date\.now" catalog-core.js` no devuelve nada.

- [x] **T10. Crear la suite de tests y el comando `npm test`.** RNF-8
  - Crear `test/catalog-core.test.js` con `node:test` + `node:assert` cubriendo: conversión CUP/USD y redondeo; mapeo fila↔producto y nombres de campo de cliente; validación del formulario; limpieza del badge; precio anterior solo si es mayor; agotado y `canAddToCart`; normalización de la copia local `{_format:2}` y rechazo de copias corruptas; parseo de importación (objeto maestro **y** array) y diff; comparación de versiones; clave canónica de contenido.
  - Añadir `"test": "node --test"` al `package.json` y `npm test` a la sección «Comandos» de `AGENTS.md`.
  - Hecho cuando: `npm test` termina en verde (todas las pruebas en verde) y `npm run build` sigue en verde. **Requiere la aprobación previa de la propuesta P-1 del plan.**

---

## Fase D — Acceso del panel por Supabase Auth

- [x] **T11. Sustituir la contraseña por Supabase Auth y eliminar el hash del cliente.** RF-24, RF-25, RF-32, RNF-12, RNF-14
  - En `index.html`: quitar `ADMIN_SHA`, `ADMIN_FNV`, `fnv1a` y `verifyAdminPassword`; añadir un `<script type="module">` en línea que importe `@supabase/supabase-js@2.118.0` desde CDN ESM (versión fijada) y exponga el cliente en `window.VentasCel`; añadir `catalog-core.js` con `<script src="catalog-core.js">`; y sustituir la pantalla de acceso por correo + contraseña (`signInWithPassword`), con `fetch` inyectado y timeout de 12 s.
  - Hecho cuando: `grep -c "ADMIN_SHA\|ADMIN_FNV\|fnv1a" index.html` = 0; entrar con la cuenta del administrador abre el panel y con credenciales incorrectas muestra un error **genérico** que no revela si la cuenta existe; y el sitio sigue mostrando el catálogo abierto como `file://`.

- [x] **T12. Gestionar el ciclo de vida de la sesión y el rol.** RF-26, RF-29, RF-30
  - `onAuthStateChange`: al cerrar sesión o no poder renovar el token, bloquear el panel, **conservar lo escrito en el formulario**, avisar de lo no guardado y cerrar; comprobar el rol `admin` en `app_metadata` antes de abrir el panel; y mostrar en el panel los productos **activos y retirados** con su estado.
  - Hecho cuando: al cerrar sesión, el panel se bloquea y avisa sin perder el contenido del formulario; una cuenta sin rol no abre el panel; y el listado del panel incluye los productos retirados con su estado visible.

---

## Fase E — CRUD del panel contra la base de datos

- [x] **T13. Mover el alta, la edición y la baja del panel a la base de datos.** RF-3, RF-7, RF-8, RF-9, RF-10, RF-11, RF-12, RF-19, RF-22, RF-30, RF-31
  - Guardar y editar contra la tabla `products` (el `id` de los productos nuevos lo asigna el servidor: se elimina `nextProductId`); baja lógica con `active = false`, aviso de que el registro se conserva y limpieza del carrito y favoritos del navegador del administrador; control de estado activo/retirado y campo de existencias (entero ≥ 0 o vacío); etiquetas de precio en CUP; subida de imagen al bucket con el campo de texto libre eliminado; textos del panel corregidos (pista y aviso de cambios) y **eliminación del botón «Restaurar original»**; precios en CUP y USD en la lista del panel.
  - Hecho cuando: un alta, una edición y una baja desde el panel se ven por SQL en `products` (y no solo en el navegador); el producto nuevo recibe `id >= 1000`; `grep -c "resetCatalog\|Restaurar original" index.html` = 0 en el marcado; y `grep -n "Precio actual (\\$)" index.html` no devuelve nada.

- [x] **T14. Implementar la importación con diff y la exportación de respaldo.** RF-20, RF-21, RF-22
  - Importar aceptando **el objeto maestro y el array**, calculando el diff (añadidos/actualizados/retirados), exigiendo confirmación antes de aplicar las retiradas (que son bajas lógicas) y rechazando un archivo mal formado **sin tocar la base de datos**; exportar el catálogo de la base de datos con el formato del maestro vigente, como copia de respaldo y no como paso obligatorio para publicar.
  - Hecho cuando: importar el mismo archivo dos veces no crea ni duplica filas; importar un archivo mal formado muestra un error y `select count(*) from products` no cambia; y la exportación produce un objeto `{catalog, version, updated, products}` con el contenido de la base de datos.

- [x] **T15. Blindar el guardado ante fallos y concurrencia.** RF-17, RF-18, RF-23
  - Doble pulsación de «Guardar» → una sola escritura; dos paneles sobre el mismo producto → el cambio más reciente manda y el administrador ve el aviso de que el registro había cambiado; fallo de escritura (red caída o sesión caducada) → aviso explícito de que **no** se ha guardado, sin dar el cambio por guardado y conservando lo escrito en el formulario.
  - Hecho cuando: pulsando «Guardar» dos veces solo se crea un producto (`select count(*) from products` aumenta en 1); con la base de datos caída el panel avisa del fallo, no dice «guardado» y el formulario conserva lo escrito; y al editar desde dos pestañas, la segunda ve el aviso de conflicto.

---

## Fase F — Catálogo público, respaldo y degradación

- [x] **T16. Hacer que la tienda lea el catálogo de la base de datos con los precios en CUP y USD.** RF-11, RF-33, RF-34, RF-40
  - Lectura pública de `products` (solo `active = true` por RLS) mapeada con `mapRowToProduct`; precios en CUP **y** equivalente USD en los 9 sitios (tarjeta, carrito, totales ×3, drawer de favoritos, mensaje de WhatsApp, modal, panel); productos agotados marcados y no añadibles al carrito; y el carrito y los favoritos preexistentes (formato `price`/`oldPrice`/`image`) siguen leyéndose y apuntando al producto correcto.
  - Hecho cuando: la tienda muestra los precios en CUP y USD en los 9 sitios; un producto con `stock = 0` aparece marcado como agotado y el botón de compra no lo añade al carrito; y un carrito guardado antes del cambio sigue señalando al producto correcto con su precio en CUP.

- [x] **T17. Implementar el respaldo local y el modo degradado.** RF-35, RF-36, RF-37, RF-38, RF-39, RF-41, RF-42, RNF-4
  - Copia local con el formato `{_format:2, version, products[]}` validado; la copia se conserva sin sobrescribir mientras la base de datos no ha respondido y se reemplaza por la versión publicada cuando responde; **aviso único** en pantalla, con botón de cerrar y sin reaparecer en cada reintento; reintento cada 15 s **rearmado** en cada fallo; sin borrar ni sobrescribir carrito, favoritos, tema ni copia local por un fallo; omisión de productos inexistentes en carrito y favoritos; y continuidad si no hay espacio de almacenamiento.
  - Hecho cuando: con la base de datos caída la tienda muestra un catálogo y **un solo** aviso (cerrable); al restaurarla, el catálogo se actualiza **sin recargar la página** en 15 s o menos; la copia local en `localStorage` conserva su formato `_format:2`; y un carrito con un producto borrado se muestra sin ese producto.

- [x] **T18. Verificación final, limpieza y actualización de la memoria.** RNF-2, RNF-8, RNF-9, RNF-12
  - Pasar la puerta de verificación completa y documentar el resultado.
  - Hecho cuando: `npm run build` y `npm test` están en verde; `get_advisors` no reporta avisos críticos; una revisión manual en el navegador confirma el acceso al panel, el CRUD, el modo degradado, el mensaje de WhatsApp con CUP y USD, la apertura como `file://` y el ancho de 375 px; `MEMORY.md` queda actualizado (estado, decisiones y errores a evitar); y **no hay ningún commit ni push hecho**.
  - Resultado: `npm run build` y `npm test` en verde (102 pruebas, 0 fallos); `migrate-to-supabase.js --dry` informa de 75 filas sin escribir; `create-admin-user.js --help` sale con 0; `node --check` en verde en los cuatro scripts nuevos; revisión manual en Chrome (CDP) del sitio como `file://` y por HTTP (75 tarjetas, precios CUP+USD, sin errores de consola), del acceso al panel (alta, edición, baja lógica, republicación y doble guardado → una sola escritura), del modo degradado (un único aviso cerrable y recuperación sin recargar) y del mensaje de WhatsApp (CUP y USD). **Se corrigió el defecto de maquetación del panel a 375 px** (cabecera apilada, rejilla `minmax(0, 1fr)`, `overflow-x` interno y botón de cerrar accesible): en todas las vistas `document.documentElement.scrollWidth === 375`. La BD quedó como estaba (75 productos, `version: 38`) y la cuenta de prueba se borró. Sin commit ni push.

---

## Orden y dependencias

```
A (T1→T2→T3→T4→T5)  →  B (T6→T7→T8)  →  C (T9→T10)  →  D (T11→T12)  →  E (T13→T14→T15)  →  F (T16→T17→T18)
```

- **T4** depende de que el usuario cree la secret key y el `.env` (único punto del plan que depende de una acción externa).
- **T11** (que borra `ADMIN_SHA`) depende de **T4** (que compara la contraseña nueva con ese hash): por eso la Fase A va antes que la Fase D.
- **T13** depende de **T9** (lógica pura) y de **T2** (tabla y políticas).
- **T16** y **T17** dependen de **T7** (el catálogo está en la base de datos) y de **T9**.

## Coste total estimado

18 tareas × ~25 min ≈ **7 h 30 min** de trabajo efectivo, más la espera por la secret key (T4) y las revisiones manuales del navegador (T18).
