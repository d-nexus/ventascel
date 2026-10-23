# Constitución — VentasCel

Principios innegociables. Toda spec, plan y tarea debe cumplirlos. Máximo 15 líneas.

1. **Simplicidad primero**: sitio estático sin bundler (HTML/CSS/JS en `index.html`, scripts Node sin dependencias); Supabase (Postgres + Auth + Storage) como único backend. Se permite `supabase-js` vía CDN ESM; prohibido añadir frameworks, empaquetadores o dependencias npm. Criterio: si un cambio exige más de un fichero de infraestructura nuevo sin relación con la spec, se ha inflado.
2. **La spec manda**: nada se implementa si no está en la spec activa. Si falta una decisión, se para y se pregunta.
3. **Lógica separada de interfaz**: la lógica de negocio es pura y determinista, sin DOM ni acceso directo a red o almacenamiento; sus dependencias externas (fecha actual, azar, red, almacenamiento) se inyectan como parámetro.
4. **Tests como puerta**: la verificación real es `npm test` (`node --test`, 102 tests sobre `catalog-core.js`) + `npm run build` (valida `products.json` y regenera `products.js`) + comprobaciones SQL sobre Supabase (`pg_policies`, `register_sale` con rollback) + `get_advisors` sin avisos críticos. Prohibido avanzar con la verificación en rojo.
5. **Los datos del usuario son sagrados**: `products.json` es la fuente maestra del catálogo y nunca se sobrescribe sin copia; la base de datos es la fuente de verdad de lo que ve la web, y la copia local del navegador se conserva sin sobrescribir mientras la base de datos no responda, pero se reemplaza por la versión publicada cuando esta responde; las migraciones son idempotentes. Ninguna clave, token ni contraseña se escribe en el repo: solo en `.env` (ignorado por git).
6. **Idioma**: código e identificadores en inglés; interfaz y documentación en español.
