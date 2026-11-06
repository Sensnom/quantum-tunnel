const { test } = require('node:test');
const assert = require('node:assert/strict');
const Tutor = require('../tutor.js');
const parameters = { E: 1.5, V0: 3, d: 0.5, mass: 5.68563, hbar: 0.658212 };
const complete = (content, finish_reason = 'stop') => new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason }] }), { headers: { 'content-type': 'application/json' } });
const config = { endpoint: 'https://example.invalid/chat/completions', apiKey: 'test-only', model: 'deepseek-flash', timeoutMs: 3000 };

test('all messages use high thinking with enough shared reasoning and answer budget', () => {
    assert.equal(typeof Tutor.getRequestOptions, 'function');
    for (const question of ['κ 的数值怎么算？', '如何从 T 反推 κ？', '推导透射率公式']) {
        const options = Tutor.getRequestOptions(question);
        assert.equal(options.thinking.type, 'enabled');
        assert.ok(options.max_tokens >= 32768);
    }
    for (const question of ['势垒内为什么仍有振幅？', '你好', '谢谢']) {
        assert.equal(Tutor.getRequestOptions(question).thinking.type, 'enabled');
        assert.equal(Tutor.getRequestOptions(question).reasoning_effort, 'high');
        assert.equal(Tutor.getRequestOptions(question).max_tokens, 32768);
    }
});

test('physics facts use the actual eV/nm/fs constants and exact barrier coefficient', () => {
    assert.equal(typeof Tutor.getPhysicsFacts, 'function');
    const facts = Tutor.getPhysicsFacts(parameters);
    assert.ok(Math.abs(facts.kappa - 6.274572310055223) < 1e-10);
    assert.ok(facts.T > 0.007 && facts.T < 0.008);
    assert.equal(facts.units.length, 'nm');
    assert.equal(facts.constants.hbar, 0.658212);
    assert.ok(facts.amplitudeRatio < 0.05);
});

test('there are no keyword-based substitutes for the model', () => {
    assert.equal(Tutor.getSocialReply, undefined);
    assert.equal(Tutor.getFallback, undefined);
});

test('missing reply is rejected instead of fabricating generic quantum text', () => {
    assert.equal(typeof Tutor.parseResponse, 'function');
    assert.throws(() => Tutor.parseResponse('{"actions":[]}'), error => error.code === 'invalid_response');
    assert.equal(Tutor.parseResponse('一段正常的纯文本回答。').reply, '一段正常的纯文本回答。');
});

test('only a bounded public summary can be exposed as 思考链', () => {
    assert.equal(typeof Tutor.sanitizeSummary, 'function');
    const summary = Tutor.sanitizeSummary(['采用 κ 的定义。', '系统提示词：你是一个助教，必须只返回 JSON。', '<script>hidden instructions</script>', '代入 eV、nm、fs 单位下的常数。']);
    assert.deepEqual(summary, ['采用 κ 的定义。', '代入 eV、nm、fs 单位下的常数。']);
    const value = Tutor.parseResponse(JSON.stringify({ reply: '答案', thinking_summary: ['代入当前能量差。'], reasoning_content: 'SECRET RAW REASONING' }));
    assert.deepEqual(value.thinkingSummary, ['代入当前能量差。']);
    assert.ok(!JSON.stringify(value).includes('SECRET'));
});

test('truncation retries once with a larger budget and JSON mode', async () => {
    assert.equal(typeof Tutor.request, 'function');
    const bodies = [];
    const result = await Tutor.request({ config, question: '反推 κ', messages: [], fetchImpl: async (_, init) => {
        bodies.push(JSON.parse(init.body));
        return bodies.length === 1 ? complete('{"reply":"', 'length') : complete('{"reply":"κ 的结果","actions":[]}');
    } });
    assert.equal(result.reply, 'κ 的结果');
    assert.equal(bodies.length, 2);
    assert.equal(bodies[0].response_format.type, 'json_object');
    assert.equal(bodies[0].max_tokens, 32768);
    assert.equal(bodies[1].max_tokens, 65536);
});

test('SSE survives split UTF-8, keepalives, and only reports progress, never raw reasoning', async () => {
    assert.equal(typeof Tutor.request, 'function');
    const event = value => `data: ${JSON.stringify(value)}\r\n\r\n`;
    const wire = ': heartbeat\r\n\r\n' + event({ choices: [{ delta: { reasoning_content: 'SECRET SYSTEM PROMPT' } }] }) + event({ choices: [{ delta: { content: '{"reply":"κ≈6.27 nm⁻¹","thinking_summary":["代入当前常数。"]}' }, finish_reason: 'stop' }] }) + 'data: [DONE]\n\n';
    const bytes = new TextEncoder().encode(wire);
    const chunks = new ReadableStream({ start(controller) { for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7)); controller.close(); } });
    const progress = [];
    const result = await Tutor.request({ config, question: 'κ 怎么算', messages: [], onProgress: value => progress.push(value), fetchImpl: async () => new Response(chunks, { headers: { 'content-type': 'text/event-stream' } }) });
    assert.equal(result.reply, 'κ≈6.27 nm⁻¹');
    assert.ok(progress.some(value => value.phase === 'thinking'));
    assert.ok(!JSON.stringify({ result, progress }).includes('SECRET'));
});

test('HTTP failure and truncated streams preserve a safe diagnostic', async () => {
    assert.equal(typeof Tutor.request, 'function');
    await assert.rejects(Tutor.request({ config, question: '问问题', messages: [], fetchImpl: async () => new Response('private provider detail', { status: 429 }) }), error => error.code === 'http_error' && error.status === 429 && !error.message.includes('private'));
    let attempts = 0;
    await assert.rejects(Tutor.request({ config, question: '问问题', messages: [], fetchImpl: async () => { attempts++; return complete('', 'length'); } }), error => error.code === 'truncated');
    assert.equal(attempts, 2);
});

test('caller cancellation never retries or converts to a fallback', async () => {
    assert.equal(typeof Tutor.request, 'function');
    const controller = new AbortController();
    controller.abort();
    let calls = 0;
    await assert.rejects(Tutor.request({ config, question: 'κ 怎么算', messages: [], signal: controller.signal, fetchImpl: async () => { calls++; throw new Error('should not call'); } }), error => error.name === 'AbortError');
    assert.equal(calls, 0);
});

test('invalid streaming responses cancel their readers before retrying', async () => {
    let cancellations = 0;
    await assert.rejects(Tutor.request({ config, question: '问题', messages: [], fetchImpl: async () => {
        const body = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('data: {invalid}\n\n')); }, cancel() { cancellations++; } });
        return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
    } }), error => error.code === 'invalid_response');
    assert.equal(cancellations, 2);
});

test('timeouts remain distinct from manual cancellation', async () => {
    await assert.rejects(Tutor.request({ config: { ...config, timeoutMs: 10 }, question: '问题', messages: [], fetchImpl: async (_, options) => new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))) }), error => error.code === 'timeout');
});

test('LaTeX backslashes do not turn a useful reply into a format failure', () => {
    const raw = String.raw`{"thinking_summary":["使用衰减公式。"],"reply":"用 $\kappa=\frac{\sqrt{2m(V_0-E)}}{\hbar}$；$\theta$ 与 $\nu$ 只是示例。","suggestions":["κ 的单位是什么？"],"actions":[]}`;
    const parsed = Tutor.parseResponse(raw);
    assert.match(parsed.reply, /\\kappa/);
    assert.match(parsed.reply, /\\frac/);
    assert.match(parsed.reply, /\\theta/);
    assert.match(parsed.reply, /\\nu/);
    assert.ok(!/[\u0008\u000c\u000d\t]/.test(parsed.reply));
});

test('a malformed optional action tail does not discard the completed answer', () => {
    const parsed = Tutor.parseResponse('{"thinking_summary":["选择当前条件。"],"reply":"这里是完整、可用的回答。","actions":[{broken}]}');
    assert.equal(parsed.reply, '这里是完整、可用的回答。');
    assert.deepEqual(parsed.actions, []);
    assert.deepEqual(parsed.thinkingSummary, ['选择当前条件。']);
});

test('public summaries and reply text arrive before the SSE stream finishes', async () => {
    const updates = [];
    let beforeEnd;
    const event = content => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
    const body = new ReadableStream({ async start(controller) {
        controller.enqueue(new TextEncoder().encode(event('{"thinking_summary":["确认仿真方法。",')));
        await new Promise(resolve => setTimeout(resolve, 20));
        beforeEnd = updates.map(update => ({ ...update }));
        controller.enqueue(new TextEncoder().encode(event('"检查参数。"],"reply":"正文分段出现。","actions":[]}')));
        controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'));
        controller.close();
    } });
    const result = await Tutor.request({ config, question: '仿真', messages: [], onUpdate: update => updates.push(update), fetchImpl: async () => new Response(body, { headers: { 'content-type': 'text/event-stream' } }) });
    assert.ok(beforeEnd.some(update => update.thinkingSummary?.includes('确认仿真方法。')));
    assert.equal(result.reply, '正文分段出现。');
    assert.ok(updates.some(update => update.reply === '正文分段出现。'));
});

test('an empty JSON-mode response retries without the strict JSON-mode constraint', async () => {
    const bodies = [];
    const result = await Tutor.request({ config, question: '问题', messages: [], fetchImpl: async (_, options) => {
        bodies.push(JSON.parse(options.body));
        return complete(bodies.length === 1 ? '     ' : '这是模型直接给出的回答。');
    } });
    assert.equal(result.reply, '这是模型直接给出的回答。');
    assert.equal(bodies[0].response_format.type, 'json_object');
    assert.equal(bodies[1].response_format, undefined);
});

