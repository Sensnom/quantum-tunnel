const { test } = require('node:test');
const assert = require('node:assert/strict');
const Tutor = require('../tutor.js');
const answer = { thinking_summary: ['统计右侧概率。'], reply: '用右侧可见概率加已吸收概率，再除以初始总概率。', actions: [{ type: 'annotate', payload: { target: 'actualTValue', shape: 'ring', label: '数值 T' } }] };

test('prose followed by a JSON envelope returns the structured answer only once', () => {
    const parsed = Tutor.parseResponse(`${answer.reply}\n\n${JSON.stringify(answer)}`);
    assert.equal(parsed.reply, answer.reply);
    assert.deepEqual(parsed.actions, answer.actions);
    assert.deepEqual(parsed.thinkingSummary, answer.thinking_summary);
    assert.ok(!parsed.reply.includes('"actions"'));
});

test('a prefaced fenced envelope is extracted without exposing format markers', () => {
    const parsed = Tutor.parseResponse(`下面按当前参数说明。\n\n\`\`\`json\n${JSON.stringify(answer)}\n\`\`\``);
    assert.equal(parsed.reply, answer.reply);
    assert.deepEqual(parsed.actions, answer.actions);
});

test('ordinary prose and formula braces remain ordinary answers', () => {
    const text = String.raw`概率密度是 $|\psi|^2$，关系式里可以有 {x+y} 这样的分组。`;
    assert.equal(Tutor.parseResponse(text).reply, text);
});

test('streamed prose plus an envelope never publishes raw JSON keys or duplicate prose', async () => {
    const updates = [];
    const parts = [answer.reply + '\n\n', '{', '"thinking_sum', 'mary":["统计右侧概率。"],', '"reply":"' + answer.reply + '",', '"actions":[{"type":"annotate","payload":{"target":"actualTValue","shape":"ring"}}]}'];
    const event = content => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
    const wire = parts.map(event).join('') + 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
    const result = await Tutor.request({
        config: { endpoint: 'https://example.invalid', apiKey: 'test-only', model: 'deepseek-flash', timeoutMs: 3000 }, question: 'T 怎么统计', messages: [],
        onUpdate: update => updates.push(update),
        fetchImpl: async () => new Response(wire, { headers: { 'content-type': 'text/event-stream' } })
    });
    assert.equal(result.reply, answer.reply);
    assert.ok(updates.some(update => update.thinkingSummary?.length));
    assert.ok(updates.every(update => !/"thinking_|"actions"|"reply"/.test(update.reply)));
    assert.ok(updates.every(update => update.reply.split(answer.reply).length <= 2));
});

test('an extra first field does not prevent a valid structured reply from being extracted', () => {
    const parsed = Tutor.parseResponse('说明文字。\n' + JSON.stringify({ version: 1, ...answer }));
    assert.equal(parsed.reply, answer.reply);
    assert.deepEqual(parsed.actions, answer.actions);
});

test('an ordinary JSON example without response fields is kept as answer content', () => {
    const text = '例如，数据可以写成 {"x":1}，这里只是在解释记号。';
    assert.equal(Tutor.parseResponse(text).reply, text);
});
