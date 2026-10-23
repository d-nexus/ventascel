#!/usr/bin/env node
/* VentasCel: provisionado de cuentas de administración por la Admin API.
   Sin dependencias. Requiere Node 18+ (fetch global).

   MODES:
     node create-admin-user.js --help
     node create-admin-user.js --email <correo> --password <contraseña>
         Crea la cuenta de administrador: confirmada (email_confirm: true)
         y con rol 'admin' en app_metadata (nada en user_metadata).
         Antes compara el SHA-256 de la contraseña con el ADMIN_SHA publicado
         en index.html y informa SOLO «La contraseña coincide con la
         publicada: SÍ/NO»; si es SÍ aborta (código 1). Nunca imprime la
         clave secreta, la contraseña ni el hash nuevo.
         Si index.html ya no contiene ADMIN_SHA (Se elimina en la fase D),
         avisa y usa la variable de entorno ADMIN_SHA si está definida.
     node create-admin-user.js --email <correo> --password <contraseña> --check-only
         SOLO compara el SHA-256 de la contraseña con el ADMIN_SHA publicado
         (en index.html o en la variable ADMIN_SHA) e informa «coincide:
         SÍ/NO» con código de salida 0/1. NO crea la cuenta ni llama a la
         Admin API (útil cuando la cuenta ya existe).
     node create-admin-user.js --test-user
         Crea una cuenta de PRUEBA sin rol (app_metadata vacío) con
         credenciales generadas al vuelo, inicia sesión con ella, intenta
         escribir en products y en el bucket (debe recibir 403 y el bucket
         nota un 400 con AccessDenied/403 en el cuerpo),
         comprueba la lectura pública y BORRA la cuenta al terminar.
         Verificación del rol usada por la fase A (plan §5.3) y T5.

   Variables de entorno (en .env o en el entorno; .env nunca se versiona):
     SUPABASE_URL          https://xxxx.supabase.co
     SUPABASE_SECRET_KEY   clave SECRET (o SUPABASE_SERVICE_KEY, alias legacy)
     ADMIN_SHA             hash publicado, solo si index.html ya no lo contiene
*/
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { loadEnv } = require('./env.js');

const INDEX_FILE = path.join(__dirname, 'index.html');

/* ── Utilidades ─────────────────────────────────────────────────────────── */

function sha256Hex(text) {
    return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Lee el ADMIN_SHA publicado en index.html (solo la coincidencia, nunca lo imprime). */
function readAdminShaFromHtml(file = INDEX_FILE) {
    try {
        const src = fs.readFileSync(file, 'utf8');
        const m = src.match(/ADMIN_SHA\s*=\s*['"]([0-9a-f]{64})['"]/i);
        return m ? m[1].toLowerCase() : null;
    } catch {
        return null; // Sin fichero no hay comparación posible: se avisa en el flujo.
    }
}

function printHelp() {
    console.log(`Uso:
  node create-admin-user.js --email <correo> --password <contraseña>
      Crea la cuenta de administración (confirmada y con rol admin en app_metadata).
  node create-admin-user.js --email <correo> --password <contraseña> --check-only
      SOLO comprueba si la contraseña coincide con el ADMIN_SHA publicado
      (informa «SÍ/NO» con código de salida 0/1). No crea la cuenta ni
      llama a la Admin API: útil cuando la cuenta ya existe.
  node create-admin-user.js --test-user
      Verifica el rol: crea, prueba escrituras y borra una cuenta sin permisos.
  node create-admin-user.js --help
      Muestra esta ayuda.

Variables de entorno (en .env o en el entorno, no en el código):
  SUPABASE_URL, SUPABASE_SECRET_KEY (o SUPABASE_SERVICE_KEY)
  ADMIN_SHA (solo si index.html ya no contiene el hash publicado)`);
}

/** Config: lee variables sin imprimirlas jamás. Devuelve null si falta algo. */
function resolveConfig() {
    const url = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
    const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_KEY || '';
    return { url, secret };
}

async function callApi(url, pathname, { method = 'GET', secret, token, body, contentType = 'application/json' } = {}) {
    const headers = {
        apikey: secret,
        Authorization: `Bearer ${secret}`,
        'Content-Type': contentType
    };
    if (token) headers.Authorization = `Bearer ${token}`; // Peticiones como el usuario (no como servicio).
    return fetch(url + pathname, { method, headers, body });
}

/* ── Modo 1: crear la cuenta de administración ──────────────────────────── */

async function createAdmin({ email, password }) {
    if (!password) { console.error('✘ Falta --password.'); process.exit(1); }
    if (!email) { console.error('✘ Falta --email.'); process.exit(1); }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { console.error('✘ El correo no es válido.'); process.exit(1); }

    // Comparación con el hash publicado: solo sí/no. Nunca se imprime el hash nuevo.
    const fromHtml = readAdminShaFromHtml();
    const fromEnv = process.env.ADMIN_SHA ? process.env.ADMIN_SHA.toLowerCase() : null;
    const published = fromHtml || fromEnv;
    if (published === null) {
        console.warn('⚠ No se encontró ADMIN_SHA en index.html ni en la variable de entorno ADMIN_SHA: no se puede comparar la contraseña con la publicada.');
    } else if (!fromHtml) {
        console.warn('⚠ ADMIN_SHA ya no está en index.html (se elimina en la fase D); se usa la variable de entorno ADMIN_SHA para la comparación.');
    }
    const matches = published !== null && sha256Hex(password) === published;
    if (matches) {
        console.log('La contraseña coincide con la publicada: SÍ');
        console.error('✘ Abortado: la contraseña debe ser DISTINTA de la que hoy está publicada (RF-28).');
        process.exit(1);
    }
    console.log(`La contraseña coincide con la publicada: ${matches ? 'SÍ' : 'NO'}`);

    // La configuración se comprueba aquí: la comparación previa no la necesita.
    const { url, secret } = resolveConfig();
    if (!url || !secret) {
        console.error('✘ Define SUPABASE_URL y SUPABASE_SECRET_KEY (o SUPABASE_SERVICE_KEY) en .env o en el entorno.');
        process.exit(1);
    }

    // Admin API: cuenta confirmada y rol 'admin' SOLO en app_metadata (RF-26, RF-27).
    let res;
    try {
        res = await callApi(url, '/auth/v1/admin/users', {
            method: 'POST',
            secret,
            body: JSON.stringify({
                email,
                password,
                email_confirm: true,
                app_metadata: { role: 'admin' }
            })
        });
    } catch (e) {
        console.error(`✘ No se pudo contactar con la Admin API: ${e.message}`);
        process.exit(1);
    }
    if (!res.ok) {
        const hint = res.status === 422 ? ' (el correo ya existe o fue rechazado)' : '';
        console.error(`✘ No se pudo crear la cuenta: HTTP ${res.status}${hint}`);
        process.exit(1);
    }
    console.log('Cuenta creada con rol admin'); // Sin credenciales: nada de correo, contraseña ni hash.
}

/* ── Modo 3: solo comprobar la contraseña contra el ADMIN_SHA ───────────── */

function checkOnly({ password }) {
    if (!password) { console.error('✘ Falta --password (o la variable AUTH_PASSWORD, con «-» como valor).'); process.exit(1); }
    const fromHtml = readAdminShaFromHtml();
    const fromEnv = process.env.ADMIN_SHA ? process.env.ADMIN_SHA.toLowerCase() : null;
    const published = fromHtml || fromEnv;
    if (published === null) {
        console.error('✘ No se encontró ADMIN_SHA en index.html ni en la variable de entorno ADMIN_SHA: no hay nada con lo que comparar.');
        process.exit(1);
    }
    if (!fromHtml) {
        console.warn('⚠ ADMIN_SHA ya no está en index.html (se elimina en la fase D); se usa la variable de entorno ADMIN_SHA para la comparación.');
    }
    const matches = sha256Hex(password) === published;
    console.log(`La contraseña coincide con la publicada: ${matches ? 'SÍ' : 'NO'}`); // Nunca el hash.
    process.exit(matches ? 0 : 1);
}

/* ── Modo 2: verificación del rol (cuenta de prueba sin rol, plan §5.3) ─── */

const HTTP = { forbidden: 403, notFound: 404, ok: 200 };

async function verifyRole() {
    const { url, secret } = resolveConfig();
    if (!url || !secret) {
        console.error('✘ Define SUPABASE_URL y SUPABASE_SECRET_KEY (o SUPABASE_SERVICE_KEY) en .env o en el entorno.');
        process.exit(1);
    }

    // Credenciales de prueba generadas en cada ejecución (nunca en el código ni en el repo).
    const suffix = crypto.randomBytes(8).toString('hex');
    const email = `sin-permisos-${suffix}@ventascel.test`;
    const password = crypto.randomBytes(24).toString('base64url'); // No se imprime.

    let failures = 0;
    const check = (label, good) => {
        console.log(`${good ? '✔' : '✘'} ${label}`);
        if (!good) failures++;
    };

    // 1) Crear usuario de PRUEBA sin rol (app_metadata vacío, nada en user_metadata).
    let res = await callApi(url, '/auth/v1/admin/users', {
        method: 'POST',
        secret,
        body: JSON.stringify({ email, password, email_confirm: true, app_metadata: {} })
    });
    const created = await res.json().catch(() => ({}));
    if (!res.ok || !created || !created.id) {
        console.error(`✘ No se pudo crear la cuenta de prueba: HTTP ${res.status}. La verificación termina sin dejar la cuenta.`);
        process.exit(1);
    }
    const testId = created.id;
    try {
        // 2) Iniciar sesión con esa cuenta para obtener su token.
        res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
            method: 'POST',
            headers: { apikey: secret, 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        const session = await res.json().catch(() => ({}));
        const token = session && session.access_token;
        check('La cuenta de prueba sin rol ha iniciado sesión', res.ok && Boolean(token));
        if (!token) throw new Error('sin token');

        // 3) Intento de escritura en la tabla (con el token del usuario): esperado 403 (RF-13).
        res = await fetch(`${url}/rest/v1/products`, {
            method: 'POST',
            headers: { apikey: secret, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
            body: JSON.stringify({ name: 'Prueba RLS', price_cup: 1, active: true })
        });
        check(`La escritura en products se rechaza (HTTP ${res.status}, esperado 403)`, res.status === HTTP.forbidden);

        // 4) Intento de subida al bucket (con el token del usuario): esperado 403 (RF-13).
        //    storage/v1 envuelve el 403 de RLS en un HTTP 400 con el cuerpo
        //    {statusCode:"403", code:"AccessDenied", message:"new row violates
        //    row-level security policy"}: se acepta ese 400 como rechazo solo
        //    si el cuerpo confirma el 403/AccessDenied del servidor.
        res = await fetch(`${url}/storage/v1/object/product-images/prueba-rls-${suffix}.jpg`, {
            method: 'POST',
            headers: { apikey: secret, Authorization: `Bearer ${token}`, 'Content-Type': 'image/jpeg' },
            body: Buffer.from('')
        });
        const storageBody = await res.text().catch(() => '');
        const storageDenied = res.status === HTTP.forbidden ||
            (res.status === 400 && storageBody.includes('"statusCode":"403"') &&
                storageBody.includes('"code":"AccessDenied"'));
        check(`La subida al bucket se rechaza (${storageDenied ? 'HTTP ' + res.status + ' con AccessDenied del servidor (403)' : 'HTTP ' + res.status}, esperado 403)`, storageDenied);

        // 5) La lectura pública de productos sigue funcionando con esta sesión (RF-13).
        res = await fetch(`${url}/rest/v1/products?select=id&limit=1`, {
            headers: { apikey: secret, Authorization: `Bearer ${token}` }
        });
        const rows = await res.json().catch(() => null);
        check(`La lectura pública de products funciona (HTTP ${res.status}, esperado 200)`, res.status === HTTP.ok && Array.isArray(rows));
    } catch (e) {
        console.error(`✘ Error durante la verificación: ${e.message}. Se procede a borrar la cuenta de prueba.`);
        failures++;
    } finally {
        // 6) La cuenta de prueba se borra SIEMPRE, también si algo falla antes (RNF-13).
        let deleted = false;
        try {
            res = await callApi(url, `/auth/v1/admin/users/${testId}`, { method: 'DELETE', secret });
            deleted = (res.status === HTTP.ok || res.status === HTTP.notFound);
        } catch { deleted = false; }
        // 7) Confirmar por la Admin API que ya no existe.
        let confirmed = false;
        try {
            res = await callApi(url, `/auth/v1/admin/users/${testId}`, { method: 'GET', secret });
            confirmed = res.status === HTTP.notFound;
        } catch { confirmed = false; }
        check('La cuenta de prueba ya no existe (confirmado por la Admin API)', deleted && confirmed);
    }

    if (failures > 0) process.exit(1);
}

/* ── Arranque ───────────────────────────────────────────────────────────── */

function main() {
    const major = Number((process.versions.node || '').split('.')[0]);
    if (!(major >= 18)) {
        console.error('✘ Se necesita Node 18 o superior (fetch global).');
        process.exit(1);
    }
    if (process.argv.includes('--help') || process.argv.includes('-h')) {
        printHelp();
        process.exit(0); // La ayuda no lee .env ni secretos.
    }

    loadEnv(); // El .env alimenta process.env sin pisar lo ya definido en el entorno.

    const valueOf = (name) => {
        const i = process.argv.indexOf(name);
        if (i < 0 || i + 1 >= process.argv.length) return undefined;
        return process.argv[i + 1];
    };
    const hasAdminArgs = process.argv.includes('--email') && process.argv.includes('--password');
    const hasTestUser = process.argv.includes('--test-user');
    const checkOnlyMode = process.argv.includes('--check-only');
    if (checkOnlyMode && hasTestUser) {
        console.error('✘ Usa un solo modo (--email/--password con --check-only, o --test-user).');
        process.exit(1);
    }
    if (checkOnlyMode && !hasAdminArgs) {
        console.error('✘ --check-only requiere --email y --password. Usa --help.');
        process.exit(1);
    }
    const modes = [hasAdminArgs, hasTestUser].filter(Boolean).length;
    if (modes !== 1) {
        console.error(modes === 0 ? '✘ Sin modo. Usa --help para ver el uso.' : '✘ Usa un solo modo (--email/--password o --test-user).');
        process.exit(1);
    }

    if (hasTestUser) { verifyRole().catch((e) => { console.error(`✘ ${e.message}`); process.exit(1); }); return; }

    const email = valueOf('--email');
    const passwordArg = valueOf('--password');
    // La contraseña puede venir del entorno (AUTH_PASSWORD) pasando '-' como valor,
    // para que no quede en el historial del intérprete de órdenes.
    const password = passwordArg === '-' ? process.env.AUTH_PASSWORD : passwordArg;
    if (!email || !password) {
        console.error('✘ Falta el valor de --email o --password. Usa --help.');
        process.exit(1);
    }
    if (checkOnlyMode) { checkOnly({ password }); return; } // Solo compara el hash; sin red ni creación.
    createAdmin({ email, password }).catch((e) => { console.error(`✘ ${e.message}`); process.exit(1); });
}

main();
