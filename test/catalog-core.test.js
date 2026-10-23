/* ============================================================
   VentasCel · test/catalog-core.test.js
   ------------------------------------------------------------
   Suite de tests de la lógica pura del catálogo (RNF-8).

   Solo módulos nativos: `node:test` + `node:assert/strict`.
   Sin dependencias npm (constitución, principio 1) y sin
   navegador: `catalog-core.js` no toca el DOM, la red, el
   almacenamiento ni el reloj (constitución, principio 3).

   Ejecución: `npm test` (o `node --test`).
   ============================================================ */

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const core = require('../catalog-core.js');

/* Producto de cliente completo, para partir de una base conocida. */
function sampleProduct(overrides) {
    return Object.assign({
        id: 1,
        name: 'Cable USB-C',
        category: 'Accesorios',
        badge: '',
        price: 1500,
        oldPrice: null,
        rating: 4.5,
        reviews: 10,
        image: 'https://example.test/cable.jpg',
        description: 'Cable de carga rápida',
        specs: ['1 metro', 'USB-C'],
        stock: null,
        active: true
    }, overrides || {});
}

/* Fila de la tabla `products` de la base de datos. */
function sampleRow(overrides) {
    return Object.assign({
        id: 1,
        name: 'Cable USB-C',
        category: 'Accesorios',
        badge: '',
        price_cup: 1500,
        price_usd: 3.75,
        old_price_cup: null,
        old_price_usd: null,
        rating: 4.5,
        reviews: 10,
        image_url: 'https://example.test/cable.jpg',
        description: 'Cable de carga rápida',
        specs: ['1 metro', 'USB-C'],
        stock: null,
        active: true
    }, overrides || {});
}

/* ------------------------------------------------------------
   Precios CUP / USD (RF-11, RNF-11)
   ------------------------------------------------------------ */

describe('conversión CUP/USD', () => {
    it('usa PRICE_RATE = DEFAULT_RATE = 820', () => {
        assert.strictEqual(core.PRICE_RATE, 820);
        assert.strictEqual(core.DEFAULT_RATE, 820);
    });

    it('convierte 820 CUP a 1 USD y 1640 CUP a 2 USD con la tasa de 820', () => {
        assert.strictEqual(core.cupToUsd(820), 1);
        assert.strictEqual(core.cupToUsd(1640), 2);
        assert.strictEqual(core.usdToCup(1), 820);
        assert.strictEqual(core.usdToCup(2), 1640);
    });

    it('convierte con una tasa distinta pasada como argumento', () => {
        assert.strictEqual(core.cupToUsd(1500, 400), 3.75);
        assert.strictEqual(core.usdToCup(3.75, 400), 1500);
        assert.strictEqual(core.cupToUsd(1500, 900), 1.67);
    });

    it('redondea a dos decimales con la tasa por defecto (820)', () => {
        assert.strictEqual(core.cupToUsd(1501), 1.83);
        assert.strictEqual(core.cupToUsd(201), 0.25);
        assert.strictEqual(core.cupToUsd(1), 0);
        assert.strictEqual(core.usdToCup(0.01), 8.2);
        assert.strictEqual(core.usdToCup(3.755), 3079.1);
    });

    it('acepta el precio como texto numérico', () => {
        assert.strictEqual(core.cupToUsd('820'), 1);
        assert.strictEqual(core.usdToCup('1'), 820);
    });

    it('devuelve null cuando no hay precio (no es lo mismo que 0)', () => {
        assert.strictEqual(core.cupToUsd(null), null);
        assert.strictEqual(core.cupToUsd(undefined), null);
        assert.strictEqual(core.cupToUsd(''), null);
        assert.strictEqual(core.cupToUsd('abc'), null);
        assert.strictEqual(core.usdToCup(null), null);
    });

    it('formatea los precios con separador de millares y coma decimal', () => {
        assert.strictEqual(core.formatCup(1500), '1.500 CUP');
        assert.strictEqual(core.formatCup(1500.5), '1.500,50 CUP');
        assert.strictEqual(core.formatCup(0), '0 CUP');
        assert.strictEqual(core.formatUsd(3.75), '3,75 USD');
        assert.strictEqual(core.formatUsd(0), '0,00 USD');
    });

    it('formatea a texto vacío cuando no hay valor', () => {
        assert.strictEqual(core.formatCup(null), '');
        assert.strictEqual(core.formatUsd(null), '');
        assert.strictEqual(core.formatCup('abc'), '');
    });
});

/* ------------------------------------------------------------
   Etiqueta de oferta y precio anterior (RF-15, RF-16)
   ------------------------------------------------------------ */

describe('etiqueta de oferta', () => {
    it('limpia la etiqueta de oferta cuando no hay precio anterior', () => {
        assert.strictEqual(core.normalizeBadge('Oferta', null), '');
        assert.strictEqual(core.normalizeBadge('¡Oferta!', null), '');
        assert.strictEqual(core.normalizeBadge('oferta', 0), '');
    });

    it('conserva la etiqueta de oferta si hay precio anterior', () => {
        assert.strictEqual(core.normalizeBadge('¡Oferta!', 2000), '¡Oferta!');
    });

    it('conserva el resto de etiquetas siempre', () => {
        assert.strictEqual(core.normalizeBadge('Nuevo', null), 'Nuevo');
        assert.strictEqual(core.normalizeBadge('  Popular  ', null), 'Popular');
    });

    it('devuelve texto vacío cuando no hay etiqueta', () => {
        assert.strictEqual(core.normalizeBadge('', 2000), '');
        assert.strictEqual(core.normalizeBadge(null, 2000), '');
        assert.strictEqual(core.normalizeBadge(undefined, 2000), '');
    });
});

describe('precio anterior', () => {
    it('solo se muestra si es MAYOR que el precio actual', () => {
        assert.strictEqual(core.shouldShowOldPrice(1000, 1500), true);
        assert.strictEqual(core.shouldShowOldPrice(1000, 1000), false);
        assert.strictEqual(core.shouldShowOldPrice(1000, 500), false);
    });

    it('no se muestra si falta alguno de los dos precios', () => {
        assert.strictEqual(core.shouldShowOldPrice(1000, null), false);
        assert.strictEqual(core.shouldShowOldPrice(null, 1500), false);
        assert.strictEqual(core.shouldShowOldPrice(undefined, undefined), false);
    });

    it('acepta los precios como texto', () => {
        assert.strictEqual(core.shouldShowOldPrice('1000', '1500'), true);
    });
});

/* ------------------------------------------------------------
   Existencias y disponibilidad (RF-34)
   ------------------------------------------------------------ */

describe('agotado', () => {
    it('agotado es existencias iguales a cero', () => {
        assert.strictEqual(core.isSoldOut({ stock: 0 }), true);
    });

    it('con existencias nulas el producto NO está agotado', () => {
        assert.strictEqual(core.isSoldOut({ stock: null }), false);
        assert.strictEqual(core.isSoldOut({ stock: undefined }), false);
        assert.strictEqual(core.isSoldOut({ stock: '' }), false);
    });

    it('con existencias mayores que cero el producto NO está agotado', () => {
        assert.strictEqual(core.isSoldOut({ stock: 5 }), false);
        assert.strictEqual(core.isSoldOut({ stock: '5' }), false);
    });

    it('no falla con valores que no son productos', () => {
        assert.strictEqual(core.isSoldOut(null), false);
        assert.strictEqual(core.isSoldOut('x'), false);
    });
});

describe('canAddToCart', () => {
    it('permite añadir un producto activo con precio y existencias', () => {
        assert.strictEqual(core.canAddToCart({ price: 1500, stock: 5, active: true }), true);
    });

    it('no permite añadir un producto agotado', () => {
        assert.strictEqual(core.canAddToCart({ price: 1500, stock: 0, active: true }), false);
    });

    it('permite añadir un producto sin control de existencias', () => {
        assert.strictEqual(core.canAddToCart({ price: 1500, stock: null, active: true }), true);
    });

    it('no permite añadir un producto retirado', () => {
        assert.strictEqual(core.canAddToCart({ price: 1500, stock: null, active: false }), false);
    });

    it('permite un precio de 0 (es un valor legítimo)', () => {
        assert.strictEqual(core.canAddToCart({ price: 0, stock: null, active: true }), true);
    });

    it('no permite añadir un producto sin precio', () => {
        assert.strictEqual(core.canAddToCart({ price: null, active: true }), false);
        assert.strictEqual(core.canAddToCart({ active: true }), false);
        assert.strictEqual(core.canAddToCart(null), false);
    });
});

/* ------------------------------------------------------------
   Validación del formulario del panel (RF-14)
   ------------------------------------------------------------ */

describe('validación del formulario', () => {
    it('acepta un formulario completo y válido', () => {
        const result = core.validateProductForm({
            name: 'Cable USB-C',
            category: 'Accesorios',
            price: 1500,
            oldPrice: 2000,
            stock: 5,
            rating: 4.5,
            reviews: 10
        });
        assert.strictEqual(result.valid, true);
        assert.deepStrictEqual(result.errors, []);
    });

    it('acepta el precio como texto numérico', () => {
        const result = core.validateProductForm({ name: 'A', category: 'B', price: '1500' });
        assert.strictEqual(result.valid, true);
    });

    it('exige nombre y categoría', () => {
        const result = core.validateProductForm({ price: 100 });
        assert.strictEqual(result.valid, false);
        assert.deepStrictEqual(result.errors.map(e => e.campo).sort(), ['category', 'name']);
    });

    it('trata un nombre en blanco como nombre ausente', () => {
        const result = core.validateProductForm({ name: '   ', category: 'B', price: 100 });
        assert.strictEqual(result.valid, false);
        assert.strictEqual(result.errors[0].campo, 'name');
    });

    it('exige un precio y explica cada problema', () => {
        const vacio = core.validateProductForm({ name: 'A', category: 'B' });
        assert.strictEqual(vacio.valid, false);
        assert.strictEqual(vacio.errors[0].campo, 'price');
        assert.strictEqual(vacio.errors[0].mensaje, 'El precio es obligatorio.');

        const texto = core.validateProductForm({ name: 'A', category: 'B', price: 'abc' });
        assert.strictEqual(texto.valid, false);
        assert.strictEqual(texto.errors[0].mensaje, 'El precio debe ser un número.');

        const negativo = core.validateProductForm({ name: 'A', category: 'B', price: -1 });
        assert.strictEqual(negativo.valid, false);
        assert.strictEqual(negativo.errors[0].mensaje, 'El precio no puede ser negativo.');
    });

    it('exige que el precio anterior sea mayor que el actual', () => {
        const igual = core.validateProductForm({ name: 'A', category: 'B', price: 100, oldPrice: 100 });
        assert.strictEqual(igual.valid, false);
        assert.strictEqual(igual.errors[0].campo, 'oldPrice');
        assert.strictEqual(igual.errors[0].mensaje, 'El precio anterior debe ser mayor que el precio actual.');

        const menor = core.validateProductForm({ name: 'A', category: 'B', price: 100, oldPrice: 50 });
        assert.strictEqual(menor.valid, false);
    });

    it('acepta el precio anterior vacío (no hay precio anterior)', () => {
        const result = core.validateProductForm({ name: 'A', category: 'B', price: 100, oldPrice: '' });
        assert.strictEqual(result.valid, true);
    });

    it('rechaza un precio anterior que no es un número', () => {
        const result = core.validateProductForm({ name: 'A', category: 'B', price: 100, oldPrice: 'abc' });
        assert.strictEqual(result.valid, false);
        assert.strictEqual(result.errors[0].mensaje, 'El precio anterior debe ser un número.');
    });

    it('exige existencias enteras no negativas', () => {
        const decimal = core.validateProductForm({ name: 'A', category: 'B', price: 100, stock: '1.5' });
        assert.strictEqual(decimal.valid, false);
        assert.strictEqual(decimal.errors[0].mensaje, 'Las existencias deben ser un número entero.');

        const negativo = core.validateProductForm({ name: 'A', category: 'B', price: 100, stock: -1 });
        assert.strictEqual(negativo.valid, false);
        assert.strictEqual(negativo.errors[0].mensaje, 'Las existencias no pueden ser negativas.');

        const vacio = core.validateProductForm({ name: 'A', category: 'B', price: 100, stock: '' });
        assert.strictEqual(vacio.valid, true);
    });

    it('exige una valoración entre 0 y 5', () => {
        const alta = core.validateProductForm({ name: 'A', category: 'B', price: 100, rating: 6 });
        assert.strictEqual(alta.valid, false);
        assert.strictEqual(alta.errors[0].mensaje, 'La valoración debe estar entre 0 y 5.');

        const valida = core.validateProductForm({ name: 'A', category: 'B', price: 100, rating: 5 });
        assert.strictEqual(valida.valid, true);
    });

    it('exige reseñas enteras no negativas', () => {
        const decimal = core.validateProductForm({ name: 'A', category: 'B', price: 100, reviews: 1.5 });
        assert.strictEqual(decimal.valid, false);
        assert.strictEqual(decimal.errors[0].mensaje, 'El número de reseñas debe ser un número entero.');

        const negativo = core.validateProductForm({ name: 'A', category: 'B', price: 100, reviews: -3 });
        assert.strictEqual(negativo.valid, false);
        assert.strictEqual(negativo.errors[0].mensaje, 'El número de reseñas no puede ser negativo.');
    });

    it('acumula varios errores y no falla con un formulario vacío', () => {
        const result = core.validateProductForm({});
        assert.strictEqual(result.valid, false);
        assert.ok(result.errors.length >= 3);
        assert.ok(result.errors.every(e => typeof e.campo === 'string' && typeof e.mensaje === 'string'));

        const nulo = core.validateProductForm(null);
        assert.strictEqual(nulo.valid, false);
        assert.ok(nulo.errors.length > 0);
    });
});

/* ------------------------------------------------------------
   Normalización de productos (RF-14, RF-39)
   ------------------------------------------------------------ */

describe('normalización de producto', () => {
    it('normaliza un producto válido y rellena los valores por defecto', () => {
        const product = core.normalizeProduct({
            id: 7,
            name: '  Cable USB-C  ',
            category: ' Accesorios ',
            price: '1500'
        });
        assert.strictEqual(product.id, 7);
        assert.strictEqual(product.name, 'Cable USB-C');
        assert.strictEqual(product.category, 'Accesorios');
        assert.strictEqual(product.price, 1500);
        assert.strictEqual(product.oldPrice, null);
        assert.strictEqual(product.badge, '');
        assert.strictEqual(product.rating, 4.5);
        assert.strictEqual(product.reviews, 0);
        assert.strictEqual(product.stock, null);
        assert.strictEqual(product.active, true);
        assert.deepStrictEqual(product.specs, []);
    });

    it('devuelve null si el producto no es utilizable', () => {
        assert.strictEqual(core.normalizeProduct({ category: 'B', price: 100 }), null);
        assert.strictEqual(core.normalizeProduct({ name: 'A', price: 100 }), null);
        assert.strictEqual(core.normalizeProduct({ name: 'A', category: 'B' }), null);
        assert.strictEqual(core.normalizeProduct({ name: 'A', category: 'B', price: -1 }), null);
        assert.strictEqual(core.normalizeProduct(null), null);
    });

    it('limpia la etiqueta de oferta sin precio anterior', () => {
        const product = core.normalizeProduct({ name: 'A', category: 'B', price: 100, badge: 'Oferta' });
        assert.strictEqual(product.badge, '');
    });

    it('conserva el precio anterior válido y descarta el inválido', () => {
        assert.strictEqual(core.normalizeProduct({ name: 'A', category: 'B', price: 100, oldPrice: 200 }).oldPrice, 200);
        assert.strictEqual(core.normalizeProduct({ name: 'A', category: 'B', price: 100, oldPrice: '' }).oldPrice, null);
        assert.strictEqual(core.normalizeProduct({ name: 'A', category: 'B', price: 100, oldPrice: -5 }).oldPrice, null);
    });

    it('deja las especificaciones como lista de textos sin blancos', () => {
        const product = core.normalizeProduct({ name: 'A', category: 'B', price: 100, specs: ['  uno  ', '', '  ', 'dos'] });
        assert.deepStrictEqual(product.specs, ['uno', 'dos']);
        assert.deepStrictEqual(core.normalizeProduct({ name: 'A', category: 'B', price: 100, specs: 'x' }).specs, []);
    });

    it('respeta un producto retirado', () => {
        const product = core.normalizeProduct({ name: 'A', category: 'B', price: 100, active: false });
        assert.strictEqual(product.active, false);
    });
});

/* ------------------------------------------------------------
   Mapeo entre la base de datos y el cliente (RF-2, RF-40)
   ------------------------------------------------------------ */

describe('mapeo fila de base de datos → producto de cliente', () => {
    it('usa los nombres de campo del cliente', () => {
        const product = core.mapRowToProduct(sampleRow());
        assert.deepStrictEqual(Object.keys(product).sort(), [
            'active', 'badge', 'category', 'description', 'id', 'image', 'name',
            'oldPrice', 'price', 'rating', 'reviews', 'specs', 'stock'
        ]);
        assert.strictEqual(product.price, 1500);
        assert.strictEqual(product.oldPrice, null);
        assert.strictEqual(product.image, 'https://example.test/cable.jpg');
        assert.strictEqual(product.active, true);
    });

    it('limpia la etiqueta de oferta sin precio anterior en la fila', () => {
        const product = core.mapRowToProduct(sampleRow({ badge: 'Oferta', old_price_cup: null }));
        assert.strictEqual(product.badge, '');
    });

    it('conserva la etiqueta de oferta con precio anterior en la fila', () => {
        const product = core.mapRowToProduct(sampleRow({ badge: 'Oferta', old_price_cup: 2000 }));
        assert.strictEqual(product.badge, 'Oferta');
        assert.strictEqual(product.oldPrice, 2000);
    });

    it('rellena los valores por defecto que la fila no trae', () => {
        const product = core.mapRowToProduct({ id: 3, name: 'X' });
        assert.strictEqual(product.category, 'General');
        assert.strictEqual(product.price, 0);
        assert.strictEqual(product.oldPrice, null);
        assert.strictEqual(product.rating, 4.5);
        assert.strictEqual(product.reviews, 0);
        assert.strictEqual(product.stock, null);
        assert.strictEqual(product.active, true);
    });

    it('distingue existencias nulas de existencias cero', () => {
        assert.strictEqual(core.mapRowToProduct(sampleRow({ stock: null })).stock, null);
        assert.strictEqual(core.mapRowToProduct(sampleRow({ stock: 0 })).stock, 0);
    });

    it('devuelve null si la fila no es un objeto', () => {
        assert.strictEqual(core.mapRowToProduct(null), null);
    });
});

describe('mapeo producto de cliente → fila de base de datos', () => {
    it('guarda el precio en CUP y su equivalente en USD con tasa 820', () => {
        const row = core.mapProductToRow(sampleProduct());
        assert.strictEqual(row.price_cup, 1500);
        assert.strictEqual(row.price_usd, 1.83);
        assert.strictEqual(row.old_price_cup, null);
        assert.strictEqual(row.old_price_usd, null);
        assert.strictEqual(row.image_url, 'https://example.test/cable.jpg');
        assert.strictEqual(row.name, 'Cable USB-C');
        assert.strictEqual(row.category, 'Accesorios');
        assert.strictEqual(row.active, true);
    });

    it('calcula el equivalente en USD del precio anterior', () => {
        const row = core.mapProductToRow(sampleProduct({ oldPrice: 2000 }));
        assert.strictEqual(row.old_price_cup, 2000);
        assert.strictEqual(row.old_price_usd, 2.44);
    });

    it('limpia la etiqueta de oferta sin precio anterior', () => {
        assert.strictEqual(core.mapProductToRow(sampleProduct({ badge: 'Oferta' })).badge, '');
        assert.strictEqual(core.mapProductToRow(sampleProduct({ badge: 'Oferta', oldPrice: 2000 })).badge, 'Oferta');
    });

    it('no incluye el id (lo asigna el servidor)', () => {
        const row = core.mapProductToRow(sampleProduct());
        assert.ok(!('id' in row));
    });
});

/* ------------------------------------------------------------
   Clave canónica de contenido (RF-6, RF-18)
   ------------------------------------------------------------ */

describe('clave canónica de contenido', () => {
    it('es estable ante distinto orden de las claves', () => {
        const a = core.catalogContentKey({ name: 'A', category: 'G', price: 100 });
        const b = core.catalogContentKey({ price: 100, category: 'G', name: 'A' });
        assert.strictEqual(a, b);
    });

    it('cambia cuando cambia el contenido', () => {
        const base = core.catalogContentKey(sampleProduct());
        assert.notStrictEqual(base, core.catalogContentKey(sampleProduct({ price: 1501 })));
        assert.notStrictEqual(base, core.catalogContentKey(sampleProduct({ name: 'Otro' })));
        assert.notStrictEqual(base, core.catalogContentKey(sampleProduct({ active: false })));
    });

    it('distingue existencias nulas de existencias cero', () => {
        assert.notStrictEqual(
            core.catalogContentKey(sampleProduct({ stock: null })),
            core.catalogContentKey(sampleProduct({ stock: 0 }))
        );
    });
});

/* ------------------------------------------------------------
   Copia local del catálogo (RF-39, RF-38)
   ------------------------------------------------------------ */

describe('copia local', () => {
    it('normaliza una copia válida con el formato {_format:2}', () => {
        const copy = core.normalizeLocalCopy({
            _format: 2,
            version: 26,
            products: [{ id: 1, name: 'Cable', category: 'Accesorios', price: 1500 }]
        });
        assert.strictEqual(copy.valid, true);
        assert.strictEqual(copy.version, 26);
        assert.strictEqual(copy.products.length, 1);
        assert.strictEqual(copy.products[0].name, 'Cable');
        assert.strictEqual(copy.products[0].price, 1500);
    });

    it('acepta el array antiguo y lo trata como versión 0', () => {
        const copy = core.normalizeLocalCopy([{ name: 'Cable', category: 'Accesorios', price: 1500 }]);
        assert.strictEqual(copy.valid, true);
        assert.strictEqual(copy.version, 0);
        assert.strictEqual(copy.products.length, 1);
    });

    it('rechaza una copia corrupta', () => {
        const vacia = core.normalizeLocalCopy({ _format: 2, version: 26, products: [] });
        assert.strictEqual(vacia.valid, false);
        assert.deepStrictEqual(vacia.products, []);

        const desconocida = core.normalizeLocalCopy({ otra_cosa: true });
        assert.strictEqual(desconocida.valid, false);

        const invalida = core.normalizeLocalCopy({ _format: 2, version: 26, products: [{ category: 'B', price: 100 }] });
        assert.strictEqual(invalida.valid, false);

        const nula = core.normalizeLocalCopy(null);
        assert.strictEqual(nula.valid, false);
    });

    it('trata una versión no numérica como versión 0', () => {
        const copy = core.normalizeLocalCopy({
            _format: 2,
            version: 'no-es-un-número',
            products: [{ name: 'Cable', category: 'Accesorios', price: 1500 }]
        });
        assert.strictEqual(copy.valid, true);
        assert.strictEqual(copy.version, 0);
    });

    it('serializa con el formato vigente y vuelve a normalizarse', () => {
        const serialized = core.serializeLocalCopy(26, [sampleProduct()]);
        assert.strictEqual(serialized._format, 2);
        assert.strictEqual(serialized.version, 26);
        assert.strictEqual(serialized.products.length, 1);

        const copy = core.normalizeLocalCopy(JSON.parse(JSON.stringify(serialized)));
        assert.strictEqual(copy.valid, true);
        assert.strictEqual(copy.version, 26);
        assert.strictEqual(copy.products.length, 1);
    });
});

/* ------------------------------------------------------------
   Importación de un catálogo (RF-20)
   ------------------------------------------------------------ */

describe('parseo del catálogo importado', () => {
    it('acepta el objeto maestro', () => {
        const result = core.parseImportedCatalog({
            catalog: 'VentasCel',
            version: 26,
            products: [{ id: 1, name: 'Cable', category: 'Accesorios', price: 1500 }]
        });
        assert.strictEqual(result.ok, true);
        assert.strictEqual(result.error, null);
        assert.strictEqual(result.products.length, 1);
        assert.strictEqual(result.products[0].price, 1500);
    });

    it('acepta el array plano de productos', () => {
        const result = core.parseImportedCatalog([
            { id: 1, name: 'Cable', category: 'Accesorios', price: 1500 },
            { id: 2, name: 'Cargador', category: 'Accesorios', price: 800 }
        ]);
        assert.strictEqual(result.ok, true);
        assert.strictEqual(result.products.length, 2);
    });

    it('rechaza un archivo mal formado sin devolver productos', () => {
        const sinProductos = core.parseImportedCatalog({});
        assert.strictEqual(sinProductos.ok, false);
        assert.strictEqual(sinProductos.products.length, 0);
        assert.ok(sinProductos.error.length > 0);

        const vacio = core.parseImportedCatalog({ products: [] });
        assert.strictEqual(vacio.ok, false);
        assert.strictEqual(vacio.error, 'El catálogo del archivo está vacío.');

        const nulo = core.parseImportedCatalog(null);
        assert.strictEqual(nulo.ok, false);
    });

    it('rechaza un producto inválido diciendo cuál es', () => {
        const result = core.parseImportedCatalog([
            { name: 'Cable', category: 'Accesorios', price: 1500 },
            { category: 'Accesorios', price: 100 }
        ]);
        assert.strictEqual(result.ok, false);
        assert.strictEqual(result.products.length, 0);
        assert.ok(result.error.includes('El producto 2'));
        assert.ok(result.error.includes('falta el nombre'));
    });
});

describe('diff del catálogo', () => {
    const current = [
        sampleProduct({ id: 1, name: 'A', price: 100 }),
        sampleProduct({ id: 2, name: 'B', price: 200 }),
        sampleProduct({ id: 3, name: 'C', price: 300 })
    ];

    it('reparte añadidos, actualizados, retirados e intactos', () => {
        const imported = [
            sampleProduct({ id: 1, name: 'A', price: 150 }),
            sampleProduct({ id: 2, name: 'B', price: 200 }),
            sampleProduct({ id: 4, name: 'D', price: 400 })
        ];
        const diff = core.diffCatalog(current, imported);
        assert.deepStrictEqual(diff.added.map(p => p.id), [4]);
        assert.deepStrictEqual(diff.updated.map(p => p.id), [1]);
        assert.deepStrictEqual(diff.removed.map(p => p.id), [3]);
        assert.deepStrictEqual(diff.unchanged.map(p => p.id), [2]);
    });

    it('no marca cambios si el contenido es el mismo', () => {
        const diff = core.diffCatalog(current, current.map(p => Object.assign({}, p)));
        assert.deepStrictEqual(diff.added, []);
        assert.deepStrictEqual(diff.updated, []);
        assert.deepStrictEqual(diff.removed, []);
        assert.strictEqual(diff.unchanged.length, 3);
    });

    it('trata un producto sin id como añadido', () => {
        const diff = core.diffCatalog(current, [sampleProduct({ id: null, name: 'Sin id' })]);
        assert.strictEqual(diff.added.length, 1);
    });

    it('no falla con listas que no son arrays', () => {
        const diff = core.diffCatalog(null, null);
        assert.deepStrictEqual(diff.added, []);
        assert.deepStrictEqual(diff.updated, []);
        assert.deepStrictEqual(diff.removed, []);
        assert.deepStrictEqual(diff.unchanged, []);
    });
});

/* ------------------------------------------------------------
   Importación contra la base de datos: la imagen del archivo y la
   imagen publicada (RF-20)
   El catálogo maestro del repositorio usa rutas locales ("img/...")
   y la base de datos guarda URLs del bucket: al comparar, una
   ruta local NO es un cambio.
   ------------------------------------------------------------ */

describe('diff de importación contra la base de datos', () => {
    const BUCKET = 'https://proyecto.supabase.co/storage/v1/object/public/product-images';

    /* Contenido común de un producto, igual en el archivo y en la
       fila de la base de datos: solo cambia la imagen. */
    const BASE = {
        id: 1,
        name: 'Cable USB-C',
        category: 'Accesorios',
        badge: '',
        price: 1500,
        oldPrice: null,
        rating: 4.5,
        reviews: 10,
        description: 'Cable de carga rápida',
        specs: ['1 metro', 'USB-C'],
        stock: null,
        active: true
    };

    /* Producto como está en la base de datos: la imagen es una URL
       del bucket. */
    function dbProduct(overrides) {
        const o = Object.assign({}, BASE, { image: BUCKET + '/p1.jpg' }, overrides || {});
        return core.mapRowToProduct({
            id: o.id,
            name: o.name,
            category: o.category,
            badge: o.badge,
            price_cup: o.price,
            price_usd: core.cupToUsd(o.price),
            old_price_cup: o.oldPrice,
            old_price_usd: null,
            rating: o.rating,
            reviews: o.reviews,
            image_url: o.image,
            description: o.description,
            specs: o.specs,
            stock: o.stock,
            active: o.active
        });
    }

    /* Producto como viene en el archivo: el maestro usa rutas
       locales ("img/..."). */
    function fileProduct(overrides) {
        const o = Object.assign({}, BASE, { image: 'img/p1.jpg' }, overrides || {});
        return core.normalizeProduct(o);
    }

    it('el maestro con rutas locales no genera actualizaciones espurias', () => {
        const current = [
            dbProduct(),
            dbProduct({ id: 2, name: 'Cargador', image: BUCKET + '/p2.jpg' })
        ];
        const imported = [
            fileProduct(),
            fileProduct({ id: 2, name: 'Cargador', image: 'img/p2.jpg' })
        ];
        const diff = core.diffCatalog(current, imported);
        assert.deepStrictEqual(diff.added, []);
        assert.deepStrictEqual(diff.updated, []);
        assert.deepStrictEqual(diff.removed, []);
        assert.strictEqual(diff.unchanged.length, 2);
    });

    it('una URL del bucket distinta sí es un cambio', () => {
        const diff = core.diffCatalog(
            [dbProduct()],
            [fileProduct({ image: BUCKET + '/otro.jpg' })]
        );
        assert.strictEqual(diff.updated.length, 1);
        assert.strictEqual(diff.updated[0].image, BUCKET + '/otro.jpg');
    });

    it('al editar se conservan la imagen publicada y las existencias', () => {
        const diff = core.diffCatalog(
            [dbProduct({ stock: 7 })],
            [fileProduct({ price: 2000 })]
        );
        assert.strictEqual(diff.updated.length, 1);
        assert.strictEqual(diff.updated[0].image, BUCKET + '/p1.jpg');
        assert.strictEqual(diff.updated[0].stock, 7);
        assert.strictEqual(diff.updated[0].price, 2000);
    });

    it('empareja por nombre cuando el id del archivo no existe (importar dos veces no duplica)', () => {
        const diff = core.diffCatalog(
            [dbProduct({ id: 1000, name: 'Producto nuevo' })],
            [fileProduct({ id: 76, name: 'Producto nuevo' })]
        );
        assert.deepStrictEqual(diff.added, []);
        assert.deepStrictEqual(diff.removed, []);
        assert.strictEqual(diff.unchanged.length, 1);
    });

    it('no reactiva un producto retirado', () => {
        const diff = core.diffCatalog(
            [dbProduct({ active: false })],
            [fileProduct({ active: true })]
        );
        assert.deepStrictEqual(diff.updated, []);
        assert.strictEqual(diff.unchanged.length, 1);
        assert.strictEqual(diff.unchanged[0].active, false);
    });

    it('un producto ya retirado que no está en el archivo no se vuelve a retirar', () => {
        const diff = core.diffCatalog(
            [dbProduct({ id: 2, name: 'Cargador', active: false })],
            [fileProduct()]
        );
        assert.deepStrictEqual(diff.removed, []);
    });

    it('las altas usan la imagen del bucket por defecto si el archivo trae una ruta local', () => {
        const diff = core.diffCatalog([], [fileProduct({ id: null })]);
        assert.strictEqual(diff.added.length, 1);
        assert.ok(diff.added[0].image.includes('/storage/v1/object/public/product-images/'));
    });
});

describe('resolución de la imagen al importar', () => {
    it('una URL del archivo manda', () => {
        const url = 'https://proyecto.supabase.co/storage/v1/object/public/product-images/p1.jpg';
        assert.strictEqual(
            core.resolveImportedImage({ image: 'https://otro.test/x.jpg' }, { image: url }),
            url
        );
    });

    it('una ruta local conserva la imagen publicada', () => {
        const publicada = 'https://proyecto.supabase.co/storage/v1/object/public/product-images/p1.jpg';
        assert.strictEqual(
            core.resolveImportedImage({ image: publicada }, { image: 'img/p1.jpg' }),
            publicada
        );
    });

    it('una alta sin URL usa la imagen por defecto del bucket', () => {
        const result = core.resolveImportedImage(null, { image: 'img/p1.jpg' });
        assert.ok(result.includes('/storage/v1/object/public/product-images/'));
    });

    it('una URL distinta cuenta como cambio de imagen', () => {
        assert.strictEqual(core.imageChanged('https://a.test/x.jpg', 'https://b.test/x.jpg'), true);
        assert.strictEqual(core.imageChanged('https://a.test/x.jpg', 'img/x.jpg'), false);
        assert.strictEqual(core.imageChanged('https://a.test/x.jpg', 'https://a.test/x.jpg'), false);
    });
});

/* ------------------------------------------------------------
   Comparación de versiones (RF-6, RF-38)
   ------------------------------------------------------------ */

describe('comparación de versiones', () => {
    it('la copia local está desfasada si la versión publicada es mayor', () => {
        assert.strictEqual(core.isLocalCopyStale(26, 27), true);
    });

    it('la copia local NO está desfasada si la versión publicada es igual o menor', () => {
        assert.strictEqual(core.isLocalCopyStale(26, 26), false);
        assert.strictEqual(core.isLocalCopyStale(27, 26), false);
    });

    it('sin versión guardada, cualquier versión publicada la desfasca', () => {
        assert.strictEqual(core.isLocalCopyStale(null, 5), true);
        assert.strictEqual(core.isLocalCopyStale(undefined, 1), true);
    });

    it('sin versión publicada no se puede decidir: no está desfasada', () => {
        assert.strictEqual(core.isLocalCopyStale(26, null), false);
        assert.strictEqual(core.isLocalCopyStale(26, 'abc'), false);
    });
});

/* ------------------------------------------------------------
   Filtrado, orden e imagen por defecto (RF-33, RF-12)
   ------------------------------------------------------------ */

describe('filtrado y orden', () => {
    const products = [
        { name: 'Cable USB-C', category: 'Accesorios', price: 100, rating: 4.5 },
        { name: 'Cargador', category: 'Accesorios', price: 20, rating: 4.9 },
        { name: 'Funda', category: 'Cases', price: 50, rating: 3.0 }
    ];

    it('filtra por categoría', () => {
        assert.deepStrictEqual(
            core.filterAndSort(products, { category: 'Accesorios' }).map(p => p.name),
            ['Cable USB-C', 'Cargador']
        );
    });

    it('la categoría "todos" no filtra', () => {
        assert.strictEqual(core.filterAndSort(products, { category: 'todos' }).length, 3);
    });

    it('busca por nombre sin tildes e ignora la categoría', () => {
        assert.deepStrictEqual(
            core.filterAndSort(products, { query: 'cable' }).map(p => p.name),
            ['Cable USB-C']
        );
        assert.deepStrictEqual(
            core.filterAndSort(products, { query: 'CÁBLE', category: 'Cases' }).map(p => p.name),
            ['Cable USB-C']
        );
    });

    it('ordena por precio y por valoración', () => {
        assert.deepStrictEqual(
            core.filterAndSort(products, { sort: 'low-high' }).map(p => p.price),
            [20, 50, 100]
        );
        assert.deepStrictEqual(
            core.filterAndSort(products, { sort: 'high-low' }).map(p => p.price),
            [100, 50, 20]
        );
        assert.deepStrictEqual(
            core.filterAndSort(products, { sort: 'rating' }).map(p => p.name),
            ['Cargador', 'Cable USB-C', 'Funda']
        );
    });
});

describe('resolución del carrito y los favoritos (RF-40)', () => {
    /* Carrito guardado con el formato antiguo: price, oldPrice e image. */
    const legacyCart = [
        { id: 1, name: 'Cable USB-C', price: 1500, oldPrice: 2000, image: 'img/cable.jpg', quantity: 2 },
        { id: 2, name: 'Cargador', price: 3000, oldPrice: null, image: 'img/cargador.jpg', quantity: 1 }
    ];

    const catalog = [
        sampleProduct({ id: 1, name: 'Cable USB-C', price: 1800, image: 'https://bucket.test/cable.jpg' }),
        sampleProduct({ id: 2, name: 'Cargador rápido', price: 3200, image: 'https://bucket.test/cargador.jpg' })
    ];

    it('la línea guardada apunta al producto actual y usa su precio', () => {
        const lines = core.resolveCatalogLines(legacyCart, catalog);
        assert.strictEqual(lines.length, 2);
        assert.strictEqual(lines[0].id, 1);
        assert.strictEqual(lines[0].name, 'Cable USB-C');
        /* El precio es el del catálogo vigente (la base de datos manda),
           no el que quedó guardado en el navegador. */
        assert.strictEqual(lines[0].price, 1800);
        assert.strictEqual(lines[1].price, 3200);
        assert.strictEqual(lines[1].name, 'Cargador rápido');
    });

    it('la imagen es la del catálogo vigente', () => {
        const lines = core.resolveCatalogLines(legacyCart, catalog);
        assert.strictEqual(lines[0].image, 'https://bucket.test/cable.jpg');
    });

    it('conserva la cantidad guardada y normaliza las que no valen', () => {
        const lines = core.resolveCatalogLines(
            [{ id: 1, price: 1500, quantity: 3 }, { id: 2, price: 1500, quantity: 0 }],
            catalog
        );
        assert.deepStrictEqual(lines.map(line => line.quantity), [3, 1]);
    });

    it('omite la línea cuyo producto ya no existe', () => {
        const lines = core.resolveCatalogLines(
            [{ id: 1, price: 1500, quantity: 1 }, { id: 99, price: 700, quantity: 1 }],
            catalog
        );
        assert.strictEqual(lines.length, 1);
        assert.strictEqual(lines[0].id, 1);
    });

    it('marca como agotado el producto que se quedó sin existencias', () => {
        const lines = core.resolveCatalogLines(
            [{ id: 1, price: 1500, quantity: 1 }],
            [sampleProduct({ id: 1, price: 1500, stock: 0 })]
        );
        assert.strictEqual(lines[0].soldOut, true);
    });

    it('sin catálogo no se pierde el carrito: se conserva lo guardado', () => {
        const lines = core.resolveCatalogLines(legacyCart, []);
        assert.strictEqual(lines.length, 2);
        assert.strictEqual(lines[0].price, 1500);
        assert.strictEqual(lines[0].image, 'img/cable.jpg');
    });

    it('acepta también la lista de favoritos', () => {
        const lines = core.resolveCatalogLines([{ id: 2, price: 3000, quantity: 1 }], catalog);
        assert.strictEqual(lines.length, 1);
        assert.strictEqual(lines[0].price, 3200);
    });
});

/* ------------------------------------------------------------
   Catálogo de respaldo del modo degradado (RF-35, RF-38)
   ------------------------------------------------------------ */

describe('catálogo de respaldo', () => {
    const seed = {
        version: 26,
        products: [sampleProduct({ id: 1, name: 'Cable USB-C', price: 1500 })]
    };

    it('usa la copia local del navegador cuando es válida', () => {
        const fallback = core.pickFallbackCatalog({
            _format: 2,
            version: 27,
            products: [sampleProduct({ id: 7, name: 'Cargador', price: 3000 })]
        }, seed);
        assert.strictEqual(fallback.source, 'copy');
        assert.strictEqual(fallback.version, 27);
        assert.strictEqual(fallback.products.length, 1);
        assert.strictEqual(fallback.products[0].name, 'Cargador');
    });

    it('descarta una copia local corrupta y usa la semilla', () => {
        const fallback = core.pickFallbackCatalog({ _format: 2, version: 27, products: [] }, seed);
        assert.strictEqual(fallback.source, 'seed');
        assert.strictEqual(fallback.version, 26);
        assert.strictEqual(fallback.products.length, 1);
        assert.strictEqual(fallback.products[0].name, 'Cable USB-C');
    });

    it('sin copia local usa la semilla', () => {
        const fallback = core.pickFallbackCatalog(null, seed);
        assert.strictEqual(fallback.source, 'seed');
        assert.strictEqual(fallback.version, 26);
        assert.strictEqual(fallback.products.length, 1);
    });

    it('acepta el array antiguo de la copia local', () => {
        const fallback = core.pickFallbackCatalog(
            [sampleProduct({ id: 3, name: 'Auriculares', price: 5000 })],
            seed
        );
        assert.strictEqual(fallback.source, 'copy');
        assert.strictEqual(fallback.version, 0);
        assert.strictEqual(fallback.products[0].name, 'Auriculares');
    });

    it('sin copia local ni semilla no inventa productos', () => {
        const fallback = core.pickFallbackCatalog(null, null);
        assert.strictEqual(fallback.source, 'seed');
        assert.deepStrictEqual(fallback.products, []);
        assert.strictEqual(fallback.version, 0);
    });
});

describe('imagen por defecto', () => {
    it('devuelve la imagen del producto si tiene', () => {
        assert.strictEqual(core.pickDefaultImage({ image: 'https://a.test/b.jpg' }), 'https://a.test/b.jpg');
    });

    it('devuelve la imagen del bucket si el producto no tiene', () => {
        const url = core.pickDefaultImage({ image: '' }, 'https://proyecto.supabase.co');
        assert.ok(url.endsWith('/storage/v1/object/public/product-images/default.jpg'));
        assert.ok(url.startsWith('https://proyecto.supabase.co'));
    });
});

describe('lógica contable pura T2', () => {
    it('validateExchangeRate rechaza tasas inválidas', () => {
        assert.strictEqual(core.validateExchangeRate(0).ok, false);
        assert.strictEqual(core.validateExchangeRate(-5).ok, false);
        assert.strictEqual(core.validateExchangeRate('abc').ok, false);
        assert.strictEqual(core.validateExchangeRate(820.555).ok, false);
        assert.strictEqual(core.validateExchangeRate(820).ok, true);
        assert.strictEqual(core.validateExchangeRate(820.55).ok, true);
    });

    it('dateKey corta la cadena sin Date', () => {
        assert.strictEqual(core.dateKey('2026-10-22T12:34:56Z'), '2026-10-22');
        assert.strictEqual(core.dateKey(''), '');
        assert.strictEqual(core.dateKey(null), '');
    });

    it('saleTotals calcula totales y margen', () => {
        const items = [
            { qty: 2, unit_price: 1500, cost_price: 1000 },
            { qty: 1, unit_price: 800, cost_price: 400 }
        ];
        const t = core.saleTotals(items);
        assert.strictEqual(t.totalCup, 3800);
        assert.strictEqual(t.totalProfit, 3800 - (2000 + 400));
        assert.strictEqual(t.totalUsd, 4.63); // 3800/820 = 4.634...
    });

    it('salesSummary usa todayKey y monthKey inyectados', () => {
        const sales = [
            { created_at: '2026-10-22T10:00:00Z', total_cup: 1000, total_usd: 1.22, total_profit: 500 },
            { created_at: '2026-10-22T11:00:00Z', total_cup: 2000, total_usd: 2.44, total_profit: 1000 },
            { created_at: '2026-09-01T00:00:00Z', total_cup: 500, total_usd: 0.61, total_profit: 200 }
        ];
        const s = core.salesSummary(sales, { todayKey: '2026-10-22', monthKey: '2026-10' });
        assert.strictEqual(s.countToday, 2);
        assert.strictEqual(s.cupToday, 3000);
        assert.strictEqual(s.countMonth, 2);
    });

    it('paymentBreakdown y originBreakdown', () => {
        const sales = [
            { total_cup: 1000, payment_method: 'EFECTIVO', origin: 'FISICO' },
            { total_cup: 2000, payment_method: 'DIGITAL', origin: 'ONLINE' }
        ];
        const p = core.paymentBreakdown(sales);
        assert.strictEqual(p.cashCup, 1000);
        assert.strictEqual(p.digitalCup, 2000);
        const o = core.originBreakdown(sales);
        assert.strictEqual(o.physicalCup, 1000);
        assert.strictEqual(o.onlineCup, 2000);
    });

    it('expensesSummary y netBalance', () => {
        const expenses = [{ created_at: '2026-10-22T08:00:00Z', amount_cup: 500 }];
        const e = core.expensesSummary(expenses, { todayKey: '2026-10-22', monthKey: '2026-10' });
        assert.strictEqual(e.cupToday, 500);
        const sales = [{ created_at: '2026-10-22T10:00:00Z', total_profit: 800 }];
        const nb = core.netBalance(sales, expenses, { todayKey: '2026-10-22', monthKey: '2026-10' });
        assert.strictEqual(nb.cupToday, 300);
    });

    it('formatRate formatea la tasa', () => {
        assert.strictEqual(core.formatRate(820), '820 CUP = 1 USD');
        assert.strictEqual(core.formatRate(-5), '');
    });

    it('mapProductToRow con tasa distinta', () => {
        const row = core.mapProductToRow({ price: 1500, oldPrice: 2000 }, 400);
        assert.strictEqual(row.price_usd, 3.75);
        assert.strictEqual(row.old_price_usd, 5);
    });

    it('cupToUsd / usdToCup con tasa inválida devuelve null', () => {
        assert.strictEqual(core.cupToUsd(100, 0), null);
        assert.strictEqual(core.usdToCup(1, -5), null);
        assert.strictEqual(core.cupToUsd(100, NaN), null);
    });

    it('no usa document, localStorage, fetch ni Date.now', () => {
        const src = require('fs').readFileSync('catalog-core.js', 'utf8');
        assert.strictEqual(/document\./.test(src), false);
        assert.strictEqual(/localStorage/.test(src), false);
        assert.strictEqual(/fetch\(/.test(src), false);
        assert.strictEqual(/Date\.now/.test(src), false);
    });
});
