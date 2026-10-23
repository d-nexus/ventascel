Spec 003 — Estética y Diseño Visual del Panel Admin (VentasCel)
Estado: borrador

Referencia visual: `specs/WhatsApp Image 2026-10-22 at 1.45.28 AM.jpeg` (mockup admin oscuro con sidebar, cards resumen, gráfico líneas Sales Overview, gráfico circular Order Status, tabla Recent Orders, lista Top Products, footer con info/copyright).

Restricciones innegociables (constitución + contexto):
- **NO frameworks ni dependencias npm nuevas**; `supabase-js` por CDN ESM es el único cliente permitido. Prohibido `Chart.js`, `D3`, `Plotly`, `Recharts`, etc.
- **NO modificar `catalog-core.js`**; la lógica pura existe (Spec 002) y se reutiliza sin cambios.
- **NO modificar SQL** ni añadir tablas (`public.settings`, `public.sales`/`expenses`, `public.products` se mantienen intactas).
- **NO tocar `MEMORY.md` ni `docs/constitution.md`** en esta spec.
- `npm test` debe seguir 112/0; `npm run build` debe terminar en código 0.
- Código/identificadores en inglés (`card`, `sidebar`, `chart`, `theme`, `accent`); interfaz/docs en español.
- Lógica pura separada de interfaz: los datos del dashboard provienen de funciones puras ya existentes o de llamadas a Supabase inyectadas como parámetros; ninguna lógica de negocio se incrusta en el DOM ni en estilos.

---

## Requisitos funcionales (RF) — solo visual / experiencia

- **RF-01 (Tema oscuro / acento)**: El panel de administración (`.admin-panel`) debe adoptar la paleta del mockup: fondo oscuro (`#080c14` / `#0f172a`), cards con fondo semi-transparente (`rgba(15, 23, 42, 0.75)`), acento azul (`#2563eb`) con resplandor suave (`rgba(37, 99, 235, 0.35)`), tipografía `Plus Jakarta Sans` ya cargada. Debe respetar la variable `data-theme="dark"` existente y no romper la tienda pública.
- **RF-02 (Cards con datos dinámicos)**: Las cards de resumen en Dashboard (Ventas Hoy, Mes, Número de Pedidos, Tasa USD) deben mostrar valores reales extraídos de `public.sales` / `public.settings` (o de funciones puras que reciben los datos como parámetro), nunca valores estáticos o de ejemplo. Las cards deben mantener el diseño del mockup: sombra (`--card-shadow`), bordes redondeados (`16px`), padding generoso.
- **RF-03 (Sidebar con navegación activa)**: El panel debe incluir una barra lateral (`.admin-sidebar`) con los 5 enlaces de pestaña (Productos, POS, Gastos, Dashboard, Ajustes). El enlace activo debe resaltarse con el color de acento (`--accent`) y un indicador visual (línea o fondo sutil), sin romper el comportamiento de `switchAdminTab()` existente.
- **RF-04 (Gráfico líneas — datos reales, solo SVG/CSS)**: El gráfico "Sales Overview" debe dibujarse con SVG puro (líneas, puntos, etiquetas de eje simples) alimentado con datos reales de ventas del día actual y del mes (desde `public.sales`). Prohibido cualquier librería de gráficos externa. El SVG debe ser responsivo (`viewBox`, `preserveAspectRatio`) y legible en oscuro.
- **RF-05 (Gráfico circular — datos reales, solo SVG)**: El gráfico "Order Status" (o equivalente de desglose) debe ser un SVG de anillo (`circle` con `stroke-dasharray`) que refleje la proporción real de estados/pedidos desde los datos. Prohibido librerías externas.
- **RF-06 (Tabla Recent Orders dinámica)**: La tabla de pedidos recientes debe listar los últimos registros de `public.sales` (o su equivalente en datos locales) con las columnas: ID, Fecha, Origen, Método de Pago, CUP, USD. El diseño debe coincidir con el mockup: cabecera con tipografía clara, filas con bordes sutiles, texto en `--text-secondary` para datos secundarios.
- **RF-07 (Top Products lista dinámica)**: La lista "Top Products" debe mostrar los productos con mayor volumen de venta en el mes (calculado a partir de datos reales), con miniatura de imagen (`products`), nombre, cantidad vendida y tendencia. No debe ser estática; los datos se inyectan al cargar la pestaña Dashboard.
- **RF-08 (Footer info/copyright)**: El pie del panel (`.admin-footer`) debe incluir texto breve (en español) con información de la aplicación (`VentasCel v...`) y copyright, siguiendo el estilo oscuro del mockup: color `--text-secondary`, tamaño pequeño (`0.75rem`), centrado o alineado según mockup.
- **RF-09 (Responsivo a 375 px)**: Todo el diseño visual (sidebar, cards, gráficos, tabla, lista) debe mantenerse legible en pantallas de 375 px de ancho sin desbordamiento horizontal (`overflow-x: hidden`). La sidebar puede colapsar o convertirse en navegación superior compacta si es necesario, pero debe conservar la funcionalidad de navegación activa (RF-03).

---

## Requisitos no funcionales (RNF)

- **RNF-01 (Sin dependencias nuevas)**: Ninguna librería CSS o JS añadida al `index.html`; todo el diseño se implementa con variables CSS existentes o nuevas dentro del bloque `<style>` existente, y con funciones JS ya presentes (`switchAdminTab`, carga de datos del dashboard).
- **RNF-02 (Sin modificaciones a `catalog-core.js`)**: La lógica pura (`catalog-core.js`) no se edita; si se requieren cálculos nuevos (ej. suma de ventas, top productos), se escriben como funciones puras nuevas en un archivo auxiliar (`dashboard-stats.js`) o directamente como funciones inyectadas, sin alterar `catalog-core.js`. El archivo auxiliar, si se crea, debe seguir la regla de separación: recibe datos como parámetro, no accede al DOM ni a red.
- **RNF-03 (Gráficos SVG puros)**: Prohibido usar `<canvas>` con librerías externas; preferir SVG puro con elementos `<line>`, `<circle>`, `<rect>`, `<text>`. Si es estrictamente necesario un `<canvas>` básico (sin librerías), debe documentarse con la alternativa descartada (SVG puro) y el porqué.
- **RNF-04 (Pruebas sin regresión)**: `npm test` debe seguir pasando (112/0); `npm run build` debe seguir verde; no se introducen errores de sintaxis en `index.html`; no se rompen los eventos `onclick` de las pestañas ni la carga del panel admin.
- **RNF-05 (Idioma)**: Documentación en español; identificadores en inglés (`.admin-sidebar`, `.sales-chart-svg`, `.order-status-ring`, `.top-product-card`, `.admin-footer`).

---

## Fuera de alcance

- Rediseño de la tienda pública (catálogo, carrito, ficha de producto): esta spec es solo el panel admin.
- Nuevas funcionalidades de negocio (registro de gastos, POS, ajustes de tasa): son de Spec 002 y ya cerradas; esta spec no modifica su comportamiento lógico.
- Animaciones complejas o transiciones de página; solo transiciones suaves (`--transition`) ya existentes.
- Accesibilidad completa (ARIA extendido); se mantiene lo existente sin eliminar atributos actuales.
- Exportación de gráficos como imagen o PDF.
- Modificación del esquema SQL o migraciones.
- Cambio de `MEMORY.md` o `docs/constitution.md`.

---

## Casos límite

- Si `public.sales` está vacío o la red falla: los gráficos SVG muestran un estado vacío (texto "Sin datos" o línea base en 0) sin romper el layout; las cards muestran 0 o guión; la tabla muestra mensaje "No hay pedidos recientes".
- Si el usuario cambia a `data-theme="light"` (si se implementa en el futuro): los colores del panel deben seguir funcionando; esta spec se limita al tema oscuro del mockup, pero las variables CSS deben ser reutilizables.
- Si la ventana es más estrecha que 375 px (ej. 320 px): el layout debe escalar con `font-size` relativo (`clamp`) y `padding` reducido, sin ocultar datos críticos.
- Si una imagen de producto no existe en la base de datos (`products.image` nulo): se muestra la imagen por defecto existente o un placeholder con color de acento (`--accent-glow`).

---

## Criterios de finalización

1. El archivo `index.html` tiene el panel admin (`.admin-panel`) con diseño oscuro, sidebar activa, cards con datos dinámicos, gráficos SVG con datos reales, tabla dinámica, lista de top productos dinámica y footer.
2. No hay referencias a `Chart.js`, `D3` ni librerías de gráficos externas; los gráficos son SVG puro.
3. `catalog-core.js` no se modificó (verificación con `git diff` o inspección de archivo).
4. `npm test` pasa con 112/0 y `npm run build` con código 0.
5. El diseño se ve correctamente en 375 px sin desbordamiento horizontal.
6. Las referencias al archivo visual (`WhatsApp Image 2026-10-22 at 1.45.28 AM.jpeg`) se mencionan como fuente de diseño en los comentarios del código y en esta spec.
