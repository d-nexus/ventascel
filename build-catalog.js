#!/usr/bin/env node
/* ============================================
   VentasCel — Build del catálogo
   --------------------------------------------
   Lee products.json (fuente maestra), valida su
   integridad y genera products.js como semilla
   para carga sin servidor (file://).

   Uso:  npm run build
   ============================================ */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const SRC = path.join(ROOT, 'products.json');
const OUT = path.join(ROOT, 'products.js');
const IMG_DIR = path.join(ROOT, 'img');

console.log('VentasCel · build-catalog');
console.log('─────────────────────────');

/* ---------- 1. Cargar y parsear ---------- */
let catalog;
try {
    catalog = JSON.parse(fs.readFileSync(SRC, 'utf8'));
} catch (err) {
    console.error('✘ products.json no es un JSON válido:', err.message);
    process.exit(1);
}

const products = Array.isArray(catalog) ? catalog : catalog.products;
if (!Array.isArray(products) || products.length === 0) {
    console.error('✘ products.json no contiene un array "products" con elementos.');
    process.exit(1);
}

/* ---------- 2. Validación ---------- */
const REQUIRED = ['id', 'name', 'category', 'price', 'image'];
const errors = [];
const warnings = [];
const seenIds = new Set();

products.forEach((p, i) => {
    const label = `producto[${i}] "${p.name || 'sin nombre'}"`;

    for (const field of REQUIRED) {
        if (p[field] === undefined || p[field] === null || p[field] === '') {
            errors.push(`${label}: falta campo obligatorio "${field}"`);
        }
    }

    if (seenIds.has(p.id)) errors.push(`${label}: id duplicado (${p.id})`);
    seenIds.add(p.id);

    if (p.price !== undefined && (typeof p.price !== 'number' || p.price < 0 || Number.isNaN(p.price))) {
        errors.push(`${label}: "price" debe ser número ≥ 0`);
    }
    if (p.oldPrice != null && (typeof p.oldPrice !== 'number' || p.oldPrice < 0)) {
        warnings.push(`${label}: "oldPrice" no numérico, se ignorará`);
    }
    if (!Array.isArray(p.specs)) {
        warnings.push(`${label}: "specs" no es array → se normaliza a []`);
        p.specs = [];
    }
    if (typeof p.rating !== 'number') { warnings.push(`${label}: rating no numérico → 4.5`); p.rating = 4.5; }
    if (typeof p.reviews !== 'number') { warnings.push(`${label}: reviews no numérico → 0`); p.reviews = 0; }
});

/* Comprobar imágenes locales referenciadas */
let imgMissing = 0;
products.forEach(p => {
    if (typeof p.image !== 'string') return;
    if (/^(https?:|data:)/.test(p.image)) return;      // URL externa o embebida: OK
    const localPath = path.join(IMG_DIR, path.basename(p.image));
    if (!fs.existsSync(localPath)) {
        warnings.push(`imagen no encontrada en img/: ${path.basename(p.image)} (producto "${p.name}")`);
        imgMissing++;
    }
});

if (errors.length) {
    console.error('\n✘ Validación FALLIDA:');
    errors.forEach(e => console.error('   ·', e));
    process.exit(1);
}

/* ---------- 3. Normalizar metadatos ---------- */
if (Array.isArray(catalog)) {
    catalog = { catalog: 'VentasCel', version: 1, updated: new Date().toISOString().slice(0, 10), products };
} else {
    catalog.products = products;
}

/* El campo "version" es la clave de sincronización: los visitantes
   adoptan automáticamente cualquier versión mayor que la guardada. */
if (!Number.isFinite(Number(catalog.version)) || Number(catalog.version) < 1) {
    warnings.push('falta "version" numérica ≥ 1 → se asigna 1 (¡súmala en cada publicación!)');
    catalog.version = 1;
}

/* ---------- 4. Emitir products.js ---------- */
const banner =
    `/* ============================================================\n` +
    ` *  AUTO-GENERADO desde products.json — NO EDITAR A MANO\n` +
    ` *  Regenerar con: npm run build\n` +
    ` *  Generado: ${new Date().toISOString()}\n` +
    ` * ============================================================ */\n` +
    `window.VENTASCEL_CATALOG = ${JSON.stringify(catalog, null, 2)};\n`;

fs.writeFileSync(OUT, banner, 'utf8');

/* ---------- 5. Resumen ---------- */
console.log(`✔ products.json válido — ${products.length} productos`);
console.log(`✔ products.js generado (${(fs.statSync(OUT).size / 1024).toFixed(1)} KB)`);
if (warnings.length) {
    console.log(`\n⚠ Advertencias (${warnings.length}):`);
    warnings.forEach(w => console.log('   ·', w));
}
console.log('\nBuild completado.');
