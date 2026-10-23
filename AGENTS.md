# AGENTS.md — VentasCel

Tienda online estática (un solo `index.html` con CSS y JS en línea) con catálogo gestionado y panel de administración. Backend: Supabase (Postgres + Auth + Storage).

## Comandos

- `npm run build` — valida `products.json` y regenera `products.js` (semilla). **Sigue siendo el comando de validación del catálogo**: debe terminar en código 0.
- `npm test` — ejecuta la suite de tests de la lógica pura con `node --test` (sin dependencias npm): comprueba `test/catalog-core.test.js`. Debe terminar en código 0.
- `npm run serve` — sirve el sitio en `http://localhost:8080`. Necesario para que `fetch` funcione; con `file://` el navegador lo bloquea.
- `node migrate-to-supabase.js --dry` — comprueba la migración del catálogo sin escribir nada (requiere `SUPABASE_URL` y `SUPABASE_SERVICE_KEY` en el entorno).
- Comprobaciones de base de datos: SQL puntual sobre el proyecto Supabase + `get_advisors` (MCP de Supabase) sin avisos críticos.

## Reglas

- Código e identificadores en inglés; interfaz y documentación en español.
- Sitio estático: sin bundler, sin frameworks, sin dependencias npm. `supabase-js` por CDN ESM es lo único permitido.
- `products.json` es el catálogo maestro: nunca se sobrescribe sin copia (`*_backup_*.json`). `products.js` es generado: no editar a mano.
- Ninguna clave, token o contraseña en el repo: solo en `.env` (ya ignorado por git).
- El panel de administración opera contra la base de datos, no contra `localStorage`.
- Lee `MEMORY.md` y `docs/constitution.md` antes de empezar; toda spec/plan/tarea debe cumplir la constitución.
