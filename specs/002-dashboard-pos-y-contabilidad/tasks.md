# Tareas 002 — Dashboard, POS & Contabilidad Ligera

Plan: `specs/002-dashboard-pos-y-contabilidad/002-plan.md` · Spec: `specs/002-dashboard-pos-y-contabilidad/002-spec.md`.

**8 tareas** en orden de dependencia. T1 deja el servidor listo y protegido; T2 pone la lógica pura con sus pruebas; T3 abre las cinco pestañas; T4–T7 las rellenan (POS, gastos, métricas y ajustes); T8 cierra la verificación.

Regla de avance (constitución, principio 4, leído con la puerta real del `AGENTS.md`): **ninguna tarea se cierra con `npm test` o `npm run build` en rojo**. No se hace commit ni push sin que se pida.

**Renumeración respecto al roadmap anterior**: el antiguo T7 («Pruebas y Verificación») pasa a **T8**, y el nuevo **T7** es la pestaña *Ajustes*. Motivo: la tasa configurable es una entrega con su propia interfaz, su propia validación y su propia verificación (recalculo de `price_usd`/`old_price_usd`), y mezclarla con el Dashboard habría dejado una tarea de más de una hora con dos criterios de aceptación distintos.

---

- [x] **T1. Escribir y aplicar la migración de esquema, RLS, ajustes y `register_sale`.** RF-02, RF-03, RF-06, RF-07, RF-08, RF-09
  - **Objetivo**: dejar el servidor con todo lo que necesita la contabilidad, protegido y en una sola migración idempotente.
  - **Ficheros**: `supabase/migrations/002_dashboard_pos_schema.sql` (nuevo).
  - **Contenido**: `alter table products add column if not exists cost_price numeric(12,2) not null default 0 check (cost_price >= 0)`; tablas `sales` (con `rate_used numeric(12,2) not null check (> 0)`), `expenses` y `settings` (una fila, `exchange_rate` inicial 820); índices por `created_at`; `enable row level security`; políticas de `public.sales` (solo lectura admin, sin escritura directa), `public.expenses` (CRUD admin) y `public.settings` (lectura `true`, update solo admin); grants/revokes de §4.5; disparadores `settings_audit_trg` y `settings_rate_trg`; función `register_sale` de §4.6 con `revoke`/`grant execute`; `notify pgrst, 'reload schema';`.
  - **Hecho cuando**: el fichero existe, se puede aplicar dos veces sin error, `get_advisors` no reporta avisos críticos, `pg_policies` lista las políticas de las tres tablas y una llamada de prueba a `register_sale` dentro de `begin … rollback` crea la venta, descuenta `stock` y deja la base de datos como estaba al hacer `rollback`.

- [ ] **T2. Extender `catalog-core.js` con la tasa como parámetro y la lógica contable pura.** RF-03, RF-05, RF-07, RF-08, RNF-04
  - **Objetivo**: que toda la aritmética viva en funciones puras y testeables, sin DOM, red, almacenamiento ni reloj.
  - **Ficheros**: `catalog-core.js`, `test/catalog-core.test.js`.
  - **Contenido**: `DEFAULT_RATE = 820` (con `PRICE_RATE` como alias de compatibilidad); `cupToUsd(cup, rate)`, `usdToCup(usd, rate)` y `mapProductToRow(product, rate)` con la tasa inyectada y `null` cuando la tasa no es un número positivo; `validateExchangeRate`, `dateKey`, `saleTotals`, `salesSummary`, `paymentBreakdown`, `originBreakdown`, `expensesSummary`, `netBalance` y `formatRate` (§7 del plan).
  - **Hecho cuando**: `npm test` está en verde con pruebas nuevas de conversión a dos tasas distintas, tasa inválida, totales y margen de una venta, desgloses por método y origen, resúmenes con `todayKey`/`monthKey` inyectados y balance neto; y `grep -n "document\.\|localStorage\|fetch(\|Date\.now" catalog-core.js` no devuelve nada.
  - **Nota**: las aserciones actuales que fijan `400` deben alinearse con `820` (duda D-8 del plan). Sin ese ajuste la tarea no se puede cerrar.

- [x] **T3. Maquetar las cinco pestañas del panel.** RF-01, RF-04, RF-05, RF-07, RNF-02
  - **Objetivo**: tener la navegación y los contenedores de *Productos*, *POS*, *Gastos*, *Dashboard* y *Ajustes* sin lógica de negocio todavía.
  - **Ficheros**: `index.html`.
  - **Contenido**: barra de pestañas accesible (botones con estado `aria-selected`), un panel por pestaña, la pestaña *Productos* con el comportamiento actual intacto, y maquetación a 375 px sin desbordamiento horizontal.
  - **Hecho cuando**: las cinco pestañas se abren y se cierran sin errores de consola, *Productos* sigue funcionando igual que antes del cambio, y en las cinco vistas `document.documentElement.scrollWidth === 375` con ventana de 375 px.

- [x] **T4. Implementar la vista POS con la RPC `register_sale`.** RF-01, RF-02, RF-06, RF-08, RF-09
  - **Objetivo**: cobrar una venta física sin que el cliente escriba stock ni importes.
  - **Ficheros**: `index.html` (y `catalog-core.js` solo si falta alguna función pura de T2).
  - **Contenido**: buscador por nombre o id, carrito local con cantidad ± y quitar, totales de previsualización con `saleTotals(items, rate)` y la tasa vigente, selector *Efectivo / Digital*, cobro con `rpc('register_sale', { p_items, p_payment_method, p_origin: 'FISICO' })`, ticket con el `id` devuelto y vaciado del carrito solo tras el éxito. En fallo: mensaje del servidor, carrito intacto y aviso de que no se ha cobrado.
  - **Hecho cuando**: una venta de prueba descuenta `stock` en la base de datos (`select stock from products where id = …`), `select total_cup, total_usd, total_profit, rate_used from sales order by created_at desc limit 1` coincide con `round(total_cup / rate_used, 2)`, un producto con `stock` nulo no se descuenta, y pedir más unidades que las disponibles devuelve error sin crear fila en `sales`.

- [x] **T5. Implementar la pestaña de Gastos Operativos.** RF-04
  - **Objetivo**: registrar y consultar gastos contra `public.expenses`.
  - **Ficheros**: `index.html`.
  - **Contenido**: formulario (concepto, categoría, importe en CUP), validación de importe no negativo, listado del mes con total, borrado con confirmación.
  - **Hecho cuando**: un alta aparece en `select * from expenses order by created_at desc limit 1` y en el listado; un importe negativo o vacío se rechaza sin escribir; y un `select` con la clave publishable sobre `expenses` devuelve 0 filas.

- [x] **T6. Implementar el Dashboard de métricas.** RF-05
  - **Objetivo**: mostrar el consolidado del negocio sin cálculos en la interfaz.
  - **Ficheros**: `index.html`.
  - **Contenido**: tarjetas de ventas de hoy y del mes, desglose efectivo vs digital, desglose online vs físico, ganancia neta (ventas − coste − gastos) y últimas ventas; todos los números salen de `salesSummary`, `paymentBreakdown`, `originBreakdown`, `expensesSummary` y `netBalance`, con `todayKey`/`monthKey` calculados una vez al abrir la pestaña.
  - **Hecho cuando**: con una venta y un gasto de prueba, las tarjetas muestran exactamente los importes que devuelven las funciones puras (comprobado con `node -e` sobre los mismos datos) y el neto es `total_profit − gastos`; la vista no desborda a 375 px.

- [x] **T7. Implementar la pestaña Ajustes (tasa CUP/USD configurable).** RF-07, RF-08
  - **Objetivo**: cambiar la tasa desde el panel, sin tocar código, sabiendo qué se recalcula.
  - **Ficheros**: `index.html`.
  - **Contenido**: lectura de `select exchange_rate from settings where id = 1`, campo de tasa nueva validado con `validateExchangeRate`, aviso explícito de que al guardar se recalculan `price_usd` y `old_price_usd` de todo el catálogo y confirmación con la tasa guardada; la tasa en memoria se refresca tras guardar y es la que usan la tienda y el POS.
  - **Hecho cuando**: guardar `900` desde *Ajustes* deja `select exchange_rate from settings` en `900`; `select price_usd from products where id = 1` es igual a `round(price_cup / 900, 2)`; una tasa `0` o `-5` se rechaza con aviso y no cambia la fila; una cuenta sin rol `admin` recibe error al intentar el `update`; y las ventas anteriores conservan su `total_usd` y su `rate_used`.

- [x] **T8. Verificación final, pruebas y actualización de la memoria.** RNF-01, RNF-02, RNF-03, RNF-04
  - **Objetivo**: cerrar la spec con la puerta completa en verde y la documentación al día.
  - **Ficheros**: `test/catalog-core.test.js`, `MEMORY.md`.
  - **Contenido**: recorrer el §11 de los criterios de aceptación del plan uno por uno; prueba negativa con una cuenta autenticada sin rol `admin` (creada fuera del repositorio y borrada al terminar); revisión manual de las cinco pestañas a 375 px; actualizar `MEMORY.md` (estado, decisión de la tasa configurable, `cost_price`, `rate_used`, `register_sale`).
  - **Hecho cuando**: `npm test` y `npm run build` en verde; `get_advisors` sin avisos críticos; la cuenta de prueba ya no existe; las cinco pestañas son usables a 375 px; `MEMORY.md` refleja la tasa vigente real (no 400) y las tablas nuevas; y no hay ningún commit ni push hecho.

---

## Orden y dependencias

```
T1 ──► T2 ──► T3 ──┬──► T4 ──┐
                   ├──► T5 ──┤
                   ├──► T6 ──┼──► T8
                   └──► T7 ──┘
```

- **T2** no depende de T1 (es lógica pura), pero va después para que la migración y el core se revisen en el mismo bloque.
- **T3** depende de T1 y T2: necesita las pestañas antes de rellenarlas y las funciones puras para no duplicar cálculos.
- **T4** depende de T1 (RPC y `rate_used`) y de T3.
- **T7** depende de T1 (tabla `settings` y disparador) y de T2 (`validateExchangeRate`, conversión con tasa).
- **T8** no se cierra hasta que T4, T5, T6 y T7 estén verificadas.

## Coste total estimado

8 tareas × ~30 min ≈ **4 h** de trabajo efectivo, más la revisión manual de las cinco pestañas a 375 px en T8.
