Plan 003 — Estética y Diseño Visual del Panel Admin (VentasCel)
Estado: borrador (pendiente de aprobación de la spec)

Referencia visual: `specs/WhatsApp Image 2026-10-22 at 1.45.28 AM.jpeg`.

Restricciones recordatorio (no negociables):
- **NO Chart.js / D3 / librerías de gráficos** → SVG/CSS puro (decisión tomada; alternativa descartada: `<canvas>` básico con librerías externas, que violaría constitución).
- **NO modificar `catalog-core.js`** → reutilización sin cambios.
- **NO SQL ni tablas nuevas** → solo lectura de `public.sales`, `public.products`, `public.settings`.
- **NO tocar `MEMORY.md` ni `docs/constitution.md`** → actualización solo si se pide explícitamente.
- Verificación final: `npm test` (112/0) + `npm run build` (0) + inspe visual en 375 px.

---

## 1. Estructura de archivos y responsabilidad

| Archivo | Rol | Qué hace en esta spec |
|---|---|---|
| `index.html` | Interfaz visual única | Se actualiza el bloque `.admin-panel` (CSS variables, layout, SVG de gráficos, sidebar activa, cards, tabla, lista, footer). No se modifica la tienda pública. |
| `specs/003-estetica-visual/003-plan.md` | Plan | Este archivo. |
| `specs/003-estetica-visual/tasks.md` | Tareas ordenadas | Listado con RF cubierto y criterio "Hecho cuando". |
| `dashboard-stats.js` (opcional) | Lógica pura auxiliar | Si se requiere cálculo de métricas (ventas hoy/mes, top productos) sin tocar `catalog-core.js`. Recibe datos como parámetro (ej. `calculateSalesOverview(sales)`) y devuelve valores numéricos. No accede al DOM ni a red. Si no es necesario porque los datos ya vienen calculados desde Supabase o desde funciones existentes, este archivo no se crea. |
| `catalog-core.js` | Lógica pura base | **No se toca**. Se reutiliza si ya tiene funciones de cálculo; de lo contrario, los cálculos nuevos se hacen en `dashboard-stats.js` o directamente en el callback de carga. |

Nota: `dashboard-stats.js` es opcional; si la carga del dashboard ya obtiene los datos agregados desde el backend o desde funciones puras existentes, no se crea ningún archivo nuevo y todo se mantiene en `index.html`. Esto respeta la regla de simplicidad (principio 1 de la constitución).

---

## 2. Lógica de negocio separada de interfaz

- **Interfaz (`index.html`)**: define los elementos visuales (`.admin-sidebar`, `.summary-cards`, `.sales-chart-svg`, `.order-status-ring`, `.recent-orders-table`, `.top-products-list`, `.admin-footer`). Maneja eventos de `switchAdminTab()` (ya existente) y refresca los datos cuando la pestaña Dashboard se activa (`name === 'dashboard'`).
- **Datos / Dependencias externas inyectadas**: la carga de datos del dashboard recibe como parámetro los resultados de la consulta a `public.sales` / `public.products` / `public.settings` (o la copia local si la red falla). Esto se hace dentro de la función existente que refresca la pestaña, sin modificar la lógica pura de `catalog-core.js`.
- **Cálculos puros (si se requieren)**: si se necesita calcular "Ventas Mes", "Top 5 Productos", o "Proporción por Estado", se crea `dashboard-stats.js` con funciones deterministas que reciben arrays de datos y devuelven objetos/arrays. Ejemplo: `getTopProducts(products, sales)`, `getSalesByDay(sales)`. Estas funciones se testean con `node --test` si se crean; si no, no hay tests nuevos para esta spec.

---

## 3. Decisiones con alternativa descartada

| Decisión tomada | Alternativa descartada | Porqué descartada |
|---|---|---|
| Gráficos con SVG puro (`<line>`, `<circle>`, `<text>`) en `index.html` | Usar `Chart.js` o `D3` por CDN | Violación de constitución (principio 1: sin dependencias nuevas; principio 3: simplicidad). Además, los gráficos del mockup son simples (líneas y anillo) y SVG puro cubre perfectamente la necesidad sin peso adicional. |
| Cards con datos dinámicos inyectados al cargar la pestaña | Cards estáticas con valores de ejemplo | El usuario pidió explícitamente datos dinámicos (RF-02). Además, el mockup muestra datos que corresponden al contexto del negocio. |
| Sidebar fija o colapsable en 375 px (CSS `flex-wrap` o transformación simple) | Sidebar oculta por defecto con menú hamburguesa complejo | El mockup muestra la sidebar visible; ocultarla por completo rompería la referencia visual. Se opta por reducir el ancho y el padding, no por eliminar. |
| Variables CSS nuevas dentro del bloque `<style>` existente | Archivo CSS externo nuevo (`admin-dark.css`) | Principio 1: evitar archivos de infraestructura sin relación directa con la spec. Un archivo CSS externo no aporta valor y aumenta la complejidad. |
| No modificar `catalog-core.js`; cálculos nuevos en `dashboard-stats.js` opcional | Modificar `catalog-core.js` para añadir funciones de estadísticas | Restricción explícita del contexto (no modificar la lógica pura existente de Spec 002). Además, `catalog-core.js` está cubierto por tests (112/0) y cualquier cambio podría romperlos. |

---

## 4. Estrategia de tests y verificación

- **Test automatizado (`npm test`)**: debe pasar con 112/0 sin cambios. Si se crea `dashboard-stats.js`, se añade un archivo de test `test/dashboard-stats.test.js` que comprueba las funciones puras con datos de ejemplo; el comando sigue siendo `npm test`. Si no se crea, no hay tests nuevos.
- **Test de construcción (`npm run build`)**: debe seguir verde (código 0). El archivo `products.json` no se modifica; `products.js` se regenera sin cambios en su contenido lógico.
- **Verificación visual**: 
  1. `npm run serve` → abrir `http://localhost:8080`.
  2. Acceder al panel admin, pestaña Dashboard.
  3. Comprobar que los gráficos SVG se renderizan con datos (o mensaje vacío si no hay datos).
  4. Comprobar cards con valores reales.
  5. Comprobar sidebar con enlace activo resaltado.
  6. Redimensionar ventana a 375 px y verificar que no hay `overflow-x`.
- **Comprobación SQL**: no aplica (no hay cambios en base de datos). Solo se confirma que `public.sales` y `public.products` siguen intactos (`pg_tables` / `get_advisors` sin avisos críticos).

---

## 5. Qué RF cubre cada parte

| Parte / Archivo | RF cubierto | Nota |
|---|---|---|
| Variables CSS (`:root`) y `.admin-panel` | RF-01 | Tema oscuro y paleta de acento. |
| `.summary-cards` + carga dinámica | RF-02 | Datos de `public.sales` / `public.settings`. |
| `.admin-sidebar` + `.tab-btn[aria-selected="true"]` | RF-03 | Navegación activa resaltada. |
| `.sales-chart-svg` (SVG líneas) | RF-04 | Datos de hoy/mes desde `public.sales`. |
| `.order-status-ring` (SVG anillo) | RF-05 | Proporción de estados/pedidos. |
| `.recent-orders-table` | RF-06 | Datos dinámicos de pedidos recientes. |
| `.top-products-list` | RF-07 | Lista basada en volumen de ventas. |
| `.admin-footer` | RF-08 | Info/copyright en español. |
| `@media` o `min-width: 375px` + `overflow-x` | RF-09 | Responsivo sin desbordamiento. |
| `dashboard-stats.js` (opcional) | RF-02, RF-04, RF-05, RF-06, RF-07 | Funciones puras que reciben datos y devuelven métricas. |

---

## 6. Orden de ejecución recomendado

1. Revisar `spec.md` y confirmar que está aprobado (Estado cambia a "aprobado").
2. Crear `tasks.md` (ya existe en esta entrega; se actualiza si hay cambios en la spec).
3. T1: Actualizar CSS en `index.html` (variables, `.admin-panel`, `.admin-sidebar`, `.summary-cards`).
4. T2: Ajustar cards en Dashboard con datos dinámicos (modificar el callback que refresca `tab-dashboard`).
5. T3: Implementar SVG de gráficos (`sales-chart-svg`, `order-status-ring`) con datos reales.
6. T4: Implementar sidebar activa y navegación resaltada (`.admin-sidebar`, `.tab-btn`).
7. T5: Implementar tabla dinámica (`.recent-orders-table`) y lista top productos (`.top-products-list`).
8. T6: Añadir footer (`.admin-footer`) y verificar diseño en 375 px.
9. T7: Si es necesario, crear `dashboard-stats.js` con funciones puras y sus tests (`test/dashboard-stats.test.js`).
10. T8: Verificación final (`npm test`, `npm run build`, inspección visual en `localhost:8080` con 375 px).
11. T9: Actualizar memoria del proyecto (`MEMORY.md`) solo si se solicita explícitamente (fuera de esta spec, según restricciones).
