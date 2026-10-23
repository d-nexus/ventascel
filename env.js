#!/usr/bin/env node
/* VentasCel: cargador de .env para los scripts Node del proyecto.
   Sin dependencias. Requiere Node 18+ (no usa fetch aquí, pero mantiene
   la misma base que el resto de scripts del proyecto).

   Reglas:
   - Lee el fichero .env (ignorado por git) y vuelca sus variables a process.env.
   - process.env TIENE PRIORIDAD: si una variable ya está definida en el
     entorno, el valor de .env no la sobrescribe.
   - Nunca imprime valores: las claves del .env son secretas
     (SUPABASE_SECRET_KEY / SUPABASE_SERVICE_KEY) y no se muestran jamás.

   Uso:
     require('./env.js').loadEnv();
   Devuelve process.env ya alimentado. Busca el .env en el directorio de
   trabajo actual y, si no existe, junto a este fichero.

   Sintaxis admitida (suficiente para este proyecto):
     KEY=valor
     KEY="valor con espacios"
     KEY='valor'
     export KEY=valor
     # comentario
*/
'use strict';
const fs = require('fs');
const path = require('path');

function parseEnvLine(line) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return null;
    const line2 = trimmed.startsWith('export ') ? trimmed.slice(7).trim() : trimmed;
    const eq = line2.indexOf('=');
    if (eq <= 0) return null;
    const key = line2.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(key)) return null;
    let value = line2.slice(eq + 1).trim();
    // Quita comillas envolventes emparejadas (simples o dobles).
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) ||
                              (value.startsWith('\'') && value.endsWith('\'')))) {
        value = value.slice(1, -1);
    }
    return [key, value];
}

/** Rutas candidatas para el fichero .env (primera que exista gana). */
function envFileCandidates(dir) {
    const base = dir || ((typeof __dirname === 'string' && __dirname) || process.cwd());
    return [path.join(process.cwd(), '.env'), path.join(base, '.env')];
}

/**
 * Carga el .env en process.env. El entorno ya existente tiene prioridad.
 * @param {object} target process.env por defecto (inyectable para pruebas)
 * @param {string} dir carpeta donde buscar el .env si no está en cwd
 * @returns {object} el mismo target, ya alimentado
 */
function loadEnv(target = process.env, dir) {
    const file = envFileCandidates(dir).find((f) => fs.existsSync(f) && fs.statSync(f).isFile());
    if (!file) return target; // Sin .env: el entorno manda; los scripts avisan de lo que falte.
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    for (const line of lines) {
        const pair = parseEnvLine(line);
        if (!pair) continue;
        const [key, value] = pair;
        if (!(key in target)) target[key] = value; // No sobrescribe lo que ya estaba definido.
    }
    return target;
}

module.exports = { loadEnv, parseEnvLine, envFileCandidates };
