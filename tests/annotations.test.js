const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getTargetAnchor, layoutAnnotation, hasCompletedInteraction } = require('../annotations.js');
const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });

test('range arrow follows the thumb rather than the track center', () => {
    assert.equal(typeof getTargetAnchor, 'function', 'range anchor helper must exist');
    assert.deepEqual(getTargetAnchor(rect(400, 200, 300, 8), { min: 0, max: 10, value: 0, thumbSize: 16 }), { x: 408, y: 204 });
    assert.deepEqual(getTargetAnchor(rect(400, 200, 300, 8), { min: 0, max: 10, value: 10, thumbSize: 16 }), { x: 692, y: 204 });
    assert.deepEqual(getTargetAnchor(rect(400, 200, 300, 8), { min: 0, max: 10, value: 2, thumbSize: 16, direction: 'rtl' }), { x: 635.2, y: 204 });
});

test('arrow starts on the measured label edge for short and wrapped labels', () => {
    assert.equal(typeof layoutAnnotation, 'function', 'measured layout helper must exist');
    for (const size of [{ width: 140, height: 56 }, { width: 290, height: 180 }]) {
        const result = layoutAnnotation({ target: rect(600, 300, 240, 8), anchor: { x: 660, y: 304 }, label: size, viewport: { width: 1100, height: 750 } });
        const { left, top, start } = result;
        const onEdge = Math.abs(start.x - left) < 0.01 || Math.abs(start.x - left - size.width) < 0.01 || Math.abs(start.y - top) < 0.01 || Math.abs(start.y - top - size.height) < 0.01;
        assert.ok(onEdge, 'connector must touch actual card edge');
        assert.ok(start.x >= left && start.x <= left + size.width);
        assert.ok(start.y >= top && start.y <= top + size.height);
        assert.ok(!result.path.includes('NaN'));
    }
});

test('all four viewport edges keep the measured label inside the gutter', () => {
    assert.equal(typeof layoutAnnotation, 'function');
    for (const target of [rect(0, 0, 100, 10), rect(310, 0, 40, 10), rect(0, 620, 100, 10), rect(310, 620, 40, 10)]) {
        const result = layoutAnnotation({ target, anchor: { x: target.left + 20, y: target.top + 5 }, label: { width: 280, height: 160 }, viewport: { width: 375, height: 667 } });
        assert.ok(result.left >= 16 && result.left + 280 <= 359);
        assert.ok(result.top >= 16 && result.top + 160 <= 651);
    }
});

test('label chooses a free side instead of covering the target or assistant panel', () => {
    assert.equal(typeof layoutAnnotation, 'function');
    const result = layoutAnnotation({ target: rect(400, 300, 200, 10), anchor: { x: 500, y: 305 }, label: { width: 200, height: 80 }, viewport: { width: 1000, height: 700 }, avoid: [rect(0, 100, 380, 500)] });
    assert.ok(result.left >= 380, 'do not cover panel when free alternatives exist');
    assert.ok(result.top + 80 <= 300 || result.top >= 310 || result.left >= 600);
});

test('practice requires an actual change in the requested direction', () => {
    assert.equal(typeof hasCompletedInteraction, 'function');
    assert.equal(hasCompletedInteraction(2, 2, 'any'), false);
    assert.equal(hasCompletedInteraction(2, 1.9, 'increase'), false);
    assert.equal(hasCompletedInteraction(2, 2.1, 'increase'), true);
    assert.equal(hasCompletedInteraction(2, 2.1, 'decrease'), false);
    assert.equal(hasCompletedInteraction(2, 1.9, 'decrease'), true);
    assert.equal(hasCompletedInteraction(2, 1.9, 'any'), true);
    assert.equal(hasCompletedInteraction(2, NaN, 'any'), false);
});

test('visual viewport offsets are included in the card gutter', () => {
    const result = layoutAnnotation({ target: rect(340, 300, 200, 8), anchor: { x: 440, y: 304 }, label: { width: 220, height: 140 }, viewport: { left: 120, top: 100, width: 375, height: 500 } });
    assert.ok(result.left >= 136 && result.left + 220 <= 479);
    assert.ok(result.top >= 116 && result.top + 140 <= 584);
});

test('range anchors remain finite and clamped for degenerate bounds', () => {
    assert.deepEqual(getTargetAnchor(rect(0, 0, 100, 6), { min: 1, max: 1, value: 1 }), { x: 50, y: 3 });
    assert.deepEqual(getTargetAnchor(rect(0, 0, 100, 6), { min: 0, max: 10, value: 100 }), { x: 92, y: 3 });
});

test('connectors stop outside target edges and never aim at target text', () => {
    const target = rect(350, 250, 280, 160);
    for (const viewport of [{ width: 1000, height: 700 }, { width: 700, height: 700 }]) {
        const result = layoutAnnotation({ target, anchor: { x: 490, y: 330 }, label: { width: 220, height: 80 }, viewport });
        assert.ok(result.end.x < target.left || result.end.x > target.right || result.end.y < target.top || result.end.y > target.bottom);
        const outsideDistance = Math.min(Math.abs(result.end.x - target.left), Math.abs(result.end.x - target.right), Math.abs(result.end.y - target.top), Math.abs(result.end.y - target.bottom));
        assert.ok(outsideDistance <= 12, 'tip should stay close to the highlighted border');
    }
});
