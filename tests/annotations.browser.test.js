// Optional browser regression: npm install --no-save --prefix /tmp/quantum-test playwright
// NODE_PATH=/tmp/quantum-test/node_modules node --test tests/annotations.browser.test.js
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');
let browser, server, base;
before(async () => {
    server = createServer(async (req, res) => {
        const file = new URL(req.url, 'http://localhost').pathname;
        if (!/^\/(?:index\.html|main\.js|physics\.js|annotations\.js|tutor\.js|styles\.css)?$/.test(file)) { res.writeHead(404).end(); return; }
        try {
            const name = file === '/' ? 'index.html' : file.slice(1);
            const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
            res.setHeader('Content-Type', types[path.extname(name)]);
            res.end(await readFile(path.join(__dirname, '..', name)));
        } catch { res.writeHead(404).end(); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
});
after(async () => { await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)); });

async function openPage(t, viewport = { width: 1280, height: 900 }, options = {}) {
    const page = await browser.newPage({ viewport, ...options });
    t.after(() => page.close());
    // Never spend API credits, load remote scripts or transmit the bundled credential.
    await page.route('https://**', route => route.abort());
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.setDefaultTimeout(8000);
    await page.goto(base, { timeout: 30000 });
    await page.evaluate(() => { isPlaying = false; });
    t.after(() => assert.deepEqual(errors, [], 'no uncaught browser errors'));
    return page;
}
async function show(page, payload) {
    await page.evaluate(async payload => {
        await scrollAssistantTargetIntoView(payload.target);
        await showAssistantAnnotation(payload);
    }, payload);
    await page.locator('#aiAnnotationLayer.active').waitFor();
}
async function checkGeometry(page) {
    const info = await page.evaluate(() => {
        const label = document.getElementById('aiAnnotationLabel').getBoundingClientRect();
        const line = document.querySelector('.ai-annotation-arrow');
        const start = line && getComputedStyle(line).display !== 'none' ? line.getPointAtLength(0) : null;
        return { left: label.left, right: label.right, top: label.top, bottom: label.bottom, start: start && { x: start.x, y: start.y }, width: innerWidth, height: innerHeight };
    });
    assert.ok(info.left >= 15 && info.right <= info.width - 15, JSON.stringify(info));
    assert.ok(info.top >= 15 && info.bottom <= info.height - 15, JSON.stringify(info));
    if (info.start) assert.ok(Math.min(Math.abs(info.start.x - info.left), Math.abs(info.start.x - info.right), Math.abs(info.start.y - info.top), Math.abs(info.start.y - info.bottom)) < 1, 'arrow touches measured card edge');
}

test('short and long arrow cards stay attached after resizing and scrolling', async t => {
    const page = await openPage(t);
    for (const label of ['调高 V₀，T 下降', '调整势垒高度并观察当前参数下中心能量理论透射率的变化。'.repeat(5)]) {
        await show(page, { target: 'v0Slider', shape: 'arrow', label });
        await checkGeometry(page);
        assert.ok(await page.locator('#aiAnnotationLabel').evaluate(el => el.getBoundingClientRect().width <= 301), 'long labels wrap at the card width');
        await page.setViewportSize({ width: 768, height: 700 });
        await page.waitForTimeout(150);
        if (!await page.locator('#aiAnnotationLayer.active').count()) {
            // Responsive layout can move the target offscreen: hide rather than leave a ghost arrow.
            assert.equal(await page.evaluate(() => assistantState.activeAnnotation), null);
            await show(page, { target: 'v0Slider', shape: 'arrow', label });
        }
        await checkGeometry(page);
        await page.mouse.wheel(0, 80);
        await page.waitForTimeout(150);
        const visible = await page.locator('#aiAnnotationLayer.active').count();
        if (visible) await checkGeometry(page);
        await page.setViewportSize({ width: 1280, height: 900 });
    }
});

test('practice reacts to the requested direction, reports measured T and cleans up', async t => {
    const page = await openPage(t);
    await show(page, { target: 'v0Slider', shape: 'interact', direction: 'increase', label: '调高势垒高度，观察 T' });
    assert.equal(await page.locator('.ai-annotation-kind').textContent(), '动手试试');
    await page.locator('.ai-annotation-focus').click();
    assert.equal(await page.evaluate(() => document.activeElement.id), 'v0Slider');
    await page.keyboard.press('ArrowLeft');
    assert.equal(await page.locator('#aiAnnotationLabel').getAttribute('data-state'), 'waiting');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator('#aiAnnotationLabel').getAttribute('data-state'), 'complete');
    assert.match(await page.locator('.ai-annotation-feedback').textContent(), /理论 T/);
    assert.ok(await page.locator('.ai-annotation-explain').isVisible());
    if (process.env.ANNOTATION_SCREENSHOTS) await page.screenshot({ animations: 'disabled', path: path.join(process.env.ANNOTATION_SCREENSHOTS, 'desktop-complete.png') });
    await page.locator('.ai-annotation-close').click();
    assert.equal(await page.locator('#aiAnnotationLayer').getAttribute('aria-hidden'), 'true');
    assert.equal(await page.locator('#v0Slider').getAttribute('aria-describedby'), null);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'v0Slider');
    assert.equal(await page.evaluate(() => assistantState.activeAnnotation), null);
});

test('pulse, dark mode, reduced motion and mobile card remain usable', async t => {
    const page = await openPage(t, { width: 375, height: 667 }, { reducedMotion: 'reduce' });
    await page.evaluate(() => document.body.classList.add('dark-mode'));
    await show(page, { target: 'v0Slider', shape: 'pulse', label: '看这里的势垒高度' });
    assert.equal(await page.locator('.ai-annotation-pulse').count(), 1);
    assert.equal(await page.locator('.ai-annotation-pulse').evaluate(el => getComputedStyle(el).animationName), 'none');
    await checkGeometry(page);
    if (process.env.ANNOTATION_SCREENSHOTS) await page.screenshot({ animations: 'disabled', path: path.join(process.env.ANNOTATION_SCREENSHOTS, 'mobile-dark-pulse.png') });
    const line = page.locator('.ai-annotation-arrow');
    assert.equal(await line.evaluate(el => getComputedStyle(el).strokeDashoffset), '0px');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#aiAnnotationLayer.active').count(), 0);
});

test('a newer annotation or tab change cancels pending practice', async t => {
    const page = await openPage(t);
    await show(page, { target: 'v0Slider', shape: 'interact', label: '改变高度' });
    await show(page, { target: 'dSlider', shape: 'arrow', label: '现在看宽度' });
    await page.locator('#v0Slider').focus();
    await page.keyboard.press('ArrowRight');
    assert.match(await page.locator('#aiAnnotationLabel').textContent(), /现在看宽度/);
    await page.evaluate(() => activateTab('theory'));
    assert.equal(await page.locator('#aiAnnotationLayer.active').count(), 0);
});

test('a model-chosen practice plan remains interactive without client rewrites', async t => {
    const page = await openPage(t);
    const actions = await page.evaluate(() => inferAssistantInteractionActions('让我自己调高势垒高度试试', { reply: '拖动滑块', actions: [
        { type: 'pauseSimulation', payload: {} },
        { type: 'annotate', payload: { target: 'v0Slider', shape: 'interact', direction: 'increase', label: '调高 V₀' } },
        { type: 'annotate', payload: { target: 'tValue', shape: 'pulse', label: '理论 T' } }
    ] }));
    assert.deepEqual(actions.map(action => action.type), ['pauseSimulation', 'annotate', 'annotate']);
    assert.equal(actions[1].payload.shape, 'interact');
    assert.equal(actions[2].payload.target, 'tValue');
});

test('observation offers a local practice entry without another model request', async t => {
    const page = await openPage(t);
    await show(page, { target: 'dSlider', shape: 'arrow', label: '试着观察宽度的变化' });
    await page.locator('.ai-annotation-try').click();
    assert.equal(await page.locator('#aiAnnotationLabel').getAttribute('data-shape'), 'interact');
    assert.match(await page.locator('.ai-annotation-instruction').textContent(), /势垒宽度/);
});


test('a non-range interact annotation degrades to observation and does not block later actions', async t => {
    const page = await openPage(t);
    await page.evaluate(async () => {
        await executeAssistantActions([
            { type: 'annotate', payload: { target: 'energyCanvas', shape: 'interact', label: '观察能量', duration: 1500 } },
            { type: 'playSimulation', payload: {} }
        ]);
    });
    assert.equal(await page.evaluate(() => isPlaying), true);
});

test('conceptual questions are not mistaken for a request to operate sliders', async t => {
    const page = await openPage(t);
    const result = await page.evaluate(() => {
        const response = { reply: '波函数在势垒内衰减。', actions: [{ type: 'annotate', payload: { target: 'chartCanvas', shape: 'pulse' } }] };
        return inferAssistantInteractionActions('为什么增大宽度会降低透射率？', response);
    });
    assert.equal(result[0].payload.shape, 'pulse');
    assert.equal(result[0].payload.target, 'chartCanvas');
});

test('practice waits for a real action, rejects scripted changes, and dismiss cancels the sequence', async t => {
    const page = await openPage(t);
    await page.evaluate(() => {
        window.practiceRun = executeAssistantActions([
            { type: 'annotate', payload: { target: 'v0Slider', shape: 'interact', direction: 'increase', label: '调高高度' } },
            { type: 'jumpTab', payload: { tab: 'history' } }
        ]);
    });
    await page.locator('#aiAnnotationLabel[data-shape="interact"]').waitFor();
    await page.waitForTimeout(1700);
    assert.equal(await page.evaluate(() => currentTab), 'sim');
    await page.evaluate(() => {
        const slider = document.getElementById('v0Slider');
        slider.value = '2.2';
        slider.dispatchEvent(new Event('input'));
        slider.dispatchEvent(new Event('change'));
    });
    assert.equal(await page.locator('#aiAnnotationLabel').getAttribute('data-state'), 'waiting');
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.practiceRun);
    assert.equal(await page.evaluate(() => currentTab), 'sim');
});

test('successful practice permits the next action only after committing the change', async t => {
    const page = await openPage(t);
    await page.evaluate(() => {
        window.practiceRun = executeAssistantActions([
            { type: 'annotate', payload: { target: 'dSlider', shape: 'interact', label: '改变宽度' } },
            { type: 'jumpTab', payload: { tab: 'data' } }
        ]);
    });
    await page.locator('#aiAnnotationLabel[data-shape="interact"]').waitFor();
    await page.locator('.ai-annotation-focus').click();
    await page.keyboard.press('ArrowRight');
    await page.evaluate(() => window.practiceRun);
    assert.equal(await page.evaluate(() => currentTab), 'data');
    assert.equal(await page.locator('#aiAnnotationLayer.active').count(), 0);
});

test('mobile practice does not cover the slider and can be closed with touch', async t => {
    const page = await openPage(t, { width: 375, height: 667 }, { isMobile: true, hasTouch: true });
    await show(page, { target: 'eSlider', shape: 'interact', direction: 'decrease', label: '调低总能量，观察透射率' });
    await checkGeometry(page);
    const boxes = await page.evaluate(() => {
        const card = document.getElementById('aiAnnotationLabel').getBoundingClientRect();
        const slider = document.getElementById('eSlider').getBoundingClientRect();
        return { card: { top: card.top, bottom: card.bottom }, slider: { top: slider.top, bottom: slider.bottom } };
    });
    assert.ok(boxes.card.bottom < boxes.slider.top || boxes.card.top > boxes.slider.bottom, JSON.stringify(boxes));
    if (process.env.ANNOTATION_SCREENSHOTS) await page.screenshot({ animations: 'disabled', path: path.join(process.env.ANNOTATION_SCREENSHOTS, 'mobile-practice.png') });
    await page.locator('.ai-annotation-close').tap();
    assert.equal(await page.locator('#aiAnnotationLayer.active').count(), 0);
});

test('annotation labels are text, and older pending targets cannot replace a new card', async t => {
    const page = await openPage(t);
    await page.evaluate(async () => {
        window.oldAnnotation = showAssistantAnnotation({ target: 'theoryNumerovCanvas', shape: 'arrow', label: '过期目标' });
        await showAssistantAnnotation({ target: 'energyCanvas', shape: 'pulse', label: '<img src=x onerror="window.injected=true">' });
        await window.oldAnnotation;
    });
    assert.equal(await page.locator('#aiAnnotationLabel img').count(), 0);
    assert.equal(await page.evaluate(() => window.injected), undefined);
    assert.match(await page.locator('.ai-annotation-text').textContent(), /<img/);
});

test('a normal AI reply can launch practice and the explanation button includes the measured comparison', async t => {
    const page = await openPage(t);
    const requests = [];
    await page.route('**/chat/completions', async route => {
        const body = route.request().postDataJSON();
        requests.push(body.messages.at(-1).content);
        const answer = requests.length === 1
            ? { reply: '你可以亲自调整宽度并比较透射率。', actions: [{ type: 'annotate', payload: { target: 'dSlider', shape: 'interact', direction: 'increase', label: '增大势垒宽度，观察 T' } }] }
            : { reply: '宽度增加后，当前参数下的理论透射率降低。', actions: [] };
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer) } }] }) });
    });
    await page.locator('#aiTutorLauncher').click();
    await page.locator('#aiTutorInput').fill('宽度如何影响透射？');
    await page.locator('#aiTutorSend').click();
    await page.locator('#aiAnnotationLabel[data-shape="interact"]').waitFor();
    await page.locator('.ai-annotation-focus').click();
    await page.keyboard.press('ArrowRight');
    await page.locator('.ai-annotation-explain').click();
    await page.waitForFunction(() => !assistantState.isLoading);
    assert.equal(requests.length, 2);
    assert.match(requests[1], /势垒宽度 d.*0\.50 → 0\.55.*理论 T/s);
    assert.equal(await page.locator('#aiTutorPanel').getAttribute('aria-hidden'), 'false');
});

test('ring and spotlight remain supported and passive hints clean up on expiry', async t => {
    const page = await openPage(t);
    await show(page, { target: 'energyCanvas', shape: 'ring', label: '能量图', duration: 1500 });
    assert.equal(await page.locator('.ai-annotation-ring').count(), 1);
    await page.locator('#aiAnnotationLayer.active').waitFor({ state: 'hidden', timeout: 4000 });
    assert.equal(await page.locator('#aiAnnotationLabel button').count(), 0);
    await show(page, { target: 'energyCanvas', shape: 'spotlight', label: '聚光区域' });
    assert.equal(await page.locator('#aiSpotlight.active').count(), 1);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#aiSpotlight.active').count(), 0);
});

test('annotations contain no visible explanatory captions', async t => {
    const page = await openPage(t);
    await show(page, { target: 'v0Slider', shape: 'interact', label: '调高 V₀' });
    assert.equal(await page.locator('.ai-annotation-kind').isVisible(), false, 'do not show an extra category caption');
    const instruction = await page.locator('.ai-annotation-instruction').evaluate(el => ({ height: el.getBoundingClientRect().height, clip: getComputedStyle(el).clipPath }));
    assert.ok(instruction.height <= 1 && instruction.clip === 'inset(50%)', 'keyboard help is screen-reader-only');
    const textSize = await page.locator('.ai-annotation-feedback').evaluate(el => parseFloat(getComputedStyle(el).fontSize));
    assert.ok(textSize >= 14, 'data results are normal-sized text, not small explanatory print');
});


test('greetings use the model with full thinking and no forced page actions', async t => {
    const page = await openPage(t);
    let calls = 0;
    let body;
    await page.route('**/chat/completions', route => {
        calls++;
        body = route.request().postDataJSON();
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ reply: '你好。今天想聊点什么？', actions: [] }) }, finish_reason: 'stop' }] }) });
    });
    await page.evaluate(() => handleAssistantPrompt('你好'));
    assert.equal(calls, 1);
    assert.equal(body.thinking.type, 'enabled');
    assert.equal(body.reasoning_effort, 'high');
    assert.equal(body.max_tokens, 32768);
    assert.equal(await page.evaluate(() => currentTab), 'sim');
    assert.equal(await page.locator('.ai-tutor-message.assistant .ai-tutor-message-content').last().textContent(), '你好。今天想聊点什么？');
});

test('model requests carry real constants, a full thinking budget, and no loading placeholder in history', async t => {
    const page = await openPage(t);
    let body;
    await page.route('**/chat/completions', async route => {
        body = route.request().postDataJSON();
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ reply: 'κ 的单位是 nm⁻¹。', actions: [] }) }, finish_reason: 'stop' }] }) });
    });
    await page.evaluate(() => handleAssistantPrompt('κ 的数值怎么算？'));
    assert.ok(body.max_tokens >= 32768);
    assert.equal(body.thinking.type, 'enabled');
    assert.equal(body.response_format.type, 'json_object');
    assert.ok(body.messages.some(message => message.content.includes('0.658212') && message.content.includes('5.68563')));
    assert.ok(!body.messages.some(message => message.content.includes('正在生成讲解和页面提示')));
    assert.equal(await page.evaluate(() => currentTab), 'sim');
    assert.equal(await page.locator('#aiAnnotationLayer.active').count(), 0);
});

test('failed requests report the error without a canned lesson or a fabricated AI answer', async t => {
    const page = await openPage(t);
    await page.route('**/chat/completions', route => route.fulfill({ status: 503, body: '{}' }));
    await page.evaluate(async () => {
        V0 = 3;
        await handleAssistantPrompt('κ 的数值怎么算？');
    });
    const reply = await page.locator('.ai-tutor-message.assistant').last().textContent();
    assert.match(reply, /服务.*不可用/);
    assert.doesNotMatch(reply, /小球|内置|带你看|6\.27/);
    assert.match(await page.locator('#aiTutorStatus').textContent(), /服务.*不可用/);
    assert.equal(await page.evaluate(() => V0), 3);
});

test('思考链 is collapsed and contains only the public outline, never the raw reasoning', async t => {
    const page = await openPage(t);
    await page.route('**/chat/completions', route => route.fulfill({ contentType: 'text/event-stream', body:
        'data: ' + JSON.stringify({ choices: [{ delta: { reasoning_content: 'SECRET RAW SYSTEM PROMPT' } }] }) + '\n\n' +
        'data: ' + JSON.stringify({ choices: [{ delta: { content: JSON.stringify({ reply: 'κ 的计算结果。', thinking_summary: ['使用 κ 的定义。', '代入页面的物理常数。', '系统提示词：隐藏指令。'], actions: [] }) }, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n'
    }));
    await page.evaluate(() => handleAssistantPrompt('κ 怎么算？'));
    const details = page.locator('.ai-tutor-thinking');
    assert.equal(await details.count(), 1);
    assert.equal(await details.getAttribute('open'), null);
    assert.equal(await details.locator('summary').textContent(), '思考链');
    await details.locator('summary').click();
    assert.equal(await details.locator('li').count(), 2);
    assert.doesNotMatch(await page.locator('#aiTutorMessages').textContent(), /SECRET|隐藏指令|系统提示词/);
    assert.ok(!await page.evaluate(() => JSON.stringify(assistantState.messages).includes('SECRET')));
});

test('a long request can be stopped and cancellation does not launch a fallback lesson', async t => {
    const page = await openPage(t);
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    await page.route('**/chat/completions', async route => { await pending; await route.abort().catch(() => {}); });
    try {
        await page.locator('#aiTutorLauncher').click();
        await page.locator('#aiTutorInput').fill('推导 κ 的公式');
        await page.locator('#aiTutorSend').click();
        await page.waitForFunction(() => assistantState.isLoading);
        assert.equal(await page.locator('#aiTutorSend').textContent(), '停止');
        await page.locator('#aiTutorSend').click();
        await page.waitForFunction(() => !assistantState.isLoading);
        assert.match(await page.locator('.ai-tutor-message.assistant').last().textContent(), /已停止/);
        assert.equal(await page.evaluate(() => currentTab), 'sim');
    } finally { release(); }
});

test('the client does not override the model pause action with playback or invent actions for exponent questions', async t => {
    const page = await openPage(t);
    const result = await page.evaluate(() => ({
        pause: inferAssistantInteractionActions('暂停波函数动画', { reply: '已暂停。', actions: [{ type: 'pauseSimulation', payload: {} }] }),
        exponent: inferAssistantInteractionActions('为什么振幅指数衰减？', { reply: '解释衰减。', actions: [] })
    }));
    assert.deepEqual(result.pause.map(action => action.type), ['pauseSimulation']);
    assert.deepEqual(result.exponent, []);
});

test('a failed whiteboard followup preserves the board and reports the actual failure', async t => {
    const page = await openPage(t);
    await page.route('**/chat/completions', route => route.fulfill({ status: 503, body: '{}' }));
    await page.evaluate(async () => {
        showAssistantWhiteboard({ title: '原有推导', steps: ['<p>保留这一行推导。</p>'] });
        await handleWhiteboardFollowup('这一步为什么成立？');
    });
    assert.match(await page.locator('#aiWhiteboardBody').textContent(), /保留这一行推导/);
    assert.match(await page.locator('.ai-whiteboard-error[role="alert"]').textContent(), /服务.*不可用/);
});

for (const mode of ['desktop', 'mobile-dark']) {
    test(`public 思考链 layout remains readable on ${mode}`, async t => {
        const page = await openPage(t, mode === 'desktop' ? { width: 1280, height: 900 } : { width: 375, height: 667 });
        if (mode !== 'desktop') await page.evaluate(() => document.body.classList.add('dark-mode'));
        await page.route('**/chat/completions', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ reply: '代入页面的常数和当前能量差，κ≈6.275 nm⁻¹。不能直接把 m 和 ℏ 设成 1。', thinking_summary: ['采用势垒内的衰减常数公式。', '使用 eV、nm、fs 单位下的 m 和 ℏ。', '检查结果的单位为 nm⁻¹。'], actions: [] }) } }] }) }));
        await page.evaluate(() => { V0 = 3; syncParamDisplays(); resetAndRender(); return handleAssistantPrompt('κ 的数值怎么算？'); });
        const details = page.locator('.ai-tutor-thinking');
        await details.locator('summary').click();
        const panel = await page.locator('#aiTutorPanel').boundingBox();
        assert.ok(panel.x >= 0 && panel.x + panel.width <= (mode === 'desktop' ? 1280 : 375));
        assert.equal(await details.locator('li').count(), 3);
        if (process.env.AI_SCREENSHOTS) await page.screenshot({ animations: 'disabled', path: path.join(process.env.AI_SCREENSHOTS, `${mode}.png`) });
    });
}

test('suggestions remain visible during a request, empty output, and errors', async t => {
    const page = await openPage(t);
    const before = await page.locator('#aiTutorSuggestions button').allTextContents();
    let finish;
    const pending = new Promise(resolve => { finish = resolve; });
    await page.route('**/chat/completions', async route => {
        await pending;
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: '{"reply":"模型回答","suggestions":[],"actions":[]}' }, finish_reason: 'stop' }] }) });
    });
    await page.evaluate(() => { window.suggestionRun = handleAssistantPrompt('我想看看怎么仿真的'); });
    try {
        assert.deepEqual(await page.locator('#aiTutorSuggestions button').allTextContents(), before);
        assert.ok(await page.locator('#aiTutorSuggestions button').first().isDisabled());
    } finally { finish(); }
    await page.evaluate(() => window.suggestionRun);
    const after = await page.locator('#aiTutorSuggestions button').allTextContents();
    assert.notDeepEqual(after, before);
    assert.ok(await page.locator('#aiTutorSuggestions button').first().isEnabled());
    await page.unroute('**/chat/completions');
    await page.route('**/chat/completions', route => route.fulfill({ status: 503, body: '{}' }));
    await page.evaluate(() => handleAssistantPrompt('怎么操作呢？'));
    assert.deepEqual(await page.locator('#aiTutorSuggestions button').allTextContents(), after);
});

test('model context describes the real Crank–Nicolson solver and sigma behavior', async t => {
    const page = await openPage(t);
    const context = await page.evaluate(() => getAssistantContext());
    const text = JSON.stringify(context);
    assert.match(text, /Crank.Nicolson/);
    assert.match(text, /Numerov/);
    assert.match(text, /sigma|σ/);
    assert.match(text, /FFT/);
    assert.ok(context.simulation.controls.sigmaSlider.resetsPacket);
});

test('public 思考链 and body stream into the current bubble without raw reasoning', async t => {
    const page = await openPage(t);
    await page.evaluate(() => {
        const original = window.fetch;
        window.fetch = (url, options) => {
            if (!String(url).endsWith('/chat/completions')) return original(url, options);
            return Promise.resolve(new Response(new ReadableStream({
                start(controller) {
                    window.replyController = controller;
                    options.signal.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')));
                }
            }), { headers: { 'content-type': 'text/event-stream' } }));
        };
        window.pushReply = chunk => replyController.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(chunk)}\n\n`));
        window.streamRun = handleAssistantPrompt('我想看看怎么仿真的');
    });
    await page.waitForFunction(() => !!window.replyController);
    await page.evaluate(() => pushReply({ choices: [{ delta: { reasoning_content: 'SECRET RAW SYSTEM PROMPT' } }] }));
    await page.evaluate(() => pushReply({ choices: [{ delta: { content: '{"thinking_summary":["使用实际的含时算法。",' } }] }));
    await page.waitForFunction(() => !!document.querySelector('.ai-tutor-thinking'));
    assert.equal(await page.locator('.ai-tutor-thinking').getAttribute('open'), null);
    await page.locator('.ai-tutor-thinking summary').click();
    assert.match(await page.locator('.ai-tutor-thinking').textContent(), /实际的含时算法/);
    assert.equal(await page.evaluate(() => assistantState.isLoading), true);
    await page.evaluate(() => pushReply({ choices: [{ delta: { content: '"检查波包参数。"],"reply":"这里使用 Crank–Nicolson' } }] }));
    await page.waitForFunction(() => document.querySelector('.ai-tutor-message.loading .ai-tutor-message-content')?.textContent.includes('Crank'));
    assert.equal(await page.evaluate(() => assistantState.isLoading), true);
    assert.doesNotMatch(await page.locator('#aiTutorMessages').textContent(), /SECRET|thinking_summary|"reply"/);
    await page.evaluate(() => {
        pushReply({ choices: [{ delta: { content: ' 方法。","suggestions":["σ 改变了什么？"],"actions":[]}' }, finish_reason: 'stop' }] });
        replyController.close();
    });
    await page.evaluate(() => window.streamRun);
    assert.equal(await page.locator('.ai-tutor-thinking').getAttribute('open'), '');
    assert.deepEqual(await page.locator('#aiTutorSuggestions button').allTextContents(), ['让我调整势垒宽度', '势垒内为什么有振幅？', '透射率和振幅有何区别？', '用白板推导隧穿公式']);
    assert.ok(!await page.evaluate(() => JSON.stringify(assistantState.messages).includes('SECRET')));
});

for (const origin of ['history', 'theory', 'data']) {
    test(`targeting a parameter from ${origin} navigates before annotating`, async t => {
        const page = await openPage(t, { width: 375, height: 667 });
        await page.evaluate(async origin => {
            activateTab(origin);
            window.controlRun = executeAssistantActions([{ type: 'annotate', payload: { target: 'dSlider', shape: 'interact', direction: 'decrease', label: '减小 d' } }]);
        }, origin);
        await page.locator('#aiAnnotationLabel[data-shape="interact"]').waitFor();
        assert.equal(await page.evaluate(() => currentTab), 'sim');
        assert.equal(await page.locator('#tabSim').getAttribute('aria-selected'), 'true');
        const box = await page.locator('#dSlider').boundingBox();
        assert.ok(box.y >= 0 && box.y + box.height <= 667);
        await page.locator('.ai-annotation-focus').click();
        await page.keyboard.press('ArrowLeft');
        await page.evaluate(() => window.controlRun);
        assert.equal(await page.locator('#aiAnnotationLabel').getAttribute('data-state'), 'complete');
    });
}

test('model target locations cover parameter and playback controls', async t => {
    const page = await openPage(t);
    const context = await page.evaluate(() => getAssistantContext());
    assert.equal(context.targetLocations.dSlider.tab, 'sim');
    assert.equal(context.targetLocations.playPauseBtn.tab, 'sim');
    assert.equal(context.targetLocations.theoryNumerovCanvas.tab, 'theory');
});

for (const width of [375, 1280]) {
    test(`curated questions ignore model suggestions and show full labels at ${width}px`, async t => {
        const page = await openPage(t, { width, height: width === 375 ? 667 : 900 });
        const expected = ['带我看一次仿真', '演示宽度扫描', 'σ 为什么影响透射？', 'κ 的数值怎么算？'];
        const before = await page.locator('#aiTutorSuggestions button').allTextContents();
        assert.deepEqual(before, expected);
        let body;
        await page.route('**/chat/completions', route => {
            body = route.request().postDataJSON();
            return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ reply: '模型的正常回答。', suggestions: ['想看宽度扫描，我可以切换到错误的标签页。'.repeat(10)], actions: [] }) }, finish_reason: 'stop' }] }) });
        });
        await page.evaluate(() => handleAssistantPrompt('你好'));
        assert.deepEqual(await page.locator('#aiTutorSuggestions button').allTextContents(), ['让我调整势垒宽度', '势垒内为什么有振幅？', '透射率和振幅有何区别？', '用白板推导隧穿公式']);
        const styles = await page.locator('#aiTutorSuggestions button').evaluateAll(buttons => buttons.map(button => ({
            ellipsis: getComputedStyle(button).textOverflow,
            whiteSpace: getComputedStyle(button).whiteSpace,
            width: button.clientWidth, scrollWidth: button.scrollWidth,
            visibleHeight: button.clientHeight, scrollHeight: button.scrollHeight
        })));
        assert.ok(styles.every(style => style.ellipsis !== 'ellipsis' && style.whiteSpace === 'nowrap'));
        assert.ok(styles.every(style => style.scrollWidth <= style.width + 1 && style.scrollHeight <= style.visibleHeight + 1));
        assert.ok(!body.messages[0].content.includes('"suggestions":'));
    });
}

test('theory result arrows end at the outer edge instead of crossing result text', async t => {
    const page = await openPage(t);
    await show(page, { target: 'theoryCalcResult', shape: 'arrow', label: '理论计算结果' });
    const result = await page.evaluate(() => {
        const target = document.getElementById('theoryCalcResult').getBoundingClientRect();
        const line = document.querySelector('.ai-annotation-arrow');
        const point = line.getPointAtLength(line.getTotalLength());
        return { x: point.x, y: point.y, left: target.left, right: target.right, top: target.top, bottom: target.bottom };
    });
    assert.ok(result.x < result.left || result.x > result.right || result.y < result.top || result.y > result.bottom);
    assert.equal(await page.locator('.ai-annotation-anchor').count(), 0);
    if (process.env.AI_SCREENSHOTS) await page.screenshot({ animations: 'disabled', path: path.join(process.env.AI_SCREENSHOTS, 'edge-arrow.png') });
});

const katexRoot = process.env.KATEX_TEST_ROOT;
test('real KaTeX inline and block formulas scroll inside their cards at phone width', { skip: !katexRoot }, async t => {
    const page = await openPage(t, { width: 375, height: 667 });
    await page.route('**/fonts/*', async route => {
        const name = path.basename(new URL(route.request().url()).pathname);
        if (!/^[\w.-]+\.(woff2?|ttf)$/.test(name)) return route.abort();
        await route.fulfill({ body: await readFile(path.join(katexRoot, 'dist/fonts', name)) });
    });
    await page.addStyleTag({ path: path.join(katexRoot, 'dist/katex.min.css') });
    await page.addScriptTag({ path: path.join(katexRoot, 'dist/katex.min.js') });
    await page.addScriptTag({ path: path.join(katexRoot, 'dist/contrib/auto-render.min.js') });
    await page.evaluate(() => {
        toggleAssistant(true);
        const formula = String.raw`\frac{\sqrt{2m(V_0-E)}}{\hbar}+\frac{\sqrt{2m(V_0-E)}}{\hbar}+\frac{\sqrt{2m(V_0-E)}}{\hbar}+\frac{\sqrt{2m(V_0-E)}}{\hbar}`;
        appendAssistantMessage('assistant', `行内公式 $${formula}$\n\n$$${formula}$$`);
        const result = document.getElementById('theoryCalcResult');
        result.textContent = `结果公式 $${formula}$`;
        renderMathInNode(result);
    });
    await page.evaluate(() => document.fonts.ready);
    const sizes = await page.locator('.ai-tutor-message-content').last().evaluate(node => ({ width: node.clientWidth, scroll: node.scrollWidth, page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(sizes.scroll <= sizes.width + 1, JSON.stringify(sizes));
    assert.ok(sizes.page <= sizes.viewport + 1, JSON.stringify(sizes));
    const displays = page.locator('.ai-tutor-message-content .katex-display');
    assert.ok(await displays.count());
    assert.equal(await displays.first().evaluate(el => getComputedStyle(el).overflowX), 'auto');
    assert.ok(await displays.first().evaluate(el => el.scrollWidth > el.clientWidth));
    if (process.env.AI_SCREENSHOTS) await page.screenshot({ animations: 'disabled', path: path.join(process.env.AI_SCREENSHOTS, 'math-chat.png') });
    await page.evaluate(() => {
        toggleAssistant(false);
        activateTab('theory');
        const result = document.getElementById('theoryCalcResult');
        result.textContent = '$$' + String.raw`\frac{1}{1+\frac{V_0^2\sinh^2(\kappa d)}{4E(V_0-E)}}+\frac{1}{1+\frac{V_0^2\sinh^2(\kappa d)}{4E(V_0-E)}}` + '$$';
        renderMathInNode(result);
    });
    const resultSize = await page.locator('#theoryCalcResult').evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth }));
    assert.ok(resultSize.scroll <= resultSize.width + 1, JSON.stringify(resultSize));
    await page.evaluate(() => showAssistantWhiteboard({ title: '长公式', steps: ['<div class="math-block">$$' + String.raw`\frac{1}{1+\frac{V_0^2\sinh^2(\kappa d)}{4E(V_0-E)}}+\frac{1}{1+\frac{V_0^2\sinh^2(\kappa d)}{4E(V_0-E)}}` + '$$</div>'] }));
    const board = await page.locator('#aiWhiteboardBody').evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth }));
    assert.ok(board.scroll <= board.width + 1, JSON.stringify(board));
});

test('width-scan actions open the theory width scene even from the history tab', async t => {
    const page = await openPage(t);
    await page.evaluate(async () => {
        activateTab('history');
        await executeAssistantActions([{ type: 'animateWidthSweep', payload: {} }]);
    });
    assert.equal(await page.evaluate(() => currentTab), 'theory');
    assert.equal(await page.evaluate(() => currentTheoryScene), 'width');
});

test('fixed questions are a single horizontally scrollable row with complete labels', async t => {
    const page = await openPage(t, { width: 375, height: 667 });
    await page.locator('#aiTutorLauncher').click();
    const row = page.locator('#aiTutorSuggestions');
    const info = await row.evaluate(el => ({ display: getComputedStyle(el).display, overflow: getComputedStyle(el).overflowX, width: el.clientWidth, scroll: el.scrollWidth }));
    assert.equal(info.display, 'flex');
    assert.equal(info.overflow, 'auto');
    assert.ok(info.scroll > info.width);
    await row.evaluate(el => { el.scrollLeft = el.scrollWidth; });
    await page.waitForTimeout(120);
    const last = await row.locator('button').last().boundingBox();
    const box = await row.boundingBox();
    assert.ok(last.x >= box.x && last.x + last.width <= box.x + box.width + 1);
});


test('the frontend preserves AI-chosen demo and practice plans without keyword routing', async t => {
    const page = await openPage(t);
    const result = await page.evaluate(() => {
        const demo = [
            { type: 'runTheoryScene', payload: { scene: 'width' } },
            { type: 'setTheoryFocus', payload: { focus: 'right' } },
            { type: 'setTheoryComponent', payload: { component: 'env' } }
        ];
        const practice = [
            { type: 'pauseSimulation', payload: {} },
            { type: 'annotate', payload: { target: 'dSlider', shape: 'interact', direction: 'increase', label: '增大 d' } },
            { type: 'annotate', payload: { target: 'tValue', shape: 'ring', label: '观察理论 T' } }
        ];
        return {
            demo: inferAssistantInteractionActions('让我看看宽度扫描', { reply: '观察扫描。', actions: demo }),
            practice: inferAssistantInteractionActions('让我自己调宽度', { reply: '你来调整。', actions: practice }),
            empty: inferAssistantInteractionActions('带我看一次仿真', { reply: '模型选择仅回答。', actions: [] })
        };
    });
    assert.deepEqual(result.demo.map(action => action.type), ['runTheoryScene', 'setTheoryFocus', 'setTheoryComponent']);
    assert.deepEqual(result.practice.map(action => action.type), ['pauseSimulation', 'annotate', 'annotate']);
    assert.equal(result.practice[1].payload.shape, 'interact');
    assert.deepEqual(result.empty, []);
});

test('successful replies rotate curated question groups; failures keep the current group', async t => {
    const page = await openPage(t);
    const initial = await page.locator('#aiTutorSuggestions button').allTextContents();
    await page.route('**/chat/completions', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: '{"reply":"模型的回答。","actions":[]}' }, finish_reason: 'stop' }] }) }));
    let previous = initial;
    for (let round = 0; round < 3; round++) {
        await page.evaluate(() => handleAssistantPrompt('继续说明'));
        const next = await page.locator('#aiTutorSuggestions button').allTextContents();
        assert.equal(next.length, 4);
        assert.notDeepEqual(next, previous);
        assert.ok(next.every(text => text.length < 24));
        previous = next;
    }
    assert.deepEqual(previous, initial);
    await page.unroute('**/chat/completions');
    await page.route('**/chat/completions', route => route.fulfill({ status: 503, body: '{}' }));
    await page.evaluate(() => handleAssistantPrompt('继续'));
    assert.deepEqual(await page.locator('#aiTutorSuggestions button').allTextContents(), previous);
});

test('AI can choose a teaching whiteboard without a whiteboard keyword in the question', async t => {
    const page = await openPage(t);
    await page.route('**/chat/completions', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({
        reply: '把波包宽度和动量分布的关系分开说明。',
        whiteboard: { title: 'σ 与动量分布', steps: ['<p>σ 变大，动量分布变窄。</p>', '<p>中心能量的理论 T 与整个波包的透射需要区分。</p>'] },
        actions: []
    }) } }] }) }));
    await page.evaluate(() => handleAssistantPrompt('σ 为什么影响透射？'));
    await page.locator('#aiWhiteboardBackdrop.active').waitFor();
    assert.equal(await page.locator('#aiWhiteboardTitle').textContent(), 'σ 与动量分布');
    assert.match(await page.locator('#aiWhiteboardBody').textContent(), /动量分布变窄/);
});

test('teaching prompt prioritizes useful interaction and allows autonomous board use', async t => {
    const page = await openPage(t);
    const prompt = await page.evaluate(() => buildAssistantSystemPrompt());
    assert.match(prompt, /由你结合学生的问题/);
    assert.match(prompt, /优先考虑交互式讲解/);
    assert.match(prompt, /白板可主动使用/);
    assert.match(prompt, /前端不会按提问关键词替你决定/);
    assert.match(prompt, /reply 与 actions 必须一致/);
    assert.doesNotMatch(prompt, /仅在用户明确要白板/);
    for (const name of ['runTheoryScene', 'setTheoryFocus', 'setTheoryComponent', 'animateParams', 'interact', 'showWhiteboard']) {
        assert.ok(prompt.includes(name));
    }
});

test('a model reply with prose before JSON displays once and still executes its actions', async t => {
    const page = await openPage(t);
    const reply = '数值透射率按右侧概率与初始总概率的比值统计。';
    await page.route('**/chat/completions', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: reply + '\n\n' + JSON.stringify({
        thinking_summary: ['统计右侧概率。'], reply,
        actions: [{ type: 'jumpTab', payload: { tab: 'sim' } }, { type: 'annotate', payload: { target: 'actualTValue', shape: 'ring', label: '数值 T' } }]
    }) } }] }) }));
    await page.evaluate(() => { activateTab('history'); return handleAssistantPrompt('数值 T 是怎么统计的？'); });
    await page.waitForFunction(() => assistantState.activeAnnotation?.target === 'actualTValue');
    const content = await page.locator('.ai-tutor-message.assistant .ai-tutor-message-content').last().textContent();
    assert.equal(content, reply);
    assert.doesNotMatch(content, /thinking_summary|"actions"|"reply"/);
    assert.equal(await page.evaluate(() => currentTab), 'sim');
});
