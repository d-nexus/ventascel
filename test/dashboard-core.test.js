'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../catalog-core.js');

const TZ = 240; // La Habana: UTC-4

test('localDateKey respeta la zona horaria', () => {
    assert.equal(core.localDateKey('2026-10-25T02:30:00Z', TZ), '2026-10-24');
    assert.equal(core.localDateKey('2026-10-25T02:30:00Z', 0), '2026-10-25');
    assert.equal(core.localDateKey('basura', TZ), '');
    assert.equal(core.localDateKey(null, TZ), '');
});

test('dashboardData: totales de hoy y del mes con zona horaria', () => {
    const sales = [
        { created_at: '2026-10-24T14:00:00Z', total_cup: 1000, total_usd: 1.22, total_profit: 300, payment_method: 'EFECTIVO', origin: 'FISICO' },
        { created_at: '2026-10-25T02:00:00Z', total_cup: 500, total_usd: 0.61, total_profit: 100, payment_method: 'DIGITAL', origin: 'ONLINE' },
        { created_at: '2026-10-02T15:00:00Z', total_cup: 2000, total_usd: 2.44, total_profit: 600, payment_method: 'EFECTIVO', origin: 'FISICO' },
        { created_at: '2026-09-02T15:00:00Z', total_cup: 900, total_usd: 1.1, total_profit: 200, payment_method: 'EFECTIVO', origin: 'FISICO' },
        { created_at: '2026-09-28T15:00:00Z', total_cup: 7777, total_usd: 9, total_profit: 1, payment_method: 'EFECTIVO', origin: 'FISICO' }
    ];
    const expenses = [{ created_at: '2026-10-10T15:00:00Z', amount_cup: 150 }];
    const data = core.dashboardData(sales, expenses, { todayKey: '2026-10-24', tzOffsetMin: TZ });
    assert.equal(data.today.revenue, 1500);
    assert.equal(data.today.orders, 2);
    assert.equal(data.month.revenue, 3500);
    assert.equal(data.month.profit, 1000);
    assert.equal(data.month.expenses, 150);
    assert.equal(data.month.net, 850);
    assert.equal(data.payment.cash.cup, 3000);
    assert.equal(data.payment.digital.count, 1);
    assert.equal(data.origin.online.cup, 500);
    // Tendencia: 1-24 de septiembre = 900 (la del día 28 queda fuera)
    assert.equal(data.trends.revenue, 288.9);
});

test('dashboardData: series completas y sin datos', () => {
    const data = core.dashboardData([], [], { todayKey: '2026-03-05', tzOffsetMin: TZ, months: 6, days: 7 });
    assert.equal(data.series.months.length, 6);
    assert.equal(data.series.months[0].key, '2025-10');
    assert.equal(data.series.months[5].key, '2026-03');
    assert.equal(data.series.days.length, 7);
    assert.equal(data.series.days[0].key, '2026-02-27');
    assert.equal(data.trends.revenue, null);
    assert.equal(data.month.revenue, 0);
});

test('topProductsByUnits agrupa, ordena y descarta líneas inválidas', () => {
    const lines = [
        { product_id: 1, qty: 2 }, { product_id: 2, qty: 5 }, { product_id: 1, qty: 4 },
        { product_id: null, qty: 3 }, { product_id: 3, qty: 0 }, null
    ];
    assert.deepEqual(core.topProductsByUnits(lines, 2), [{ id: 1, units: 6 }, { id: 2, units: 5 }]);
    assert.deepEqual(core.topProductsByUnits(null), []);
});
