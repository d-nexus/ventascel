# Plan 002 — Dashboard, POS & Contabilidad Ligera (VentasCel)

## 1. Resumen Ejecutivo
- **Objetivo**: Expandir el panel de administración existente en `index.html` mediante la integración de **5 pestañas** (*Productos*, *POS / Ventas Físicas*, *Gastos*, *Dashboard / Métricas* y *Ajustes*), convirtiendo el sistema en la herramienta central de gestión contable y comercial para el dueño del negocio.
- **Tecnologías**: Supabase Auth/PostgreSQL (`public.sales`, `public.expenses`, `public.settings`, actualizaciones en `public.products`, función `public.register_sale`), JavaScript vanilla puro en frontend estático sin bundlers.
- **Entrega**: una migración nueva, lógica pura y testeable en `catalog-core.js`, y las cinco pestañas en `index.html`. Nada de dependencias npm nuevas ni ficheros de infraestructura adicionales.

---

## 2. Requisitos Funcionales (RF)

| ID | Nombre | Descripción |
| :--- | :--- | :--- |
| **RF-01** | **Módulo POS (Punto de Venta Local)** | Interfaz rápida para registrar ventas en mostrador/tienda física seleccionando productos, cantidades y método de pago (*Efectivo* vs. *Digital / Transferencia*). |
| **RF-02** | **Sincronización de Stock Unificada** | Descuento automático e inmediato de la columna `stock` de `public.products`, solo cuando su valor no es nulo (`null` = sin control de existencias) y dentro de la misma transacción que registra la venta (RF-09). |
| **RF-03** | **Margen de Ganancia** | Incorporación de la columna `cost_price` (precio de costo en CUP) en la tabla de productos para calcular automáticamente el margen de ganancia por producto y transacción. |
| **RF-04** | **Registro de Gastos Operativos** | Módulo para registrar gastos de operación (alquiler, transporte, servicios, insumos) almacenados en la tabla `public.expenses`. |
| **RF-05** | **Consolidado y Métricas** | Dashboard con métricas clave en tiempo real: Ventas Totales (Hoy / Mes), Desglose por Método de Pago (Efectivo vs. Digital), Desglose por Origen (Online vs. Físico) y Ganancia Neta (`Ventas Totales - Costo de Productos - Gastos Operativos`). |
| **RF-06** | **Seguridad y Roles Estrictos** | Acceso restringido exclusivamente para usuarios autenticados con rol `admin` validado en `app_metadata`; la comprobación la aplican el servidor, las políticas RLS y la función `register_sale`, nunca el cliente. |
| **RF-07** | **Tasa de cambio CUP/USD configurable** | La tasa vive en una tabla de ajustes de una sola fila (`exchange_rate numeric(12,2) not null check (> 0)`, valor inicial `820`), legible por `anon` y modificable solo por `admin` (RLS con `(select auth.jwt()) -> 'app_metadata' ->> 'role' = 'admin'`). Al guardar una tasa nueva se recalculan y escriben `products.price_usd` y `products.old_price_usd` de todo el catálogo en la misma transacción. `catalog-core.js` recibe la tasa como parámetro, con `820` por defecto. Se edita en la pestaña *Ajustes*, sin tocar código. |
| **RF-08** | **Tasa por venta e histórico inmutable** | Cada venta guarda la tasa con la que se registró (`sales.rate_used`); el importe en USD del histórico no cambia cuando cambia la tasa y las ventas pasadas no se recalculan. |
| **RF-09** | **Atomicidad de la venta** | La venta y el descuento de stock se registran en una sola transacción mediante `public.register_sale(p_items jsonb, p_payment_method text, p_origin text default 'FISICO') returns uuid`, `security definer` con comprobación explícita de rol `admin` dentro de la función: recibe solo `[{"product_id": <id>, "qty": <n>}]`, recalcula precios, costos y totales leyendo `products` con bloqueo de fila, guarda el snapshot enriquecido en `items`, descuenta `stock` solo cuando no es `null`, aborta sin escribir nada si no alcanza, y calcula `total_usd = round(total_cup / rate_used, 2)`. |

---

## 3. Requisitos No Funcionales (RNF)

- **RNF-01 (Arquitectura Estática)**: Mantener la arquitectura ligera sin frameworks ni bundlers extras (JavaScript nativo + CDN ESM de Supabase JS).
- **RNF-02 (Diseño Responsivo)**: Maquetación adaptada a pantallas móviles (375 px) para permitir el uso directo del POS y la consulta de métricas desde un teléfono en el mostrador.
- **RNF-03 (Resiliencia ante Fallos)**: Manejo adecuado de errores de red, notificaciones claras al usuario y conservación de borradores de venta si la conexión falla.
- **RNF-04 (Lógica pura separada del transporte)**: Los cálculos de márgenes, totales y desglose de caja viven en `catalog-core.js` como funciones puras y deterministas, sin DOM ni red y con la fecha inyectada como parámetro. La función SQL solo persiste y garantiza la atomicidad: no duplica reglas de negocio.

---

## 4. Esquema de Base de Datos (Supabase)

Migración nueva e idempotente: `supabase/migrations/002_dashboard_pos_schema.sql`.

### 4.1. Modificación a `public.products`

`stock` **ya existe** en `001_initial_schema.sql` (`integer`, admite `null` = sin control de existencias): no se crea ni se renombra ninguna `stock_actual`.

```sql
alter table public.products
  add column if not exists cost_price numeric(12,2) not null default 0.00
  check (cost_price >= 0);
```

### 4.2. Nueva Tabla `public.sales`

```sql
create table if not exists public.sales (
    id             uuid primary key default gen_random_uuid(),
    created_at     timestamptz not null default now(),
    origin         varchar(20) not null default 'FISICO' check (origin in ('ONLINE','FISICO')),
    payment_method varchar(20) not null check (payment_method in ('EFECTIVO','DIGITAL')),
    items          jsonb       not null check (jsonb_typeof(items) = 'array'),
    total_cup      numeric(12,2) not null check (total_cup >= 0),
    total_usd      numeric(12,2) not null check (total_usd >= 0),
    total_profit   numeric(12,2) not null,
    rate_used      numeric(12,2) not null check (rate_used > 0)
);
create index if not exists sales_created_at_idx on public.sales (created_at desc);
```

`items` guarda el snapshot enriquecido por la función: `[{product_id, title, qty, unit_price, cost_price}]`. `rate_used` congela la tasa de esa venta (RF-08).

### 4.3. Nueva Tabla `public.expenses`

```sql
create table if not exists public.expenses (
    id         uuid primary key default gen_random_uuid(),
    created_at timestamptz not null default now(),
    concept    text          not null,
    category   varchar(50)   not null default 'General',
    amount_cup numeric(12,2) not null check (amount_cup >= 0)
);
create index if not exists expenses_created_at_idx on public.expenses (created_at desc);
```

### 4.4. Nueva Tabla `public.settings` (ajustes de una sola fila)

Mismo patrón que `public.catalog_state`: una fila con `id = 1`.

```sql
create table if not exists public.settings (
    id            smallint primary key default 1 check (id = 1),
    exchange_rate numeric(12,2) not null default 820 check (exchange_rate > 0),
    updated_at    timestamptz not null default now(),
    updated_by    uuid references auth.users(id) on delete set null
);
insert into public.settings (id, exchange_rate) values (1, 820)
on conflict (id) do nothing;
```

### 4.5. RLS y grants

```sql
alter table public.sales    enable row level security;
alter table public.expenses enable row level security;
alter table public.settings enable row level security;

-- sales: solo el admin lee; nadie escribe directamente (solo register_sale).
drop policy if exists sales_admin_read on public.sales;
create policy sales_admin_read on public.sales
  for select to authenticated
  using ((select auth.jwt()) -> 'app_metadata' ->> 'role' = 'admin');
revoke select on public.sales from anon;
revoke insert, update, delete on public.sales from anon, authenticated;

-- expenses: el admin lee y gestiona; el público no ve nada.
drop policy if exists expenses_admin_read on public.expenses;
create policy expenses_admin_read on public.expenses
  for select to authenticated
  using ((select auth.jwt()) -> 'app_metadata' ->> 'role' = 'admin');
drop policy if exists expenses_admin_insert on public.expenses;
create policy expenses_admin_insert on public.expenses
  for insert to authenticated
  with check ((select auth.jwt()) -> 'app_metadata' ->> 'role' = 'admin');
drop policy if exists expenses_admin_update on public.expenses;
create policy expenses_admin_update on public.expenses
  for update to authenticated
  using ((select auth.jwt()) -> 'app_metadata' ->> 'role' = 'admin')
  with check ((select auth.jwt()) -> 'app_metadata' ->> 'role' = 'admin');
drop policy if exists expenses_admin_delete on public.expenses;
create policy expenses_admin_delete on public.expenses
  for delete to authenticated
  using ((select auth.jwt()) -> 'app_metadata' ->> 'role' = 'admin');
revoke select, insert, update, delete on public.expenses from anon;

-- settings: lectura pública (la tienda necesita la tasa), escritura solo admin.
drop policy if exists settings_public_read on public.settings;
create policy settings_public_read on public.settings
  for select using (true);
drop policy if exists settings_admin_update on public.settings;
create policy settings_admin_update on public.settings
  for update to authenticated
  using ((select auth.jwt()) -> 'app_metadata' ->> 'role' = 'admin')
  with check ((select auth.jwt()) -> 'app_metadata' ->> 'role' = 'admin');
revoke insert, update, delete on public.settings from anon;
revoke insert, delete on public.settings from authenticated;

-- Funciones: solo el admin autenticado puede ejecutar la RPC de venta.
revoke execute on function public.register_sale(jsonb, text, text) from public, anon;
grant execute on function public.register_sale(jsonb, text, text) to authenticated;
revoke execute on function public.settings_set_audit() from public, anon, authenticated;
revoke execute on function public.settings_apply_exchange_rate() from public, anon, authenticated;
```

Se repiten las políticas con `drop policy if exists` antes de `create policy` para que la migración se pueda aplicar dos veces sin error.

### 4.6. Función `public.register_sale`

`security definer` (escribe `sales` y `products` aunque el rol no tenga INSERT/UPDATE directo), `set search_path = public`, con **comprobación explícita de rol** y sin SQL dinámico.

```sql
create or replace function public.register_sale(
  p_items jsonb,
  p_payment_method text,
  p_origin text default 'FISICO'
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role       text := (select auth.jwt()) -> 'app_metadata' ->> 'role';
  v_rate       numeric(12,2);
  v_sale_id    uuid := gen_random_uuid();
  v_total_cup  numeric(12,2) := 0;
  v_profit     numeric(12,2) := 0;
  v_items      jsonb := '[]'::jsonb;
  v_item       jsonb;
  v_product    public.products%rowtype;
  v_qty        integer;
begin
  if v_role is distinct from 'admin' then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if p_payment_method not in ('EFECTIVO','DIGITAL') then
    raise exception 'Método de pago no válido' using errcode = '22023';
  end if;
  if p_origin not in ('ONLINE','FISICO') then
    raise exception 'Origen no válido' using errcode = '22023';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La venta no tiene líneas' using errcode = '22023';
  end if;

  select exchange_rate into v_rate from public.settings where id = 1;
  if v_rate is null then
    raise exception 'Falta la tasa de cambio' using errcode = '22023';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item ->> 'qty')::integer;
    if v_qty is null or v_qty <= 0 then
      raise exception 'Cantidad no válida' using errcode = '22023';
    end if;

    select * into v_product
      from public.products
     where id = (v_item ->> 'product_id')::bigint
       for update;                      -- bloqueo de fila: nadie más descuenta a la vez
    if not found then
      raise exception 'Producto % no existe', v_item ->> 'product_id' using errcode = '22023';
    end if;

    if v_product.stock is not null then
      if v_product.stock < v_qty then
        raise exception 'Stock insuficiente para %', v_product.name using errcode = '22023';
      end if;
      update public.products
         set stock = stock - v_qty
       where id = v_product.id;
    end if;

    v_total_cup := v_total_cup + (v_qty * v_product.price_cup);
    v_profit    := v_profit    + (v_qty * (v_product.price_cup - v_product.cost_price));
    v_items := v_items || jsonb_build_object(
      'product_id', v_product.id,
      'title',      v_product.name,
      'qty',        v_qty,
      'unit_price', v_product.price_cup,
      'cost_price', v_product.cost_price
    );
  end loop;

  insert into public.sales (id, origin, payment_method, items,
                            total_cup, total_usd, total_profit, rate_used)
  values (v_sale_id, p_origin, p_payment_method, v_items, v_total_cup,
          round(v_total_cup / v_rate, 2), v_profit, v_rate);

  return v_sale_id;
end $$;
```

Cualquier `raise exception` aborta la transacción completa: no queda venta sin descuento ni descuento sin venta (RF-02, RF-09).

### 4.7. Recálculo de precios al guardar la tasa

Dos disparadores sobre `public.settings`, ambos dentro de la misma transacción que el `update` que hace el panel:

```sql
create or replace function public.settings_set_audit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

create or replace function public.settings_apply_exchange_rate()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.exchange_rate is distinct from old.exchange_rate then
    update public.products
       set price_usd = round(price_cup / new.exchange_rate, 2),
           old_price_usd = case
             when old_price_cup is null then null
             else round(old_price_cup / new.exchange_rate, 2)
           end;
  end if;
  return null;
end $$;

drop trigger if exists settings_audit_trg on public.settings;
create trigger settings_audit_trg
  before insert or update on public.settings
  for each row execute function public.settings_set_audit();

drop trigger if exists settings_rate_trg on public.settings;
create trigger settings_rate_trg
  after update of exchange_rate on public.settings
  for each row execute function public.settings_apply_exchange_rate();
```

**Consecuencia conocida**: `products_version_trg` (001) avanza `catalog_state.version` una vez por fila modificada, así que un cambio de tasa sube la versión del catálogo en tantas unidades como productos haya. Es coherente con su regla («solo avanza si el contenido cambia de verdad»: los precios en USD han cambiado), pero conviene saberlo antes de mirar el contador (duda D-8 del §12).

---

## 5. Roadmap de Tareas de Ejecución

```
                                  ┌──► [T4: Vista POS] ──────────────┐
                                  │                                  │
[T1] ──► [T2] ──► [T3: 5 pestañas]├──► [T5: Gastos] ────────────────┼──► [T8: Verificación]
                                  │                                  │
                                  ├──► [T6: Dashboard de métricas] ──┤
                                  │                                  │
                                  └──► [T7: Pestaña Ajustes] ────────┘

T1 Esquema + RLS + register_sale ──► T2 Lógica pura en catalog-core.js
T3 Maquetación de las 5 pestañas (depende de T1 y T2)
T4..T7 dependen de T3; T8 cierra cuando T4..T7 están verificadas
```

| Tarea | Título | Descripción / Entregables |
| :--- | :--- | :--- |
| **T1** | **Diseño de Esquema SQL, RLS y función de venta** | Migración `002_dashboard_pos_schema.sql`: tablas `sales` (con `rate_used`), `expenses` y `settings` (una fila, `exchange_rate` inicial 820), columna `cost_price` en `products`, políticas RLS + grants, disparadores de auditoría/recálculo y función `register_sale`. |
| **T2** | **Lógica Contable en Core** | Extender `catalog-core.js` con la tasa como parámetro (`cupToUsd`/`usdToCup` y `mapProductToRow`), validación de la tasa y funciones puras de totales, márgenes, desglose de caja por método de pago, origen y balance neto. |
| **T3** | **Maquetación Pestañas Admin** | Actualizar la interfaz del panel en `index.html` creando las pestañas *Productos*, *POS*, *Gastos*, *Dashboard / Métricas* y *Ajustes*. |
| **T4** | **Implementación Vista POS** | Punto de Venta Local con buscador de productos por nombre/id, carrito local, selector de tipo de pago y cobro mediante la RPC `register_sale` (sin escribir stock desde el cliente). |
| **T5** | **Implementación Gastos Operativos** | Vista de gestión de gastos con formulario de alta, categorías y listado histórico contra `public.expenses`. |
| **T6** | **Implementación Dashboard de Métricas** | Tarjetas de métricas financieras (ventas del día/mes, arqueo efectivo vs digital, margen neto global y transacciones recientes). |
| **T7** | **Pestaña Ajustes (tasa CUP/USD)** | Lectura y edición de `settings.exchange_rate` por el admin, con validación, aviso de que se recalculan los precios en USD y refresco de la tasa en memoria tras guardar. |
| **T8** | **Pruebas y Verificación** | Pruebas unitarias en `test/catalog-core.test.js`, `npm test` y `npm run build` en verde, `get_advisors` sin avisos críticos y verificación de RLS, de `register_sale` y de la vista a 375 px. |

El detalle de cada tarea (ficheros, RF y criterio de verificación) está en `tasks.md`.

---

## 6. Ficheros y responsabilidades

| Fichero | Estado | Responsabilidad |
| :--- | :--- | :--- |
| `supabase/migrations/002_dashboard_pos_schema.sql` | nuevo | DDL idempotente: `cost_price`, `sales`, `expenses`, `settings`, políticas RLS, grants, disparadores y `register_sale`. Nada de datos de negocio. |
| `catalog-core.js` | modificado | Lógica **pura**: conversión CUP/USD con tasa inyectada, validación de la tasa, totales y márgenes de una venta, resúmenes de ventas/gastos, desgloses y balance neto. Sin DOM, sin red, sin almacenamiento y sin reloj (la fecha entra como parámetro). |
| `test/catalog-core.test.js` | modificado | Pruebas `node:test` de las funciones anteriores, incluidos los casos límite CL-01…CL-06. |
| `index.html` | modificado | Interfaz de las 5 pestañas, estado de la venta en curso, llamadas a Supabase (`rpc('register_sale')`, lecturas de `sales`/`expenses`/`settings`) y pintado de métricas. Sin lógica de cálculo propia: todo pasa por `VentasCelCore`. |
| `specs/002-dashboard-pos-y-contabilidad/{002-spec.md,002-plan.md,tasks.md}` | modificado / nuevo | Documentación de la entrega. |

No se crean ficheros de infraestructura nuevos fuera de la migración (constitución, principio 1).

---

## 7. Lógica de negocio pura (`catalog-core.js`)

### 7.1. Conversión con la tasa como parámetro (RF-07)

```js
const DEFAULT_RATE = 820;              // valor por defecto; el vigente lo manda la BD
const PRICE_RATE = DEFAULT_RATE;       // alias de compatibilidad (no usar en código nuevo)

cupToUsd(cup, rate = DEFAULT_RATE)     // cup nulo/vacío → null; rate inválida → null
usdToCup(usd, rate = DEFAULT_RATE)     // idem
mapProductToRow(product, rate)         // price_usd y old_price_usd con la tasa recibida
```

Regla: una tasa que no sea un número finito mayor que 0 **no se sustituye en silencio**; la función devuelve `null` y es el borde (la pestaña o la tienda) quien decide el respaldo con `DEFAULT_RATE`. Así el core no esconde una configuración rota.

`PRICE_RATE` se conserva como alias para no romper las llamadas existentes de `index.html`; el código nuevo siempre pasa la tasa.

### 7.2. Funciones contables

- `validateExchangeRate(value)` → `{ ok, value, message }`: número finito, mayor que 0, con dos decimales como máximo.
- `dateKey(isoString)` → `'YYYY-MM-DD'` o `''`: corte puro de la cadena de `created_at`; sin `Date`, para no depender del reloj ni de la zona horaria.
- `saleTotals(items, rate)` → `{ totalCup, totalUsd, totalProfit }` a partir de las líneas (`unit_price`, `cost_price`, `qty`); es la previsualización del POS, no la fuente de verdad.
- `salesSummary(sales, { todayKey, monthKey })` → `{ countToday, countMonth, cupToday, cupMonth, usdToday, usdMonth, profitToday, profitMonth }`.
- `paymentBreakdown(sales)` → `{ cashCup, digitalCup, cashCount, digitalCount }`.
- `originBreakdown(sales)` → `{ onlineCup, physicalCup, onlineCount, physicalCount }`.
- `expensesSummary(expenses, { todayKey, monthKey })` → `{ cupToday, cupMonth, countToday, countMonth }`.
- `netBalance(sales, expenses, { todayKey, monthKey })` → `{ cupToday, cupMonth }` = `profit − gastos`.
- `formatRate(rate)` → `'820 CUP = 1 USD'`.

Pseudocódigo de `salesSummary`:

```
para cada venta v:
    k = dateKey(v.created_at)
    si k == todayKey: acumular hoy (cup, usd, profit, +1)
    si k empieza por monthKey: acumular mes
devolver los acumuladores redondeados a 2 decimales
```

La **fecha la inyecta la interfaz** (`todayKey`/`monthKey` calculados una vez al abrir la pestaña), en cumplimiento del principio 3 de la constitución.

### 7.3. Qué NO se calcula en el navegador

La venta que se persiste la calcula `register_sale` en el servidor (RF-09). `saleTotals` solo sirve para enseñar el importe antes de cobrar y para comprobar que el ticket coincide.

---

## 8. Interfaz (`index.html`)

- **Pestañas**: *Productos* (la actual), *POS*, *Gastos*, *Dashboard / Métricas* y *Ajustes*. La de *Ajustes* es propia, no vive dentro de *Productos* ni del *Dashboard*.
- **POS**: buscador por nombre o id, carrito local (cantidad ± y quitar), selector *Efectivo / Digital*, total en CUP con su equivalente USD con la tasa vigente, botón «Cobrar» → `supabase.rpc('register_sale', { p_items, p_payment_method, p_origin: 'FISICO' })`. Tras el cobro se muestra el identificador de la venta y se vacía el carrito; si la RPC falla, se muestra el mensaje del servidor y **no** se vacía ni se da la venta por hecha (RNF-03).
- **Gastos**: alta (concepto, categoría, importe en CUP), listado del mes y borrado con confirmación.
- **Dashboard**: tarjetas de hoy/mes, desglose efectivo vs digital, desglose online vs físico, margen neto y últimas ventas.
- **Ajustes**: tasa vigente, campo de tasa nueva, validación en cliente con `validateExchangeRate`, aviso explícito de que al guardar se recalculan los precios en USD de todo el catálogo y confirmación con la tasa guardada.
- Todo a 375 px sin desbordamiento horizontal (RNF-02).

---

## 9. Decisiones técnicas (con alternativa descartada)

- **D-1. Nombre de la tabla de ajustes: `public.settings`.**
  Alternativa descartada: reutilizar `public.catalog_state`. Mezclaría la versión del catálogo con la configuración y obligaría a tocar su disparador de versión. `app_settings` se descarta por longitud sin ventaja.
- **D-2. El recálculo de `price_usd`/`old_price_usd` se hace con un disparador `after update of exchange_rate` sobre `settings`.**
  Alternativa descartada A: una RPC `set_exchange_rate` que actualice ambas tablas. Obliga a que todo cambio de tasa pase por la función y a duplicar la validación, sin ganar nada. Alternativa descartada B: dos llamadas desde el panel (una a `settings` y otra a `products`). No es atómica: si falla la segunda, los precios en USD quedan desfasados de la tasa (CL-02).
- **D-3. `sales.rate_used numeric(12,2)` guarda la tasa de cada venta.**
  Alternativa descartada: tabla histórica de tasas con `valid_from`/`valid_to` y clave foránea desde `sales`. Es un histórico de tipos de cambio completo que nadie ha pedido; `rate_used` cumple RF-08 con una columna.
- **D-4. `register_sale` es `security definer` con comprobación explícita de rol.**
  Alternativa descartada: `security invoker` con políticas de INSERT en `sales` y UPDATE en `products`. Serían dos escrituras desde el cliente (no atómicas), con la lógica de descuento repartida en el navegador y RLS más permisiva de lo necesario.
- **D-5. La tasa entra en el core como parámetro, con `820` por defecto y `PRICE_RATE` como alias.**
  Alternativa descartada: eliminar la constante y obligar a pasar siempre la tasa. Rompería las llamadas actuales de `index.html` y las pruebas existentes sin ganancia funcional.
- **D-6. Todo sigue en `index.html` + `catalog-core.js`.**
  Alternativa descartada: crear `accounting-core.js`. Añade otro `<script>` y otro fichero de infraestructura sin relación con la spec (constitución, principio 1).
- **D-7. Los importes que viajan desde el navegador son solo ilustrativos.**
  El servidor recalcula con `products` bajo `for update`. Un carrito manipulado en la consola no puede rebajar el precio ni el coste de la venta (CL-06).

---

## 10. Estrategia de tests y verificación

Comandos del proyecto (`AGENTS.md`):

1. **`npm test`** (`node --test`, suite `test/catalog-core.test.js`): puerta principal para toda la lógica pura. Amplía la suite con conversión a varias tasas, tasa inválida, totales/márgenes, desgloses, resúmenes con fecha inyectada, balance neto y los casos límite CL-01…CL-06.
2. **`npm run build`**: valida `products.json` y regenera `products.js`; debe seguir en verde y sin tocar el maestro.
3. **`get_advisors`** (MCP de Supabase) tras aplicar la migración: sin avisos críticos.
4. **SQL puntual sobre el proyecto**: `pg_policies` para `sales`, `expenses` y `settings`; `information_schema.role_table_grants`; y una llamada de prueba a `register_sale` dentro de `begin … rollback` para comprobar venta + descuento + rechazo por stock insuficiente sin dejar datos.
5. **Prueba negativa de rol**: una cuenta de prueba sin `app_metadata.role` no puede leer `sales` ni ejecutar `register_sale` (403), y se borra al terminar (RNF-13 de 001).
6. **Revisión manual a 375 px** de las cinco pestañas.

Nota: el principio 4 de `docs/constitution.md` está desactualizado al afirmar que no hay framework de tests. La puerta real hoy es **`npm test` + `npm run build` + `get_advisors`**; la corrección de la constitución no forma parte de esta spec.

---

## 11. Criterios de Aceptación

1. `npm test` y `npm run build` terminan en verde y `get_advisors` no reporta avisos críticos.
2. Una venta física descuenta el `stock` de los productos que lo tienen informado, no toca los de `stock` nulo y, si no alcanza, no escribe ni la venta ni ningún descuento (RF-02, RF-09).
3. El cálculo de margen descuenta el coste unitario guardado en `cost_price` (RF-03).
4. El balance neto descuenta los gastos operativos registrados en `expenses` (RF-05).
5. La tasa CUP/USD se puede cambiar desde *Ajustes* sin tocar código, con valor inicial 820; al guardar se recalculan `price_usd` y `old_price_usd` de todos los productos en la misma transacción, y una tasa ≤ 0 se rechaza (RF-07, CL-01, CL-02).
6. Cambiar la tasa no altera el `total_usd` ni el `rate_used` de las ventas anteriores (RF-08, CL-03).
7. `anon` lee `settings` pero no puede escribirla; una cuenta autenticada sin rol `admin` no puede escribir `sales`, `expenses` ni `settings`, ni ejecutar `register_sale` (RF-06).
8. Un carrito manipulado desde la consola no altera los importes persistidos (CL-06).
9. La migración se aplica dos veces sin error (idempotencia).
10. La vista admin se mantiene 100 % utilizable y fluida en pantallas de 375 px de ancho (RNF-02).

---

## 12. Dudas abiertas

- **D-8.** `test/catalog-core.test.js` fija hoy `400` como tasa en varias aserciones (`core.PRICE_RATE === 400`, `cupToUsd(1500) === 3.75`) mientras `catalog-core.js` ya usa `820`. Con el valor por defecto en `820`, esas aserciones fallan: `npm test` está en rojo de partida. Este plan asume que **820 es la tasa vigente** y que T2 alinea esas aserciones. Pendiente de confirmación.
- **D-9.** El criterio de aceptación anterior decía «sin afectar productos inactivos o agotados». La spec no dice qué debe hacer el POS si el carrito incluye un producto retirado (`active = false`). Aquí solo se especifica el rechazo por stock insuficiente; falta decidir si un producto inactivo se rechaza o se vende.
- **D-10.** El recálculo de precios en USD al cambiar la tasa sube `catalog_state.version` una vez por producto. Se considera aceptable porque el contenido cambia de verdad, pero conviene confirmarlo antes de implementar T1.
