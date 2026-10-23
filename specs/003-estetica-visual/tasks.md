Tasks 003 — Estética y Diseño Visual del Panel Admin (VentasCel)
Estado: borrador
Referencia visual: `specs/WhatsApp Image 2026-10-22 at 1.45.28 AM.jpeg`
Restricciones: ver `003-spec.md` y `003-plan.md`.

---

T1 — Actualizar CSS variables y tema oscuro del panel admin
- RF cubierto: RF-01 (tema oscuro/acento en `.admin-panel`).
- Archivo: `index.html` (bloque `<style>` existente).
- Hecho cuando: el `.admin-panel` usa `--bg-primary`, `--bg-secondary`, `--accent`, `--card-shadow`; no se rompen los estilos de la tienda pública; `npm run build` sigue verde.

T2 — Implementar cards de resumen con datos dinámicos
- RF cubierto: RF-02 (datos dinámicos de `public.sales` / `public.settings`).
- Archivo: `index.html` (dentro del bloque `tab-dashboard` o su callback de carga).
- Hecho cuando: las 4 cards (Ventas Hoy, Mes, Pedidos, Tasa USD) muestran valores numéricos reales (o 0 si no hay datos); no hay texto estático de ejemplo; el diseño coincide con el mockup (bordes `16px`, sombra, padding).

T3 — Gráficos SVG simples: Sales Overview (líneas) y Order Status (anillo)
- RF cubierto: RF-04, RF-05.
- Archivo: `index.html` (elementos `.sales-chart-svg`, `.order-status-ring`).
- Restricción explícita: no usar `Chart.js`, `D3` ni librerías externas. Solo SVG puro (`<line>`, `<circle>`, `<text>`).
- Hecho cuando: los SVG se renderizan con datos reales de hoy/mes; si no hay datos, muestran texto "Sin datos" o línea base; no hay errores en consola; el SVG es responsivo (`viewBox`).

T4 — Sidebar con navegación activa resaltada
- RF cubierto: RF-03.
- Archivo: `index.html` (`.admin-sidebar`, `.tab-btn`).
- Hecho cuando: los 5 enlaces (Productos, POS, Gastos, Dashboard, Ajustes) aparecen en la sidebar; el activo tiene `border-color: var(--accent)` y texto `var(--accent)`; al cambiar de pestaña, el resaltado se actualiza; la funcionalidad `switchAdminTab()` no se rompe.

T5 — Tabla Recent Orders dinámica y lista Top Products dinámica
- RF cubierto: RF-06 (tabla), RF-07 (lista top productos).
- Archivo: `index.html` (elementos `.recent-orders-table`, `.top-products-list`).
- Hecho cuando: la tabla muestra los últimos registros de `public.sales` (o datos locales) con columnas ID, Fecha, Origen, Pago, CUP, USD; la lista Top Products muestra productos con mayor volumen (desde `public.products` + `public.sales`); no hay datos estáticos de ejemplo.

T6 — Diseño responsivo a 375 px sin desbordamiento
- RF cubierto: RF-09.
- Archivo: `index.html` (`@media` o `clamp` en CSS; ajustes de padding/font-size).
- Hecho cuando: en una ventana de 375 px de ancho (`window.innerWidth` o redimensionado manual) no aparece `overflow-x`; la sidebar se adapta (reduce ancho o se comprime); los gráficos SVG mantienen legibilidad; la tabla no se corta.

T7 — Footer info/copyright en panel admin
- RF cubierto: RF-08.
- Archivo: `index.html` (`.admin-footer`).
- Hecho cuando: el footer muestra texto breve en español con versión/app y copyright; usa `--text-secondary`; tamaño pequeño; no interfiere con el contenido superior.

T8 — Funciones puras auxiliares opcionales (`dashboard-stats.js`)
- RF cubierto: RF-02, RF-04, RF-05, RF-06, RF-07 (soporte de datos dinámicos sin modificar `catalog-core.js`).
- Archivo opcional: `dashboard-stats.js` (o funciones dentro del bloque `<script>` existente si no se crea archivo nuevo).
- Restricción: recibe datos como parámetro; no accede al DOM ni a red; no modifica `catalog-core.js`.
- Hecho cuando: si se crea el archivo, las funciones (`getSalesOverview`, `getOrderStatus`, `getTopProducts`, etc.) devuelven valores deterministas para datos de ejemplo; si no se crea, los cálculos se hacen directamente en el callback de carga del dashboard sin romper la separación.

T9 — Revisión visual y verificación final
- RF cubierto: todos los RF de esta spec (RF-01 a RF-09); restricciones (NO Chart.js, NO `catalog-core.js` modificado, NO SQL, NO `MEMORY.md` tocado).
- Comandos: `npm test` (debe ser 112/0), `npm run build` (debe ser 0), `npm run serve` + inspección en 375 px.
- Hecho cuando: `npm test` pasa sin errores; `npm run build` verde; `git diff` confirma que `catalog-core.js` no se modificó; no hay archivos nuevos fuera de `specs/003-estetica-visual/` y `index.html` (y opcionalmente `dashboard-stats.js`); las referencias al archivo visual (`WhatsApp Image...`) se mantienen como comentarios en el código o en esta documentación.

---

Nota sobre orden: T1 y T4 pueden ir en paralelo porque son CSS; T2, T3, T5, T6, T7 dependen de que la pestaña Dashboard esté activa y cargue datos; T8 es opcional y puede hacerse antes o junto con T2-T5; T9 es siempre el último paso.
