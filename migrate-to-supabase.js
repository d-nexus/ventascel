#!/usr/bin/env node
/* VentasCel → Supabase: Carga inicial idempotente por id (products.json + imágenes).
   Sin dependencias. Requiere Node 18+.

   Uso:
     node migrate-to-supabase.js --dry
     node migrate-to-supabase.js
     node migrate-to-supabase.js --force --yes  (borrado masivo destructivo explícito con aviso y confirmación)
*/
'use strict';
require('./env.js').loadEnv();
const fs = require('fs');
const path = require('path');

const URL_ = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_KEY || '';
const RATE = Number(process.env.RATE || 400);
const DRY = process.argv.includes('--dry');
const FORCE = process.argv.includes('--force');
const YES = process.argv.includes('--yes');
const BUCKET = 'product-images';
const ROOT = process.env.ROOT || __dirname;
const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };
const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };

if (!DRY && !FORCE && (!URL_ || !KEY)) {
    console.error('✘ Define SUPABASE_URL y SUPABASE_SECRET_KEY (o SUPABASE_SERVICE_KEY) en .env (o usa --dry).');
    process.exit(1);
}

const headers = (extra = {}) => {
    const h = { apikey: KEY, ...extra };
    if (KEY.startsWith('eyJ')) h.Authorization = `Bearer ${KEY}`;
    return h;
};

async function api(method, pathname, opts = {}) {
    const res = await fetch(URL_ + pathname, { method, ...opts });
    if (!res.ok) throw new Error(`${method} ${pathname} → ${res.status} ${await res.text()}`);
    return res;
}

async function uploadImage(name, buffer, mime) {
    await api('POST', `/storage/v1/object/${BUCKET}/${encodeURIComponent(name)}`, {
        headers: headers({ 'Content-Type': mime, 'x-upsert': 'true' }),
        body: buffer
    });
    return `${URL_}/storage/v1/object/public/${BUCKET}/${encodeURIComponent(name)}`;
}

async function resolveImage(p) {
    const img = typeof p.image === 'string' ? p.image : '';
    if (!img) return { url: '' };
    if (/^https?:/.test(img)) return { url: img };
    let name, buffer, mime;
    if (img.startsWith('data:')) {
        const m = img.match(/^data:([^;]+);base64,(.*)$/s);
        if (!m) return { url: '', warn: 'imagen base64 ilegible' };
        mime = m[1];
        buffer = Buffer.from(m[2], 'base64');
        name = `p${p.id}${EXT[mime] || '.jpg'}`;
    } else {
        const file = path.join(ROOT, 'img', path.basename(img));
        if (!fs.existsSync(file)) return { url: '', warn: `no existe img/${path.basename(img)}` };
        name = path.basename(file).replace(/[^\w.\-]/g, '_');
        mime = MIME[path.extname(file).toLowerCase()] || 'image/jpeg';
        buffer = fs.readFileSync(file);
    }
    if (DRY) return { url: `(subiría ${name}, ${(buffer.length / 1024).toFixed(0)} KB)` };
    return { url: await uploadImage(name, buffer, mime) };
}

const toNum = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };
const usd = (cup) => (cup == null ? null : Math.round((cup / RATE) * 100) / 100);

async function checkTableEmpty() {
    // Usamos count(*) vía REST con prefer header
    const res = await api('GET', '/rest/v1/products?select=id&limit=1', { headers: headers() });
    const data = await res.json();
    return data.length === 0;
}

async function getTableCount() {
    // Obtener count exacto via REST
    const res = await api('GET', '/rest/v1/products?select=id', { headers: headers({ 'Prefer': 'count=exact' }) });
    // El count viene en el header Content-Range
    const range = res.headers.get('content-range');
    if (range) {
        const match = range.match(/\/(\d+)$/);
        if (match) return parseInt(match[1], 10);
    }
    // Fallback: leer todos (solo para dry-run o tablas pequeñas)
    const data = await res.json();
    return data.length;
}

(async () => {
    const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'products.json'), 'utf8'));
    const list = Array.isArray(raw) ? raw : raw.products;
    const catalogVersion = typeof raw.version === 'number' ? raw.version : 26;

    console.log(`Productos en products.json: ${list.length} (versión ${catalogVersion}) · tasa ${RATE} CUP/USD${DRY ? ' · MODO PRUEBA' : ''}`);

    let wasEmpty = false;

    if (!DRY) {
        // Subir imagen por defecto si existe img/logo.jpg
        const logoFile = path.join(ROOT, 'img', 'logo.jpg');
        if (fs.existsSync(logoFile)) {
            const logoBuf = fs.readFileSync(logoFile);
            await uploadImage('default.jpg', logoBuf, 'image/jpeg');
            console.log('• Imagen por defecto (default.jpg) subida al bucket.');
        }

        // Comprobar si la tabla está vacía ANTES de hacer nada
        wasEmpty = await checkTableEmpty();

        if (!wasEmpty) {
            if (FORCE) {
                if (!YES) {
                    console.error('✘ --force requiere confirmación explícita con --yes');
                    console.error('   Esto borra TODOS los productos de la base de datos y no se puede deshacer.');
                    console.error('   Ejecuta: node migrate-to-supabase.js --force --yes');
                    process.exit(1);
                }
                console.log('⚠ ATENCIÓN: --force --yes activado. Vaciando tabla products por completo...');
                await api('DELETE', '/rest/v1/products?id=gt.0', { headers: headers() });
                console.log('• Tabla products vaciada.');
                wasEmpty = true; // tras borrar, tratamos como si estuviera vacía
            } else {
                console.log('• La tabla products ya tiene datos. Aplicando carga idempotente por id (upsert)...');
            }
        }
    }

    const rows = [], warns = [];
    let cleanedBadges = 0;
    for (const p of list) {
        const id = Number(p.id);
        if (!Number.isFinite(id)) {
            warns.push(`Producto sin id válido: "${p.name}"`);
            continue;
        }
        const cup = toNum(p.price) || 0;
        const oldCup = toNum(p.oldPrice);
        const { url, warn } = await resolveImage(p);
        if (warns.length < 50 && warn) warns.push(`"${p.name}": ${warn}`);
        let badge = String(p.badge || '');
        if (/oferta/i.test(badge) && !oldCup) { badge = ''; cleanedBadges++; }
        let specs = p.specs;
        if (typeof specs === 'string') { try { specs = JSON.parse(specs.replace(/'/g, '"')); } catch { specs = [specs]; } }
        rows.push({
            id,
            name: String(p.name || 'Sin nombre').trim(),
            category: String(p.category || 'General').trim(),
            badge,
            price_cup: cup,
            price_usd: usd(cup),
            old_price_cup: oldCup,
            old_price_usd: usd(oldCup),
            rating: Math.min(5, Number(p.rating) || 4.5),
            reviews: Number(p.reviews) || 0,
            image_url: url,
            description: String(p.description || ''),
            specs: Array.isArray(specs) ? specs : [],
            stock: null,
            active: true
        });
    }

    if (DRY) {
        console.log('\nEjemplo de fila upsert:\n', JSON.stringify(rows[0], null, 2));
        console.log(`\n✔ ${rows.length} productos listos para carga idempotente (upsert por id).`);
        if (wasEmpty !== undefined) {
            console.log(`• Tabla ${wasEmpty ? 'vacía' : 'con datos'} al inicio → catalog_state ${wasEmpty ? 'se inicializará' : 'NO se tocará'}.`);
        }
    } else {
        // Upsert por id con on_conflict=id y resolution=merge-duplicates
        await api('POST', '/rest/v1/products', {
            headers: headers({
                'Content-Type': 'application/json',
                'Prefer': 'resolution=merge-duplicates,return=minimal',
                'on_conflict': 'id'
            }),
            body: JSON.stringify(rows)
        });

        // Si la tabla estaba vacía al empezar, inicializar catalog_state con la versión heredada
        if (wasEmpty) {
            await api('POST', '/rest/v1/catalog_state', {
                headers: headers({ 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates,return=minimal', 'on_conflict': 'id' }),
                body: JSON.stringify({ id: 1, version: catalogVersion })
            });
            console.log(`• catalog_state inicializado con versión ${catalogVersion} (maestro heredado).`);
        } else {
            console.log('• catalog_state no se toca: la versión la gestiona el trigger si el contenido cambia (RF-6).');
        }
        console.log(`\n✔ ${rows.length} productos procesados con upsert (idempotente).`);
    }

    console.log(`✔ Insignias "Oferta" sin precio anterior quitadas: ${cleanedBadges}`);
    if (warns.length) { console.log(`⚠ Advertencias (${warns.length}):`); warns.forEach(w => console.log('  ·', w)); }
})().catch(e => { console.error('✘', e.message); process.exit(1); });