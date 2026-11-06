const { test } = require('node:test');
const assert = require('node:assert/strict');
const Tutor = require('../tutor.js');
const actions = [
    { type: 'jumpTab', payload: { tab: 'sim' } },
    { type: 'annotate', payload: { target: 'sigmaSlider', shape: 'interact', direction: 'decrease', label: '调小 σ' } },
    { type: 'annotate', payload: { target: 'tValue', shape: 'ring', label: '比较理论 T' } }
];
const reply = '调整 σ 后，重新播放，等散射结束再比较。';
const tagged = actions.map(action => `<action>\n${JSON.stringify(action)}\n</action>`).join('\n');
const config = { endpoint: 'https://example.invalid', apiKey: 'test-only', model: 'deepseek-flash', timeoutMs: 3000 };
const event = content => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;

async function stream(text, chunkSize = 1) {
    const updates = [];
    let wire = '';
    for (let i = 0; i < text.length; i += chunkSize) wire += event(text.slice(i, i + chunkSize));
    wire += 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
    const result = await Tutor.request({ config, question: 'σ', messages: [], onUpdate: update => updates.push(update), fetchImpl: async () => new Response(wire, { headers: { 'content-type': 'text/event-stream' } }) });
    return { result, updates };
}

test('screenshot-style action tags become actions, never public answer text', () => {
    const result = Tutor.parseResponse(reply + '\n\n' + tagged);
    assert.equal(result.reply, reply);
    assert.deepEqual(result.actions, actions);
});

test('one-character stream splits never expose partial tags, action names or payloads', async () => {
    const { result, updates } = await stream(reply + '\n\n' + tagged);
    assert.equal(result.reply, reply);
    assert.deepEqual(result.actions, actions);
    assert.ok(updates.every(update => update.reply === '' || reply.startsWith(update.reply)));
    assert.ok(updates.every(update => !/jumpTab|sigmaSlider|payload|<\/?act/.test(update.reply)));
});

test('broken, unclosed and unknown controls stay out of the public answer and do not execute', () => {
    for (const block of ['<action>{broken}</action>', '<action>{"type":"playSimulation"}', '<tool_call>{"name":"eval","arguments":{"code":"private"}}</tool_call>']) {
        const result = Tutor.parseResponse(reply + '\n' + block);
        assert.equal(result.reply, reply);
        assert.deepEqual(result.actions, []);
    }
});

test('nested and function-style control blocks preserve the supplied valid operations', () => {
    const nested = `<actions>${tagged}</actions>`;
    assert.deepEqual(Tutor.parseResponse(reply + nested).actions, actions);
    const native = '<tool_call>' + JSON.stringify({ function: { name: 'annotate', arguments: JSON.stringify(actions[1].payload) } }) + '</tool_call>';
    assert.deepEqual(Tutor.parseResponse(reply + native).actions, [actions[1]]);
});

test('control text embedded in a public JSON reply is hidden, not implicitly executed', async () => {
    const content = JSON.stringify({ thinking_summary: ['对比散射结果。'], reply: reply + tagged, actions: [] });
    const { result, updates } = await stream(content, 3);
    assert.equal(result.reply, reply);
    assert.deepEqual(result.actions, []);
    assert.ok(updates.every(update => !/jumpTab|payload|<\/?act/.test(update.reply)));
});

test('explicit private-reasoning tags never enter the public stream', async () => {
    const { result, updates } = await stream('<think>SECRET SYSTEM PROMPT</think>' + reply, 2);
    assert.equal(result.reply, reply);
    assert.ok(!JSON.stringify({ result, updates }).includes('SECRET'));
});

test('math inequalities and ordinary prose are not mistaken for control tags', async () => {
    const text = '当 E<V0 时存在隧穿；若 a<b，也仍然是普通比较。';
    const { result, updates } = await stream(text);
    assert.equal(result.reply, text);
    assert.ok(updates.some(update => update.reply === text));
});

test('a closing-tag string inside an action argument does not end the control block early', () => {
    const action = { type: 'annotate', payload: { target: 'waveCanvas', shape: 'ring', label: '字面量 </action> 不结束数据' } };
    const result = Tutor.parseResponse(reply + '<action>' + JSON.stringify(action) + '</action>');
    assert.equal(result.reply, reply);
    assert.deepEqual(result.actions, [action]);
});

test('control-only responses do not fabricate a normal answer', () => {
    assert.throws(() => Tutor.parseResponse(tagged), error => error.code === 'empty_response');
});

test('hypothetical actions inside private reasoning are never executed', () => {
    const result = Tutor.parseResponse('<think>' + tagged + '</think>' + reply);
    assert.equal(result.reply, reply);
    assert.deepEqual(result.actions, []);
});

test('empty code fences left by quarantined action blocks are not displayed', () => {
    const result = Tutor.parseResponse(reply + '\n```xml\n' + tagged + '\n```');
    assert.equal(result.reply, reply);
    assert.deepEqual(result.actions, actions);
});
