/* ============================================================
   VentasCel · catalog-core.js
   ------------------------------------------------------------
   Lógica de negocio PURA del catálogo: conversión de precios
   CUP/USD, validación del formulario, mapeo fila de base de
   datos <-> producto de cliente, copia local, diff de
   importación, filtrado y orden.

   Export dual (script clásico, no módulo ES):
     · Navegador: <script src="catalog-core.js"></script> → window.VentasCelCore
     · Node:      require('./catalog-core.js')

   Por qué un script clásico y no un módulo ES (decisión D-2 del
   plan): los módulos ES locales NO cargan bajo file:// (el origen
   "null" no tiene CORS) y el sitio debe seguir funcionando abierto
   como archivo local (RNF-2). Un script clásico se carga con
   <script src> y además se puede importar con "require" en Node
   para la suite de tests, sin duplicar código ni copiar ficheros.

   Reglas (constitución, principio 3):
     · Sin DOM, sin red, sin almacenamiento y sin reloj.
     · Todo entra por parámetro y todo sale por valor de retorno.
     · Código e identificadores en inglés; mensajes en español.
   ============================================================ */

(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.VentasCelCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    /* ------------------------------------------------------------
       Constantes
       ------------------------------------------------------------ */

    /* Tasa de cambio única de todo el proyecto: 820 CUP = 1 USD.
       Valor por defecto; la tasa vigente la manda la base de datos
       (tabla public.settings) y se inyecta en las funciones puras
       (RF-07). Se permite cambiar el valor con el plan vigente. */
    const DEFAULT_RATE = 820;

    /* Alias de compatibilidad con la constante anterior. No se debe
       usar en código nuevo: las funciones aceptan la tasa como
       parámetro y fallan (null) ante una tasa inválida (RF-07). */
    const PRICE_RATE = DEFAULT_RATE;

    /* URL pública del proyecto (no es una credencial: es el mismo
       dato que ya se publica en la página). Solo se usa para
       componer la imagen por defecto del bucket y se puede
       sobrescribir pasando la URL como argumento. */
    const DEFAULT_SUPABASE_URL = 'https://hilyinvdcscekeaofbmw.supabase.co';
    const DEFAULT_IMAGE_PATH = '/storage/v1/object/public/product-images/default.jpg';

    /* ------------------------------------------------------------
       Utilidades internas
       ------------------------------------------------------------ */

    /* Convierte a número finito o devuelve null. null significa
       "no hay valor", que es distinto de 0: un precio de 0 es un
       valor legítimo (producto gratuito o promoción) y se muestra
       como tal, nunca como campo vacío. */
    function toNumber(value) {
        if (typeof value === 'number') return Number.isFinite(value) ? value : null;
        if (typeof value === 'string') {
            const trimmed = value.trim();
            if (!trimmed) return null;
            const parsed = Number(trimmed);
            return Number.isFinite(parsed) ? parsed : null;
        }
        return null;
    }

    /* Un campo vacío del formulario (nulo, indefinido o cadena en
       blanco) significa "no informado": no es un error. */
    function isBlank(value) {
        if (value === null || value === undefined) return true;
        return typeof value === 'string' && value.trim() === '';
    }

    /* Redondeo a dos decimales. El sesgo de EPSILON evita que
       1.005 se trunque a 1.00 por error de representación binaria. */
    function round2(value) {
        return Math.round((value + (value >= 0 ? 1e-9 : -1e-9)) * 100) / 100;
    }

    /* Formato numérico español: punto para los millares y coma
       para los decimales. Se hace a mano y no con Intl para que el
       resultado sea idéntico en Node y en el navegador y no dependa
       de los datos de configuración regional de cada equipo. */
    function formatNumberEs(value, decimals) {
        const parts = Math.abs(value).toFixed(decimals).split('.');
        const intPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
        const sign = value < 0 ? '-' : '';
        return sign + intPart + (decimals > 0 ? ',' + parts[1] : '');
    }

    /* Minúsculas sin tildes, igual que hace hoy la tienda: así la
       búsqueda encuentra "cable" al escribir "cábile" y las
       categorías se comparan sin depender de las tildes. */
    function normalizeText(value) {
        return String(value || '')
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '');
    }

    /* Las especificaciones siempre son una lista de textos sin
       blancos: la base de datos las guarda como array y la interfaz
       las pinta como lista de puntos. */
    function normalizeSpecs(specs) {
        if (!Array.isArray(specs)) return [];
        return specs
            .map(spec => (spec === null || spec === undefined ? '' : String(spec).trim()))
            .filter(spec => spec.length > 0);
    }

    function priceOf(product) {
        const price = toNumber(product && product.price);
        return price === null ? 0 : price;
    }

    function ratingOf(product) {
        const rating = toNumber(product && product.rating);
        return rating === null ? 0 : rating;
    }

    /* ------------------------------------------------------------
       Precios CUP / USD (RF-11, RNF-11)
       ------------------------------------------------------------ */

    /* Convierte CUP a dólares con la tasa inyectada.
       null si no hay precio o la tasa es inválida (no finita o <= 0). */
    function cupToUsd(cup, rate = DEFAULT_RATE) {
        const value = toNumber(cup);
        if (value === null) return null;
        if (!Number.isFinite(rate) || rate <= 0) return null;
        return round2(value / rate);
    }

    /* Convierte dólares a CUP con la tasa inyectada (operación inversa).
       null si no hay precio o la tasa es inválida. */
    function usdToCup(usd, rate = DEFAULT_RATE) {
        const value = toNumber(usd);
        if (value === null) return null;
        if (!Number.isFinite(rate) || rate <= 0) return null;
        return round2(value * rate);
    }

    /* Texto con separador de millares: 1500 → "1.500 CUP".
       Los decimales solo se muestran si el precio los tiene de
       verdad; los precios en CUP son casi siempre enteros. */
    function formatCup(value) {
        const number = toNumber(value);
        if (number === null) return '';
        const decimals = Number.isInteger(number) ? 0 : 2;
        return formatNumberEs(number, decimals) + ' CUP';
    }

    /* Texto con separador de millares: 3.75 → "3,75 USD".
       El equivalente en dólares siempre lleva dos decimales
       (1 500 CUP equivalen a 3,75 USD). */
    function formatUsd(value) {
        const number = toNumber(value);
        if (number === null) return '';
        return formatNumberEs(number, 2) + ' USD';
    }

    /* ------------------------------------------------------------
       Etiqueta de oferta y precio anterior (RF-15, RF-16)
       ------------------------------------------------------------ */

    /* Limpia la etiqueta de oferta cuando el producto NO tiene
       precio anterior: sin precio tachado no hay oferta real, así
       que la insignia se oculta (RF-15). El resto de etiquetas
       ("Nuevo", "Popular") se respetan siempre. */
    function normalizeBadge(badge, oldPriceCup) {
        const text = badge === null || badge === undefined ? '' : String(badge).trim();
        if (!text) return '';
        const oldPrice = toNumber(oldPriceCup);
        const hasOldPrice = oldPrice !== null && oldPrice > 0;
        if (/oferta/i.test(text) && !hasOldPrice) return '';
        return text;
    }

    /* El precio anterior solo se muestra tachado si es MAYOR que el
       precio actual; si es igual o menor, no hay descuento y no se
       enseña (RF-16). */
    function shouldShowOldPrice(price, oldPrice) {
        const current = toNumber(price);
        const previous = toNumber(oldPrice);
        if (current === null || previous === null) return false;
        return previous > current;
    }

    /* ------------------------------------------------------------
       Existencias y disponibilidad (RF-34)
       ------------------------------------------------------------ */

    /* Agotado = existencias iguales a cero. Con existencias nulas
       (sin control de existencias) el producto se muestra
       disponible. */
    function isSoldOut(product) {
        if (!product || typeof product !== 'object') return false;
        const stock = product.stock;
        if (stock === null || stock === undefined || stock === '') return false;
        const value = toNumber(stock);
        return value === 0;
    }

    /* Un producto se puede añadir al carrito si no está agotado, si
       está activo y si tiene precio. Un precio de 0 NO impide la
       compra: es un valor legítimo. */
    function canAddToCart(product) {
        if (!product || typeof product !== 'object') return false;
        if (isSoldOut(product)) return false;
        if (product.active === false) return false;
        const price = toNumber(product.price);
        if (price === null || price < 0) return false;
        return true;
    }

    /* ------------------------------------------------------------
       Validación del formulario del panel (RF-14)
       ------------------------------------------------------------ */

    /* Valida el formulario de producto. Devuelve { valid, errors }
       con una entrada por problema: { campo, mensaje } en
       español, para que la interfaz pueda señalar cada campo. */
    function validateProductForm(form) {
        const errors = [];
        const data = form && typeof form === 'object' ? form : {};

        const name = typeof data.name === 'string' ? data.name.trim() : '';
        if (!name) errors.push({ campo: 'name', mensaje: 'El nombre es obligatorio.' });

        const category = typeof data.category === 'string' ? data.category.trim() : '';
        if (!category) errors.push({ campo: 'category', mensaje: 'La categoría es obligatoria.' });

        const priceEmpty = isBlank(data.price);
        const price = priceEmpty ? null : toNumber(data.price);
        if (priceEmpty) {
            errors.push({ campo: 'price', mensaje: 'El precio es obligatorio.' });
        } else if (price === null) {
            errors.push({ campo: 'price', mensaje: 'El precio debe ser un número.' });
        } else if (price < 0) {
            errors.push({ campo: 'price', mensaje: 'El precio no puede ser negativo.' });
        }

        if (!isBlank(data.oldPrice)) {
            const oldPrice = toNumber(data.oldPrice);
            if (oldPrice === null) {
                errors.push({ campo: 'oldPrice', mensaje: 'El precio anterior debe ser un número.' });
            } else if (oldPrice < 0) {
                errors.push({ campo: 'oldPrice', mensaje: 'El precio anterior no puede ser negativo.' });
            } else if (price !== null && oldPrice <= price) {
                errors.push({
                    campo: 'oldPrice',
                    mensaje: 'El precio anterior debe ser mayor que el precio actual.'
                });
            }
        }

        if (!isBlank(data.stock)) {
            const stock = toNumber(data.stock);
            if (stock === null || !Number.isInteger(stock)) {
                errors.push({ campo: 'stock', mensaje: 'Las existencias deben ser un número entero.' });
            } else if (stock < 0) {
                errors.push({ campo: 'stock', mensaje: 'Las existencias no pueden ser negativas.' });
            }
        }

        if (!isBlank(data.rating)) {
            const rating = toNumber(data.rating);
            if (rating === null) {
                errors.push({ campo: 'rating', mensaje: 'La valoración debe ser un número.' });
            } else if (rating < 0 || rating > 5) {
                errors.push({ campo: 'rating', mensaje: 'La valoración debe estar entre 0 y 5.' });
            }
        }

        if (!isBlank(data.reviews)) {
            const reviews = toNumber(data.reviews);
            if (reviews === null || !Number.isInteger(reviews)) {
                errors.push({ campo: 'reviews', mensaje: 'El número de reseñas debe ser un número entero.' });
            } else if (reviews < 0) {
                errors.push({ campo: 'reviews', mensaje: 'El número de reseñas no puede ser negativo.' });
            }
        }

        return { valid: errors.length === 0, errors };
    }

    /* ------------------------------------------------------------
       Normalización de productos (RF-14, RF-39)
       ------------------------------------------------------------ */

    /* Normaliza un producto de cliente con los nombres de campo
       vigentes. Devuelve null si el producto no es utilizable (sin
       nombre, sin categoría o sin precio válido): es la misma
       exigencia que se aplica a la copia local y a los archivos
       importados. */
    function normalizeProduct(raw) {
        if (!raw || typeof raw !== 'object') return null;

        const name = typeof raw.name === 'string' ? raw.name.trim() : '';
        const category = typeof raw.category === 'string' ? raw.category.trim() : '';
        const price = toNumber(raw.price);
        if (!name || !category || price === null || price < 0) return null;

        const oldPriceValue = isBlank(raw.oldPrice) ? null : toNumber(raw.oldPrice);
        const oldPrice = oldPriceValue === null || oldPriceValue < 0 ? null : oldPriceValue;

        const ratingValue = toNumber(raw.rating);
        const rating = ratingValue === null ? 4.5 : Math.min(5, Math.max(0, ratingValue));

        const reviewsValue = toNumber(raw.reviews);
        const reviews = reviewsValue === null ? 0 : Math.max(0, Math.trunc(reviewsValue));

        const stockValue = isBlank(raw.stock) ? null : toNumber(raw.stock);
        const stock = stockValue === null ? null : Math.max(0, Math.trunc(stockValue));

        const id = toNumber(raw.id);

        return {
            id: id === null ? null : id,
            name: name,
            category: category,
            badge: normalizeBadge(raw.badge, oldPrice),
            price: price,
            oldPrice: oldPrice,
            rating: rating,
            reviews: reviews,
            image: typeof raw.image === 'string' ? raw.image.trim() : '',
            description: typeof raw.description === 'string' ? raw.description : '',
            specs: normalizeSpecs(raw.specs),
            stock: stock,
            active: raw.active === false ? false : true
        };
    }

    /* ------------------------------------------------------------
       Mapeo entre la base de datos y el cliente (RF-2, RF-11,
       RF-12, RF-40)
       ------------------------------------------------------------ */

    /* Fila de la tabla "products" → producto de cliente con los
       nombres de campo del navegador (id, name, category, badge,
       price, oldPrice, rating, reviews, image, description, specs,
       stock, active). La traducción ocurre al leer, sin reescribir
       lo que ya está guardado en el navegador (RF-40). */
    function mapRowToProduct(row) {
        if (!row || typeof row !== 'object') return null;

        const id = toNumber(row.id);
        const price = toNumber(row.price_cup);
        const oldPriceValue = isBlank(row.old_price_cup) ? null : toNumber(row.old_price_cup);
        const oldPrice = oldPriceValue === null || oldPriceValue < 0 ? null : oldPriceValue;
        const rating = toNumber(row.rating);
        const reviews = toNumber(row.reviews);
        const stockValue = isBlank(row.stock) ? null : toNumber(row.stock);

        return {
            id: id === null ? null : id,
            name: typeof row.name === 'string' ? row.name : '',
            category: typeof row.category === 'string' ? row.category : 'General',
            badge: normalizeBadge(row.badge, oldPrice),
            price: price === null ? 0 : price,
            oldPrice: oldPrice,
            rating: rating === null ? 4.5 : Math.min(5, Math.max(0, rating)),
            reviews: reviews === null ? 0 : Math.max(0, Math.trunc(reviews)),
            image: typeof row.image_url === 'string' ? row.image_url : '',
            description: typeof row.description === 'string' ? row.description : '',
            specs: normalizeSpecs(row.specs),
            stock: stockValue === null ? null : Math.max(0, Math.trunc(stockValue)),
            active: row.active === false ? false : true
        };
    }

    /* Producto de cliente → fila de la tabla "products". El precio
       se guarda en CUP y con su equivalente en USD calculado con la
       tasa fija (RF-11), y la insignia de oferta se limpia si no
       hay precio anterior (RF-15), para que la base de datos nunca
       guarde una oferta falsa. El "id" no se incluye: lo asigna el
       servidor para los productos nuevos (RF-3). */
    function mapProductToRow(product, rate = DEFAULT_RATE) {
        const source = product && typeof product === 'object' ? product : {};

        const priceValue = toNumber(source.price);
        const priceCup = priceValue === null ? 0 : priceValue;

        const oldValue = isBlank(source.oldPrice) ? null : toNumber(source.oldPrice);
        const oldCup = oldValue === null || oldValue < 0 ? null : oldValue;

        const rating = toNumber(source.rating);
        const reviews = toNumber(source.reviews);
        const stockValue = isBlank(source.stock) ? null : toNumber(source.stock);

        return {
            price_cup: priceCup,
            price_usd: cupToUsd(priceCup, rate),
            old_price_cup: oldCup,
            old_price_usd: cupToUsd(oldCup, rate),
            image_url: typeof source.image === 'string' ? source.image : '',
            name: typeof source.name === 'string' ? source.name.trim() : '',
            category: typeof source.category === 'string' ? source.category.trim() : '',
            badge: normalizeBadge(source.badge, oldCup),
            rating: rating === null ? 4.5 : Math.min(5, Math.max(0, rating)),
            reviews: reviews === null ? 0 : Math.max(0, Math.trunc(reviews)),
            description: typeof source.description === 'string' ? source.description : '',
            specs: normalizeSpecs(source.specs),
            stock: stockValue === null ? null : Math.max(0, Math.trunc(stockValue)),
            active: source.active === false ? false : true
        };
    }

    /* Clave canónica del contenido de un producto: JSON con los
       campos que importan, siempre en el mismo orden. Sirve para
       saber si el contenido cambió DE VERDAD (y no solo por un
       detalle de formato o de orden de claves), igual que hace el
       disparador de versión en la base de datos (RF-6, RF-18). */
    function catalogContentKey(product) {
        const source = product && typeof product === 'object' ? product : {};

        const price = toNumber(source.price);
        const oldPrice = isBlank(source.oldPrice) ? null : toNumber(source.oldPrice);
        const rating = toNumber(source.rating);
        const reviews = toNumber(source.reviews);
        const stock = isBlank(source.stock) ? null : toNumber(source.stock);

        return JSON.stringify([
            String(source.name || ''),
            String(source.category || ''),
            String(source.badge || ''),
            price === null ? 0 : price,
            oldPrice,
            rating === null ? 0 : rating,
            reviews === null ? 0 : reviews,
            String(source.image || ''),
            String(source.description || ''),
            normalizeSpecs(source.specs),
            stock,
            source.active === false ? false : true
        ]);
    }

    /* ------------------------------------------------------------
       Copia local del catálogo (RF-39, RF-6, RF-38)
       ------------------------------------------------------------ */

    /* Un producto es utilizable si tiene nombre, categoría y un
       precio numérico: es la validación que se aplica a la copia
       local antes de usarla. */
    function isUsableProduct(product) {
        if (!product || typeof product !== 'object') return false;
        const name = typeof product.name === 'string' ? product.name.trim() : '';
        const category = typeof product.category === 'string' ? product.category.trim() : '';
        if (!name || !category) return false;
        const price = toNumber(product.price);
        return price !== null && price >= 0;
    }

    /* Valida una copia local ya parseada. Acepta el formato vigente
       { _format: 2, version, products } y también el array antiguo,
       que se trata como versión 0. Una copia corrupta (estructura
       desconocida, lista vacía o productos inválidos) se descarta
       con valid = false para que la tienda pueda seguir con el
       catálogo publicado (RF-39). */
    function normalizeLocalCopy(parsed) {
        const invalid = { valid: false, version: 0, products: [] };
        if (!parsed || typeof parsed !== 'object') return invalid;

        let list = null;
        let version = 0;

        if (Array.isArray(parsed)) {
            list = parsed;
        } else if (Array.isArray(parsed.products)) {
            list = parsed.products;
            const versionValue = toNumber(parsed.version);
            version = versionValue === null ? 0 : versionValue;
        } else {
            return invalid;
        }

        if (!Array.isArray(list) || list.length === 0) {
            return { valid: false, version: version, products: [] };
        }
        if (!list.every(isUsableProduct)) {
            return { valid: false, version: version, products: [] };
        }

        const products = list
            .map(product => normalizeProduct(product))
            .filter(product => product !== null);

        if (products.length === 0) {
            return { valid: false, version: version, products: [] };
        }

        return { valid: true, version: version, products: products };
    }

    /* Construye la copia local con el formato vigente: la marca de
       formato, la versión y el array de productos con los nombres
       de campo del cliente (RF-39). */
    function serializeLocalCopy(version, products) {
        const versionValue = toNumber(version);
        return {
            _format: 2,
            version: versionValue === null ? 0 : versionValue,
            products: Array.isArray(products) ? products : []
        };
    }

    /* Elige el catálogo que se muestra mientras la base de datos no
       responde (RF-35, RF-38): primero la copia local del navegador
       (el último catálogo conocido en ese navegador) y, si no hay
       copia o está corrupta, la semilla incluida en el sitio.

       La copia local se valida con normalizeLocalCopy: una copia con
       estructura desconocida o con productos inválidos se descarta
       en lugar de dejar la tienda en blanco. */
    function pickFallbackCatalog(localCopy, seed) {
        const seedData = seed && typeof seed === 'object' ? seed : {};
        const seedProducts = Array.isArray(seedData.products) ? seedData.products : [];
        const seedVersion = toNumber(seedData.version);

        const copy = normalizeLocalCopy(localCopy);
        if (copy.valid && copy.products.length > 0) {
            return {
                products: copy.products,
                version: copy.version,
                source: 'copy'
            };
        }

        return {
            products: seedProducts,
            version: seedVersion === null ? 0 : seedVersion,
            source: 'seed'
        };
    }

    /* ------------------------------------------------------------
       Importación de un catálogo (RF-20)
       ------------------------------------------------------------ */

    /* Explica en una frase por qué un producto del archivo no es
       válido, para que el mensaje de error sea útil. */
    function describeInvalidProduct(raw) {
        if (!raw || typeof raw !== 'object') return 'no es un objeto';
        if (!String(raw.name || '').trim()) return 'falta el nombre';
        if (!String(raw.category || '').trim()) return 'falta la categoría';
        const price = toNumber(raw.price);
        if (price === null) return 'el precio no es un número';
        if (price < 0) return 'el precio no puede ser negativo';
        return 'tiene campos inválidos';
    }

    /* Acepta el objeto maestro { catalog, version, products } y
       también el array plano de productos. Devuelve
       { ok, products, error }: un archivo mal formado o con
       productos inválidos se rechaza con un mensaje claro y SIN
       tocar la base de datos (RF-20). */
    function parseImportedCatalog(raw) {
        const fail = error => ({ ok: false, products: [], error: error });

        if (!raw || typeof raw !== 'object') {
            return fail('El archivo no contiene un catálogo válido.');
        }

        let list = null;
        if (Array.isArray(raw)) list = raw;
        else if (Array.isArray(raw.products)) list = raw.products;
        else return fail('El archivo no contiene un catálogo válido.');

        if (list.length === 0) {
            return fail('El catálogo del archivo está vacío.');
        }

        const products = [];
        for (let index = 0; index < list.length; index++) {
            const normalized = normalizeProduct(list[index]);
            if (!normalized) {
                return fail(
                    'El producto ' + (index + 1) + ' del archivo no es válido: ' +
                    describeInvalidProduct(list[index]) + '.'
                );
            }
            products.push(normalized);
        }

        return { ok: true, products: products, error: null };
    }

    /* ------------------------------------------------------------
       Imágenes: ruta local del repositorio frente a URL del bucket
       ------------------------------------------------------------ */

    /* Una imagen "remota" es una URL http(s): es lo que guarda la
       base de datos (el bucket). Cualquier otra cosa —una ruta local
       "img/...", una imagen embebida en base64 o un texto vacío— es
       la forma que usa el catálogo maestro del repositorio. */
    function isRemoteImage(image) {
        return typeof image === 'string' && /^https?:\/\//i.test(image.trim());
    }

    /* Decide si la imagen cambia al importar. El archivo manda solo
       si trae una URL: si trae una ruta local ("img/...") o nada, la
       imagen que ya está publicada en la base de datos se conserva.
       Sin esta regla, al importar el catálogo maestro TODO
       aparecería como actualizado (el maestro usa rutas locales y la
       base de datos guarda URLs del bucket). */
    function imageChanged(currentImage, importedImage) {
        const current = typeof currentImage === 'string' ? currentImage.trim() : '';
        const imported = typeof importedImage === 'string' ? importedImage.trim() : '';
        if (current === imported) return false;
        return isRemoteImage(imported);
    }

    /* Resuelve la imagen que hay que escribir al aplicar una
       importación: la URL del archivo si trae una; si no, la que ya
       está publicada; y en un alta sin URL, la imagen por defecto
       del bucket (nunca una ruta local del repositorio). */
    function resolveImportedImage(current, imported) {
        const importedImage = imported && typeof imported.image === 'string'
            ? imported.image.trim()
            : '';
        if (isRemoteImage(importedImage)) return importedImage;
        if (current && typeof current.image === 'string') return current.image.trim();
        return pickDefaultImage({ image: '' });
    }

    /* Prepara el producto que se escribe al aplicar una importación.
       El archivo manda en lo que trae; la base de datos manda en lo
       que el archivo NO trae (el formato del maestro no lleva
       existencias ni estado):
         · imagen: la URL del archivo si trae una; si trae una ruta
           local o nada, se conserva la que ya está publicada;
         · estado: un producto ya retirado no se reactiva al
           importar (republicarlo es una acción del panel);
         · existencias: si el archivo no las trae, se conservan las
           que ya hay. */
    function effectiveImportedProduct(current, imported, options) {
        const config = options && typeof options === 'object' ? options : {};
        const ignoreImage = config.ignoreImage !== false;
        const keepRetired = config.keepRetired !== false;

        const source = imported && typeof imported === 'object' ? imported : {};
        const base = current && typeof current === 'object' ? current : null;

        const image = ignoreImage
            ? resolveImportedImage(base, source)
            : (typeof source.image === 'string' ? source.image : '');

        const isRetired = base ? base.active === false : false;
        const active = (keepRetired && isRetired)
            ? false
            : (source.active === false ? false : true);

        const currentStock = base ? toNumber(base.stock) : null;
        const importedStock = isBlank(source.stock) ? null : toNumber(source.stock);
        const stock = (currentStock !== null && importedStock === null) ? currentStock : importedStock;

        return Object.assign({}, source, {
            image: image,
            active: active,
            stock: stock
        });
    }

    /* Compara el catálogo actual con el importado y reparte los
       productos en añadidos, actualizados, retirados e intactos.

       Opciones (las tres activas por defecto, porque son las reglas
       de la importación contra la base de datos):
         · ignoreImage — una imagen local del archivo ("img/...") o
           vacía NO cuenta como cambio cuando la base de datos ya
           tiene una URL del bucket;
         · matchByName — los productos sin id, o con un id que no
           existe en la base de datos, se emparejan por nombre: así
           importar dos veces el mismo archivo no duplica filas (el
           servidor asigna el id de las altas);
         · keepRetired — un producto ya retirado no se reactiva al
           importar.

       Los productos de "added" y "updated" son los PRODUCTOS
       EFECTIVOS (con la imagen, el estado y las existencias ya
       resueltos) listos para escribirse en la base de datos. */
    function diffCatalog(current, imported, options) {
        const config = options && typeof options === 'object' ? options : {};
        const matchByName = config.matchByName !== false;

        const currentList = Array.isArray(current) ? current : [];
        const importedList = Array.isArray(imported) ? imported : [];

        const currentById = new Map();
        const currentByName = new Map();
        currentList.forEach(product => {
            const id = product ? toNumber(product.id) : null;
            if (id !== null) currentById.set(id, product);
            const name = normalizeText(product && product.name);
            if (!name) return;
            if (!currentByName.has(name)) currentByName.set(name, []);
            currentByName.get(name).push(product);
        });

        const added = [];
        const updated = [];
        const unchanged = [];
        const matchedCurrentIds = new Set();

        importedList.forEach(product => {
            const id = product ? toNumber(product.id) : null;
            let match = (id !== null) ? currentById.get(id) : null;

            if (!match && matchByName) {
                const candidates = currentByName.get(normalizeText(product && product.name)) || [];
                if (candidates.length === 1) match = candidates[0];
            }

            if (!match) {
                added.push(effectiveImportedProduct(null, product, config));
                return;
            }

            const currentId = toNumber(match.id);
            matchedCurrentIds.add(currentId);

            const effective = effectiveImportedProduct(match, product, config);
            if (catalogContentKey(match) === catalogContentKey(effective)) {
                unchanged.push(effective);
            } else {
                effective.id = currentId;
                updated.push(effective);
            }
        });

        const removed = currentList.filter(product => {
            const id = product ? toNumber(product.id) : null;
            if (id === null || matchedCurrentIds.has(id)) return false;
            /* Un producto ya retirado no se vuelve a retirar: no hay
               nada que hacer y la importación sigue siendo
               idempotente. */
            return product.active !== false;
        });

        return {
            added: added,
            updated: updated,
            removed: removed,
            unchanged: unchanged
        };
    }

    /* La copia local está desfasada cuando la versión publicada es
       mayor que la que se guardó: entonces se sustituye por la
       publicada (RF-6, RF-38). */
    function isLocalCopyStale(localVersion, publishedVersion) {
        const published = toNumber(publishedVersion);
        if (published === null) return false;
        const local = toNumber(localVersion);
        return published > (local === null ? 0 : local);
    }

    /* ------------------------------------------------------------
       Carrito y favoritos: resolución contra el catálogo vigente
       (RF-40)
       ------------------------------------------------------------ */

    /* Resuelve las líneas guardadas (carrito o favoritos) contra el
       catálogo vigente: cada línea apunta al producto ACTUAL y usa
       su precio, porque la base de datos manda sobre lo que había
       guardado en el navegador (constitución, principio 5). Una línea
       cuyo producto ya no existe se OMITE en lugar de romper el
       resto del carrito.

       Si el catálogo está vacío (la tienda todavía no ha cargado
       nada), las líneas se devuelven tal y como estaban guardadas:
       no se pierde la vista del carrito mientras no hay catálogo con
       el que compararlas. */
    function resolveCatalogLines(items, catalog) {
        const list = Array.isArray(items) ? items : [];
        const current = Array.isArray(catalog) ? catalog : [];

        const byId = new Map();
        current.forEach(product => {
            if (!product || typeof product !== 'object') return;
            const id = toNumber(product.id);
            if (id === null || byId.has(id)) return;
            byId.set(id, product);
        });

        const resolved = [];
        list.forEach(item => {
            if (!item || typeof item !== 'object') return;
            const id = toNumber(item.id);
            if (id === null) return;

            const quantity = toNumber(item.quantity);
            const count = (quantity === null || quantity < 1) ? 1 : Math.trunc(quantity);
            const product = byId.get(id);

            if (!product) {
                /* El producto ya no existe en el catálogo: la línea se
                   omite (solo si hay catálogo con el que comparar). */
                if (current.length > 0) return;
                resolved.push({
                    id: id,
                    name: typeof item.name === 'string' ? item.name : '',
                    image: typeof item.image === 'string' ? item.image : '',
                    price: priceOf(item),
                    quantity: count,
                    soldOut: isSoldOut(item),
                    product: null
                });
                return;
            }

            const image = typeof product.image === 'string' && product.image
                ? product.image
                : (typeof item.image === 'string' ? item.image : '');

            resolved.push({
                id: id,
                name: String(product.name || item.name || ''),
                image: image,
                price: priceOf(product),
                quantity: count,
                soldOut: isSoldOut(product),
                product: product
            });
        });

        return resolved;
    }

    /* ------------------------------------------------------------
       Filtrado y orden de la tienda (RF-33)
       ------------------------------------------------------------ */

    /* Filtra por categoría y busca por nombre, categoría o
       descripción; después ordena por precio ascendente, precio
       descendente o valoración. Es la misma semántica que usa hoy
       la tienda: con una búsqueda activa la categoría se ignora
       (buscar "cable" encuentra cables de cualquier categoría) y
       sin orden explícito se conserva el orden de entrada. */
    function filterAndSort(products, options) {
        const list = Array.isArray(products) ? products.slice() : [];
        const config = options && typeof options === 'object' ? options : {};

        const category = typeof config.category === 'string' ? config.category.trim() : '';
        const query = normalizeText(typeof config.query === 'string' ? config.query.trim() : '');
        const sort = typeof config.sort === 'string' ? config.sort : '';

        const filtered = list.filter(product => {
            if (!product || typeof product !== 'object') return false;
            const productCategory = String(product.category || '');
            const matchesCategory = query
                || !category
                || category.toLowerCase() === 'todos'
                || productCategory.toLowerCase() === category.toLowerCase();
            const matchesSearch = !query
                || normalizeText(String(product.name || '')).includes(query)
                || normalizeText(productCategory).includes(query)
                || normalizeText(String(product.description || '')).includes(query);
            return matchesCategory && matchesSearch;
        });

        if (sort === 'low-high') {
            filtered.sort((a, b) => priceOf(a) - priceOf(b));
        } else if (sort === 'high-low') {
            filtered.sort((a, b) => priceOf(b) - priceOf(a));
        } else if (sort === 'rating') {
            filtered.sort((a, b) => ratingOf(b) - ratingOf(a));
        }

        return filtered;
    }

    /* ------------------------------------------------------------
       Imagen del producto (RF-12)
       ------------------------------------------------------------ */

    /* Devuelve la imagen del producto y, si no tiene ninguna, la
       imagen por defecto del bucket. La URL del proyecto se puede
       pasar como argumento; si no, se usa la URL pública
       configurada. */
    function pickDefaultImage(product, supabaseUrl) {
        const image = product && typeof product === 'object' && typeof product.image === 'string'
            ? product.image.trim()
            : '';
        if (image) return image;
        const base = typeof supabaseUrl === 'string' && supabaseUrl.trim()
            ? supabaseUrl.trim().replace(/\/+$/, '')
            : DEFAULT_SUPABASE_URL;
        return base + DEFAULT_IMAGE_PATH;
    }


    /* ------------------------------------------------------------
        Validación y formato de la tasa (RF-07)
        ------------------------------------------------------------ */

    function validateExchangeRate(value) {
        const num = toNumber(value);
        if (num === null) {
            return { ok: false, value: null, message: 'La tasa debe ser un número.' };
        }
        if (!Number.isFinite(num)) {
            return { ok: false, value: null, message: 'La tasa debe ser un número finito.' };
        }
        if (num <= 0) {
            return { ok: false, value: null, message: 'La tasa debe ser mayor que cero.' };
        }
        const text = String(value).trim();
        const dot = text.indexOf('.');
        if (dot !== -1 && text.length - dot - 1 > 2) {
            return { ok: false, value: null, message: 'La tasa debe tener como máximo dos decimales.' };
        }
        return { ok: true, value: num, message: '' };
    }

    function formatRate(rate) {
        const num = toNumber(rate);
        if (num === null || !Number.isFinite(num) || num <= 0) return '';
        return formatNumberEs(num, 0) + ' CUP = 1 USD';
    }

    /* ------------------------------------------------------------
        Fecha inyectada (sin Date ni zona horaria) (RNF-04)
        ------------------------------------------------------------ */

    function dateKey(isoString) {
        if (typeof isoString !== 'string' || isoString.length < 10) return '';
        const key = isoString.slice(0, 10);
        return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : '';
    }

    /* ------------------------------------------------------------
        Funciones contables puras (RF-03, RF-05, RF-07, RF-08)
        ------------------------------------------------------------ */

    function saleTotals(items, rate) {
        const r = (typeof rate === 'number' && Number.isFinite(rate) && rate > 0) ? rate : DEFAULT_RATE;
        const list = Array.isArray(items) ? items : [];
        let totalCup = 0;
        let totalProfit = 0;
        for (let index = 0; index < list.length; index++) {
            const item = list[index];
            if (!item || typeof item !== 'object') continue;
            const qty = toNumber(item.qty);
            if (qty === null || qty <= 0) continue;
            const unitPrice = toNumber(item.unit_price);
            if (unitPrice === null) continue;
            const costPrice = toNumber(item.cost_price);
            const cost = costPrice === null || costPrice < 0 ? 0 : costPrice;
            totalCup += qty * unitPrice;
            totalProfit += qty * (unitPrice - cost);
        }
        const totalUsd = round2(totalCup / r);
        const rateValid = rate === undefined ? true : (typeof rate === 'number' && Number.isFinite(rate) && rate > 0);
        return {
            totalCup: round2(totalCup),
            totalUsd: rateValid ? totalUsd : null,
            totalProfit: round2(totalProfit)
        };
    }

    function salesSummary(sales, options) {
        const list = Array.isArray(sales) ? sales : [];
        const config = options && typeof options === 'object' ? options : {};
        const todayKey = typeof config.todayKey === 'string' ? config.todayKey : '';
        const monthKey = typeof config.monthKey === 'string' ? config.monthKey : '';
        let countToday = 0, countMonth = 0;
        let cupToday = 0, cupMonth = 0;
        let usdToday = 0, usdMonth = 0;
        let profitToday = 0, profitMonth = 0;
        for (let index = 0; index < list.length; index++) {
            const sale = list[index];
            if (!sale || typeof sale !== 'object') continue;
            const key = dateKey(sale.created_at);
            const cup = toNumber(sale.total_cup);
            const usd = toNumber(sale.total_usd);
            const profit = toNumber(sale.total_profit);
            const cupVal = cup === null ? 0 : cup;
            const usdVal = usd === null ? 0 : usd;
            const profitVal = profit === null ? 0 : profit;
            if (key === todayKey) {
                countToday += 1; cupToday += cupVal; usdToday += usdVal; profitToday += profitVal;
            }
            if (monthKey && key.indexOf(monthKey) === 0) {
                countMonth += 1; cupMonth += cupVal; usdMonth += usdVal; profitMonth += profitVal;
            }
        }
        return {
            countToday, countMonth,
            cupToday: round2(cupToday), cupMonth: round2(cupMonth),
            usdToday: round2(usdToday), usdMonth: round2(usdMonth),
            profitToday: round2(profitToday), profitMonth: round2(profitMonth)
        };
    }

    function paymentBreakdown(sales) {
        const list = Array.isArray(sales) ? sales : [];
        const res = { cashCup: 0, digitalCup: 0, cashCount: 0, digitalCount: 0 };
        for (let index = 0; index < list.length; index++) {
            const sale = list[index];
            if (!sale || typeof sale !== 'object') continue;
            const cup = toNumber(sale.total_cup);
            const cupVal = cup === null ? 0 : cup;
            const m = typeof sale.payment_method === 'string' ? sale.payment_method.trim().toUpperCase() : '';
            if (m === 'EFECTIVO') { res.cashCup += cupVal; res.cashCount += 1; }
            else if (m === 'DIGITAL') { res.digitalCup += cupVal; res.digitalCount += 1; }
        }
        return { cashCup: round2(res.cashCup), digitalCup: round2(res.digitalCup), cashCount: res.cashCount, digitalCount: res.digitalCount };
    }

    function originBreakdown(sales) {
        const list = Array.isArray(sales) ? sales : [];
        const res = { onlineCup: 0, physicalCup: 0, onlineCount: 0, physicalCount: 0 };
        for (let index = 0; index < list.length; index++) {
            const sale = list[index];
            if (!sale || typeof sale !== 'object') continue;
            const cup = toNumber(sale.total_cup);
            const cupVal = cup === null ? 0 : cup;
            const o = typeof sale.origin === 'string' ? sale.origin.trim().toUpperCase() : '';
            if (o === 'ONLINE') { res.onlineCup += cupVal; res.onlineCount += 1; }
            else if (o === 'FISICO' || o === 'FÍSICO') { res.physicalCup += cupVal; res.physicalCount += 1; }
        }
        return { onlineCup: round2(res.onlineCup), physicalCup: round2(res.physicalCup), onlineCount: res.onlineCount, physicalCount: res.physicalCount };
    }

    function expensesSummary(expenses, options) {
        const list = Array.isArray(expenses) ? expenses : [];
        const config = options && typeof options === 'object' ? options : {};
        const todayKey = typeof config.todayKey === 'string' ? config.todayKey : '';
        const monthKey = typeof config.monthKey === 'string' ? config.monthKey : '';
        let cupToday = 0, cupMonth = 0, countToday = 0, countMonth = 0;
        for (let index = 0; index < list.length; index++) {
            const expense = list[index];
            if (!expense || typeof expense !== 'object') continue;
            const key = dateKey(expense.created_at);
            const amount = toNumber(expense.amount_cup);
            const cupVal = amount === null ? 0 : amount;
            if (key === todayKey) { countToday += 1; cupToday += cupVal; }
            if (monthKey && key.indexOf(monthKey) === 0) { countMonth += 1; cupMonth += cupVal; }
        }
        return { cupToday: round2(cupToday), cupMonth: round2(cupMonth), countToday, countMonth };
    }

    function netBalance(sales, expenses, options) {
        const config = options && typeof options === 'object' ? options : {};
        const today = config.todayKey || '';
        const month = config.monthKey || '';
        let profitToday = 0, profitMonth = 0;
        const salesData = Array.isArray(sales) ? sales : [];
        for (let index = 0; index < salesData.length; index++) {
            const sale = salesData[index];
            if (!sale || typeof sale !== 'object') continue;
            const key = dateKey(sale.created_at);
            const profit = toNumber(sale.total_profit);
            const pVal = profit === null ? 0 : profit;
            if (key === today) profitToday += pVal;
            if (month && key.indexOf(month) === 0) profitMonth += pVal;
        }
        let cupTodayExpenses = 0, cupMonthExpenses = 0;
        const expensesData = Array.isArray(expenses) ? expenses : [];
        for (let index = 0; index < expensesData.length; index++) {
            const expense = expensesData[index];
            if (!expense || typeof expense !== 'object') continue;
            const key = dateKey(expense.created_at);
            const amount = toNumber(expense.amount_cup);
            const aVal = amount === null ? 0 : amount;
            if (key === today) cupTodayExpenses += aVal;
            if (month && key.indexOf(month) === 0) cupMonthExpenses += aVal;
        }
        return { cupToday: round2(profitToday - cupTodayExpenses), cupMonth: round2(profitMonth - cupMonthExpenses) };
    }


    /* ------------------------------------------------------------
        Dashboard: agregados por día y por mes (zona horaria inyectada)
        ------------------------------------------------------------ */

    /* Fecha local "AAAA-MM-DD" de un instante ISO. tzOffsetMin es el
       valor de Date.getTimezoneOffset() (minutos UTC − local; La
       Habana, UTC-4 → 240). Sin reloj: solo interpreta el texto que
       recibe. Corrige que una venta de las 22:00 locales caiga en el
       día siguiente al cortar el ISO en UTC. */
    function localDateKey(iso, tzOffsetMin) {
        if (typeof iso !== 'string') return '';
        const ms = Date.parse(iso);
        if (!Number.isFinite(ms)) return '';
        const off = Number.isFinite(tzOffsetMin) ? tzOffsetMin : 0;
        return new Date(ms - off * 60000).toISOString().slice(0, 10);
    }

    function shiftMonthKey(monthKey, delta) {
        const year = Number(monthKey.slice(0, 4));
        const month = Number(monthKey.slice(5, 7)) - 1 + delta;
        const date = new Date(Date.UTC(year, month, 1));
        return date.toISOString().slice(0, 7);
    }

    function shiftDayKey(dayKey, delta) {
        const year = Number(dayKey.slice(0, 4));
        const month = Number(dayKey.slice(5, 7)) - 1;
        const day = Number(dayKey.slice(8, 10)) + delta;
        return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
    }

    /* Variación porcentual con un decimal; null si no hay base. */
    function percentChange(current, previous) {
        if (!(previous > 0)) return null;
        return Math.round(((current - previous) / previous) * 1000) / 10;
    }

    /* Todo lo que pinta el dashboard, calculado de una vez.
       options: { todayKey, tzOffsetMin, months = 6, days = 30 }.
       Las tendencias comparan el mes en curso con el MISMO tramo
       (día 1 al día de hoy) del mes anterior, para no comparar un mes
       a medias con uno completo. */
    function dashboardData(sales, expenses, options) {
        const config = options && typeof options === 'object' ? options : {};
        const todayKey = typeof config.todayKey === 'string' ? config.todayKey : '';
        const tz = Number.isFinite(config.tzOffsetMin) ? config.tzOffsetMin : 0;
        const monthsCount = config.months > 0 ? Math.trunc(config.months) : 6;
        const daysCount = config.days > 0 ? Math.trunc(config.days) : 30;
        const monthKey = todayKey.slice(0, 7);
        const prevMonthKey = monthKey ? shiftMonthKey(monthKey, -1) : '';
        const dayOfMonth = Number(todayKey.slice(8, 10)) || 0;

        const byDay = new Map();
        const byMonth = new Map();
        const bump = (map, key, revenue, usd, profit) => {
            const row = map.get(key) || { revenue: 0, usd: 0, profit: 0, orders: 0 };
            row.revenue += revenue; row.usd += usd; row.profit += profit; row.orders += 1;
            map.set(key, row);
        };

        const payment = { cash: { cup: 0, count: 0 }, digital: { cup: 0, count: 0 }, other: { cup: 0, count: 0 } };
        const origin = { physical: { cup: 0, count: 0 }, online: { cup: 0, count: 0 }, other: { cup: 0, count: 0 } };

        (Array.isArray(sales) ? sales : []).forEach(sale => {
            if (!sale || typeof sale !== 'object') return;
            const key = localDateKey(sale.created_at, tz);
            if (!key) return;
            const cup = toNumber(sale.total_cup) || 0;
            const usd = toNumber(sale.total_usd) || 0;
            const profit = toNumber(sale.total_profit) || 0;
            bump(byDay, key, cup, usd, profit);
            bump(byMonth, key.slice(0, 7), cup, usd, profit);
            if (key.slice(0, 7) !== monthKey) return;
            const method = String(sale.payment_method || '').trim().toUpperCase();
            const bucketP = method === 'EFECTIVO' ? payment.cash : method === 'DIGITAL' ? payment.digital : payment.other;
            bucketP.cup += cup; bucketP.count += 1;
            const where = String(sale.origin || '').trim().toUpperCase();
            const bucketO = (where === 'FISICO' || where === 'FÍSICO') ? origin.physical : where === 'ONLINE' ? origin.online : origin.other;
            bucketO.cup += cup; bucketO.count += 1;
        });

        const expByDay = new Map();
        const expByMonth = new Map();
        (Array.isArray(expenses) ? expenses : []).forEach(expense => {
            if (!expense || typeof expense !== 'object') return;
            const key = localDateKey(expense.created_at, tz);
            if (!key) return;
            const amount = toNumber(expense.amount_cup) || 0;
            expByDay.set(key, (expByDay.get(key) || 0) + amount);
            expByMonth.set(key.slice(0, 7), (expByMonth.get(key.slice(0, 7)) || 0) + amount);
        });

        const empty = { revenue: 0, usd: 0, profit: 0, orders: 0 };
        const today = byDay.get(todayKey) || empty;
        const month = byMonth.get(monthKey) || empty;

        /* Mismo tramo del mes anterior (día 1 … día de hoy). */
        const prevSpan = { revenue: 0, profit: 0, orders: 0, expenses: 0 };
        byDay.forEach((row, key) => {
            if (key.slice(0, 7) === prevMonthKey && Number(key.slice(8, 10)) <= dayOfMonth) {
                prevSpan.revenue += row.revenue; prevSpan.profit += row.profit; prevSpan.orders += row.orders;
            }
        });
        expByDay.forEach((amount, key) => {
            if (key.slice(0, 7) === prevMonthKey && Number(key.slice(8, 10)) <= dayOfMonth) prevSpan.expenses += amount;
        });

        const monthExpenses = expByMonth.get(monthKey) || 0;
        const todayExpenses = expByDay.get(todayKey) || 0;
        const netMonth = month.profit - monthExpenses;
        const netPrev = prevSpan.profit - prevSpan.expenses;

        const monthSeries = [];
        for (let i = monthsCount - 1; i >= 0; i--) {
            const key = shiftMonthKey(monthKey, -i);
            const row = byMonth.get(key) || empty;
            monthSeries.push({ key: key, month: Number(key.slice(5, 7)) - 1, revenue: round2(row.revenue), profit: round2(row.profit), orders: row.orders });
        }
        const daySeries = [];
        for (let i = daysCount - 1; i >= 0; i--) {
            const key = shiftDayKey(todayKey, -i);
            const row = byDay.get(key) || empty;
            daySeries.push({ key: key, revenue: round2(row.revenue), profit: round2(row.profit), orders: row.orders });
        }

        const rounded = list => {
            const out = {};
            Object.keys(list).forEach(k => { out[k] = { cup: round2(list[k].cup), count: list[k].count }; });
            return out;
        };

        return {
            today: { revenue: round2(today.revenue), usd: round2(today.usd), profit: round2(today.profit), orders: today.orders, expenses: round2(todayExpenses), net: round2(today.profit - todayExpenses) },
            month: { revenue: round2(month.revenue), usd: round2(month.usd), profit: round2(month.profit), orders: month.orders, expenses: round2(monthExpenses), net: round2(netMonth) },
            trends: {
                revenue: percentChange(month.revenue, prevSpan.revenue),
                orders: percentChange(month.orders, prevSpan.orders),
                net: netPrev > 0 ? percentChange(netMonth, netPrev) : null
            },
            series: { months: monthSeries, days: daySeries },
            payment: rounded(payment),
            origin: rounded(origin)
        };
    }

    /* Productos más vendidos a partir de líneas de venta { product_id, qty }.
       Devuelve [{ id, units }] ordenado de mayor a menor. */
    function topProductsByUnits(lines, limit) {
        const totals = new Map();
        (Array.isArray(lines) ? lines : []).forEach(line => {
            if (!line || typeof line !== 'object') return;
            const id = toNumber(line.product_id);
            const qty = toNumber(line.qty);
            if (id === null || qty === null || qty <= 0) return;
            totals.set(id, (totals.get(id) || 0) + qty);
        });
        const max = limit > 0 ? Math.trunc(limit) : 5;
        return Array.from(totals.entries())
            .map(entry => ({ id: entry[0], units: entry[1] }))
            .sort((a, b) => (b.units - a.units) || (a.id - b.id))
            .slice(0, max);
    }

    /* ------------------------------------------------------------
       API pública
       ------------------------------------------------------------ */
    return {
        DEFAULT_RATE: DEFAULT_RATE,
        PRICE_RATE: PRICE_RATE,
        cupToUsd: cupToUsd,
        usdToCup: usdToCup,
        formatCup: formatCup,
        formatUsd: formatUsd,
        validateExchangeRate: validateExchangeRate,
        formatRate: formatRate,
        dateKey: dateKey,
        saleTotals: saleTotals,
        salesSummary: salesSummary,
        paymentBreakdown: paymentBreakdown,
        originBreakdown: originBreakdown,
        expensesSummary: expensesSummary,
        netBalance: netBalance,
        localDateKey: localDateKey,
        dashboardData: dashboardData,
        topProductsByUnits: topProductsByUnits,
        normalizeBadge: normalizeBadge,
        shouldShowOldPrice: shouldShowOldPrice,
        isSoldOut: isSoldOut,
        canAddToCart: canAddToCart,
        validateProductForm: validateProductForm,
        normalizeProduct: normalizeProduct,
        mapRowToProduct: mapRowToProduct,
        mapProductToRow: mapProductToRow,
        catalogContentKey: catalogContentKey,
        normalizeLocalCopy: normalizeLocalCopy,
        serializeLocalCopy: serializeLocalCopy,
        pickFallbackCatalog: pickFallbackCatalog,
        parseImportedCatalog: parseImportedCatalog,
        diffCatalog: diffCatalog,
        isRemoteImage: isRemoteImage,
        imageChanged: imageChanged,
        resolveImportedImage: resolveImportedImage,
        effectiveImportedProduct: effectiveImportedProduct,
        isLocalCopyStale: isLocalCopyStale,
        filterAndSort: filterAndSort,
        resolveCatalogLines: resolveCatalogLines,
        pickDefaultImage: pickDefaultImage
    };
});
