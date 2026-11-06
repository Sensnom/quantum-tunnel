(function(root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./physics.js'));
    else root.QuantumTutor = factory(root.QuantumPhysics);
})(typeof globalThis !== 'undefined' ? globalThis : this, function(physics) {
    'use strict';

    function failure(code, extra = {}) {
        return Object.assign(new Error(code), { code, ...extra });
    }

    function getRequestOptions() {
        return { thinking: { type: 'enabled' }, reasoning_effort: 'high', max_tokens: 32768 };
    }

    function getPhysicsFacts({ E, V0, d, mass, hbar }) {
        const { T, R } = physics.calculateRectBarrierTR({ E, V0, d, mass, hbar });
        const kappa = E < V0 ? Math.sqrt(2 * mass * (V0 - E)) / hbar : null;
        return {
            parameters: { E, V0, d },
            units: { energy: 'eV', length: 'nm', time: 'fs', mass: 'eV·fs²/nm²', kappa: 'nm⁻¹' },
            constants: { mass, hbar },
            regime: E < V0 ? 'tunneling' : E > V0 ? 'above_barrier' : 'threshold',
            kappa, kappaD: kappa === null ? null : kappa * d,
            amplitudeRatio: kappa === null ? null : Math.exp(-kappa * d),
            T, R,
            approximation: kappa === null ? null : {
                exponentialOnly: Math.exp(-2 * kappa * d),
                boundaryPrefactor: 16 * E * (V0 - E) / (V0 * V0),
                kappaFromTWithoutPrefactor: T > 0 && d > 0 ? -Math.log(T) / (2 * d) : null
            }
        };
    }

    // This is an explicitly public solution outline, never reasoning_content.
    // Filtering is defense in depth, not a replacement for keeping raw reasoning private.
    function sanitizeSummary(value) {
        if (!Array.isArray(value)) return [];
        const privateText = /<|>|system|prompt|reasoning_content|api.?key|token|json|提示词|系统|指令|角色设定|上下文原文|你是一个|必须返回|工具列表/i;
        return value.filter(line => typeof line === 'string' && line.trim() && line.length <= 140 && !privateText.test(line)).slice(0, 3).map(line => line.trim());
    }

    // Parse only the public fields. Optional metadata cannot invalidate a completed answer.
    // Model-generated LaTeX is often valid math but not correctly double-escaped JSON.
    function readString(text, start) {
        let value = '';
        const escapes = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' };
        const latex = /^(?:alpha|beta|gamma|delta|epsilon|theta|lambda|mu|nu|pi|rho|sigma|tau|phi|chi|psi|omega|kappa|hbar|frac|dfrac|tfrac|sqrt|exp|ln|log|sin|cos|sinh|cosh|tan|tanh|left|right|begin|end|text|mathrm|mathbf|mathbb|mathcal|lvert|rvert|langle|rangle|partial|nabla|times|cdot|approx|propto|ge|geq|le|leq|neq|pm|infty|int|sum|Delta|Psi|Sigma|Gamma|Theta|Phi|Omega)$/;
        for (let i = start + 1; i < text.length; i++) {
            const char = text[i];
            if (char === '"') return { value, end: i + 1, complete: true };
            if (char !== '\\') { value += char; continue; }
            if (i + 1 >= text.length) return { value, end: text.length, complete: false };
            const next = text[++i];
            if ('"\\/'.includes(next)) { value += next; continue; }
            const command = text.slice(i).match(/^[A-Za-z]+/)?.[0];
            if (command && latex.test(command)) { value += '\\' + command; i += command.length - 1; continue; }
            if (next === 'u') {
                const hex = text.slice(i + 1, i + 5);
                if (hex.length < 4) return { value, end: text.length, complete: false };
                if (/^[\da-f]{4}$/i.test(hex)) { value += String.fromCharCode(parseInt(hex, 16)); i += 4; continue; }
            }
            value += Object.hasOwn(escapes, next) ? escapes[next] : '\\' + next;
        }
        return { value, end: text.length, complete: false };
    }

    function valueEnd(text, start) {
        if (text[start] === '"') return readString(text, start);
        const stack = [];
        for (let i = start; i < text.length; i++) {
            const char = text[i];
            if (char === '"') {
                const string = readString(text, i);
                if (!string.complete) return string;
                i = string.end - 1;
            } else if (char === '[' || char === '{') stack.push(char);
            else if (char === ']' || char === '}') {
                if (!stack.length) return { end: i, complete: true };
                stack.pop();
                if (!stack.length) return { end: i + 1, complete: true };
            } else if (char === ',' && !stack.length) return { end: i, complete: true };
        }
        return { end: text.length, complete: false };
    }

    function readSummary(text, start) {
        if (text[start] !== '[') return [];
        const lines = [];
        let i = start + 1;
        while (i < text.length && lines.length < 3) {
            while (/[\s,]/.test(text[i] || '') && i < text.length) i++;
            if (text[i] !== '"') break;
            const string = readString(text, i);
            // Validate whole summary items before publishing; never leak a partially received instruction.
            if (!string.complete) break;
            lines.push(string.value);
            i = string.end;
        }
        return sanitizeSummary(lines);
    }

    function scanPublicFields(content) {
        const text = content.trimStart().replace(/^```(?:json)?\s*/i, '');
        const result = { reply: '', replyComplete: false, thinkingSummary: [], fields: {}, hasResponseField: false };
        if (text[0] !== '{') return result;
        let i = 1;
        while (i < text.length) {
            while (/[\s,]/.test(text[i] || '') && i < text.length) i++;
            if (text[i] !== '"') break;
            const key = readString(text, i);
            if (!key.complete) break;
            i = key.end;
            while (/\s/.test(text[i] || '') && i < text.length) i++;
            if (text[i++] !== ':') break;
            while (/\s/.test(text[i] || '') && i < text.length) i++;
            const start = i;
            if (['reply', 'thinking_summary', 'actions', 'whiteboard', 'reasoning_content'].includes(key.value)) result.hasResponseField = true;
            const end = valueEnd(text, start);
            if (key.value === 'reply' && text[start] === '"') {
                const reply = readString(text, start);
                result.reply = reply.value;
                result.replyComplete = reply.complete;
            } else if (key.value === 'thinking_summary') result.thinkingSummary = readSummary(text, start);
            if (!end.complete) break;
            if (['actions', 'whiteboard'].includes(key.value)) {
                try { result.fields[key.value] = JSON.parse(text.slice(start, end.end)); }
                catch { /* A broken optional field must not discard valid answer text. */ }
            }
            i = end.end;
        }
        return result;
    }

    const actionNames = new Set([
        'jumpTab', 'runTheoryScene', 'setTheoryFocus', 'setTheoryComponent',
        'animateParams', 'animateWidthSweep', 'playSimulation', 'pauseSimulation',
        'resetSimulation', 'scrollToTarget', 'annotate', 'showWhiteboard', 'clearAnnotations'
    ]);
    const controlNames = ['action', 'actions', 'tool_call', 'tool_calls', 'function_call', 'function_calls', 'think', 'analysis', 'reasoning', 'reasoning_content'];
    const actionTags = new Set(controlNames.slice(0, 6));

    function controlTagAt(text, index) {
        const tail = text.slice(index);
        const full = tail.match(/^<\s*(\/?)\s*([a-z_]+)(?=[\s/>])[^>]*>/i);
        if (full && controlNames.includes(full[2].toLowerCase())) {
            return { name: full[2].toLowerCase(), closing: Boolean(full[1]), end: index + full[0].length };
        }
        const pending = tail.match(/^<\s*\/?\s*([a-z_]*)([^>]*)$/i);
        if (pending) {
            const name = pending[1].toLowerCase();
            const unfinishedName = pending[2] === '' && controlNames.some(known => known.startsWith(name));
            const unfinishedTag = controlNames.includes(name) && /^\s/.test(pending[2]);
            if (unfinishedName || unfinishedTag) return { pending: true };
        }
        return null;
    }

    function controlClose(text, start, name) {
        let depth = 1;
        for (let i = start; i < text.length;) {
            // A literal closing tag inside a JSON argument is data, not a delimiter.
            if (text[i] === '"') {
                const string = readString(text, i);
                if (!string.complete) return null;
                i = string.end;
                continue;
            }
            const tag = text[i] === '<' ? controlTagAt(text, i) : null;
            if (tag && !tag.pending) {
                if (tag.name === name) depth += tag.closing ? -1 : 1;
                if (!depth) return { start: i, end: tag.end };
                i = tag.end;
            } else i++;
        }
        return null;
    }

    function decodeControlActions(value, depth = 0) {
        if (depth > 8) return [];
        if (Array.isArray(value)) return value.slice(0, 7).flatMap(item => decodeControlActions(item, depth + 1)).slice(0, 7);
        if (!value || typeof value !== 'object') return [];
        if (Array.isArray(value.actions)) return decodeControlActions(value.actions, depth + 1);
        if (Array.isArray(value.tool_calls)) return decodeControlActions(value.tool_calls, depth + 1);
        const fn = value.function || value;
        const type = actionNames.has(value.type) ? value.type : fn.name;
        if (!actionNames.has(type)) return [];
        let payload = actionNames.has(value.type) ? value.payload : fn.arguments;
        if (typeof payload === 'string') {
            try { payload = JSON.parse(payload); } catch { return []; }
        }
        if (payload == null) payload = {};
        if (typeof payload !== 'object' || Array.isArray(payload)) return [];
        return [{ type, payload }];
    }

    // Separate control records before any renderer can see them. Only outer, fully
    // received controls may supply actions; decoded reply text is a display-only channel.
    function splitControls(content, { protectJson = false, extractActions = false, depth = 0 } = {}) {
        let text = '';
        const actions = [];
        for (let i = 0; i < content.length;) {
            if (content[i] === '{' || content[i] === '[') {
                const value = valueEnd(content, i);
                if (value.complete) {
                    let record;
                    try { record = JSON.parse(content.slice(i, value.end)); } catch { /* ordinary text or LaTeX */ }
                    const envelope = record && !Array.isArray(record) && ('reply' in record || 'thinking_summary' in record || 'whiteboard' in record);
                    const supplied = envelope ? [] : decodeControlActions(record);
                    if (supplied.length) {
                        if (extractActions) actions.push(...supplied);
                        text += '\n';
                        i = value.end;
                        continue;
                    }
                }
                if (protectJson) {
                    text += content.slice(i, value.end);
                    i = value.end;
                    continue;
                }
            }
            const tag = content[i] === '<' ? controlTagAt(content, i) : null;
            if (!tag) { text += content[i++]; continue; }
            if (tag.pending) break;
            if (tag.closing) { i = tag.end; continue; }
            const close = controlClose(content, tag.end, tag.name);
            if (!close) break; // Quarantine unfinished controls, even at the end of a response.
            if (extractActions && actionTags.has(tag.name)) {
                const body = content.slice(tag.end, close.start).trim();
                try { actions.push(...decodeControlActions(JSON.parse(body))); }
                catch {
                    if (depth < 4) actions.push(...splitControls(body, { extractActions: true, protectJson: true, depth: depth + 1 }).actions);
                }
            }
            text += '\n';
            i = close.end;
        }
        return { text: text.replace(/```(?:json|xml|html)?\s*```/gi, '').trim(), actions: actions.slice(0, 7) };
    }

    function envelopeStarts(text) {
        return Array.from(text.matchAll(/\{\s*"/g), match => match.index);
    }

    function plainPrefix(text) {
        return text.replace(/(?:^|\n)```(?:j(?:s(?:o(?:n)?)?)?)?\s*$/i, '').trim();
    }

    function snapshotFields(content) {
        const starts = envelopeStarts(content);
        if (starts.length) {
            for (const start of [...starts].reverse()) {
                const parsed = scanPublicFields(content.slice(start));
                if (parsed.hasResponseField) return { reply: parsed.reply || plainPrefix(content.slice(0, starts[0])), thinkingSummary: parsed.thinkingSummary };
            }
            return { reply: plainPrefix(content.slice(0, starts[0])), thinkingSummary: [] };
        }
        // Hold a split opening such as `{`, `{"thi` or `{"reply"` before its colon arrives.
        const brace = content.lastIndexOf('{');
        if (brace >= 0) {
            const tail = content.slice(brace);
            const key = tail.match(/^\{\s*"([\w_]*)"?\s*$/)?.[1];
            const opening = /^\{\s*$/.test(tail) || (key !== undefined && ['thinking_summary', 'reply', 'actions', 'whiteboard'].some(name => name.startsWith(key)));
            if (opening) return { reply: plainPrefix(content.slice(0, brace)), thinkingSummary: [] };
        }
        const text = content.trimStart();
        if (/^[{\[]/.test(text) || /^```json/i.test(text)) return { reply: '', thinkingSummary: [] };
        return { reply: plainPrefix(content), thinkingSummary: [] };
    }

    function parseEnvelope(content) {
        if (typeof content !== 'string' || !content.trim()) throw failure('empty_response', { reason: 'empty_content' });
        const text = content.trim();
        const starts = envelopeStarts(text);
        let hasResponseField = false;
        for (const start of starts.reverse()) {
            const parsed = scanPublicFields(text.slice(start));
            hasResponseField ||= parsed.hasResponseField;
            if (!parsed.replyComplete || !parsed.reply.trim()) continue;
            return {
                reply: parsed.reply.trim(),
                thinkingSummary: parsed.thinkingSummary,
                actions: Array.isArray(parsed.fields.actions) ? parsed.fields.actions.slice(0, 6) : [],
                ...(parsed.fields.whiteboard && typeof parsed.fields.whiteboard === 'object' ? { whiteboard: parsed.fields.whiteboard } : {})
            };
        }
        if (hasResponseField || /^[{\[]/.test(text) || /^```json/i.test(text)) {
            throw failure('invalid_response', { reason: starts.length ? 'incomplete_reply' : 'missing_reply' });
        }
        return { reply: text, suggestions: [], actions: [], thinkingSummary: [] };
    }

    function publicSnapshot(content) {
        const outer = splitControls(content, { protectJson: true });
        const snapshot = snapshotFields(outer.text);
        return { reply: splitControls(snapshot.reply).text, thinkingSummary: snapshot.thinkingSummary };
    }

    function parseResponse(content) {
        if (typeof content !== 'string') throw failure('empty_response');
        const outer = splitControls(content, { protectJson: true, extractActions: true });
        const parsed = parseEnvelope(outer.text);
        const reply = splitControls(parsed.reply).text;
        if (!reply) throw failure('empty_response', { reason: 'control_only_response' });
        const seen = new Set();
        const actions = [...(parsed.actions || []), ...outer.actions].filter(action => {
            const key = JSON.stringify(action);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        }).slice(0, 6);
        return { ...parsed, reply, actions };
    }

    function getErrorMessage(error) {
        if (error.code === 'timeout') return '请求超时';
        if (error.code === 'truncated') return '回答被截断';
        if (error.code === 'incomplete_stream') return '连接中断';
        if (error.code === 'invalid_response' || error.code === 'empty_response') return '回答格式异常';
        if (error.status === 401 || error.status === 403) return 'API 认证失败';
        if (error.status === 429) return '请求过于频繁';
        if (error.status >= 500) return '模型服务暂时不可用';
        if (error.code === 'content_filter') return '模型未返回回答';
        return '连接失败';
    }

    async function readCompletion(response, onProgress, onUpdate) {
        if (!response.headers.get('content-type')?.includes('text/event-stream')) {
            let data;
            try { data = await response.json(); } catch { throw failure('invalid_response'); }
            const content = data?.choices?.[0]?.message?.content;
            if (typeof content === 'string') onUpdate?.(publicSnapshot(content));
            return { content, finishReason: data?.choices?.[0]?.finish_reason };
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let content = '';
        let finishReason = null;
        let doneEvent = false;
        let phase;
        let published = '';
        const publish = () => {
            const update = publicSnapshot(content);
            const signature = JSON.stringify(update);
            if (signature !== published) { published = signature; onUpdate?.(update); }
        };
        const consume = block => {
            const data = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n').trim();
            if (!data) return;
            if (data === '[DONE]') { doneEvent = true; return; }
            let event;
            try { event = JSON.parse(data); } catch { throw failure('invalid_response'); }
            if (event.error) throw failure('provider_error');
            const choice = event.choices?.[0];
            const delta = choice?.delta;
            // Discard the raw reasoning immediately. Never store it in a response, log or UI callback.
            const nextPhase = delta?.content ? 'answering' : delta?.reasoning_content && phase !== 'answering' ? 'thinking' : phase;
            if (nextPhase && nextPhase !== phase) { phase = nextPhase; onProgress?.({ phase }); }
            if (typeof delta?.content === 'string') { content += delta.content; publish(); }
            if (choice?.finish_reason) finishReason = choice.finish_reason;
        };
        try {
            while (true) {
                const { value, done } = await reader.read();
                buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
                buffer = buffer.replace(/\r\n/g, '\n');
                let boundary;
                while ((boundary = buffer.indexOf('\n\n')) !== -1) {
                    consume(buffer.slice(0, boundary));
                    buffer = buffer.slice(boundary + 2);
                }
                if (done) { if (buffer.trim()) consume(buffer); break; }
            }
        } catch (error) {
            await reader.cancel().catch(() => {});
            throw error;
        } finally { reader.releaseLock(); }
        if (!finishReason) throw failure('incomplete_stream', { receivedDone: doneEvent });
        return { content, finishReason };
    }

    async function request({ config, question, messages, signal, onProgress, onUpdate, fetchImpl = globalThis.fetch }) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        const options = getRequestOptions(question);
        let useJsonMode = true;
        const controller = new AbortController();
        let timedOut = false;
        const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, config.timeoutMs || 120000);
        const cancel = () => controller.abort();
        signal?.addEventListener('abort', cancel, { once: true });
        const started = Date.now();
        try {
            for (let attempt = 0; attempt < 2; attempt++) {
                try {
                    if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
                    onProgress?.({ phase: 'connecting', attempt: attempt + 1 });
                    const response = await fetchImpl(config.endpoint, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
                        body: JSON.stringify({ model: config.model, messages, stream: true, ...(useJsonMode ? { response_format: { type: 'json_object' } } : {}), ...options }),
                        signal: controller.signal
                    });
                    if (!response.ok) throw failure('http_error', { status: response.status });
                    const result = await readCompletion(response, onProgress, onUpdate);
                    if (result.finishReason === 'length') throw failure('truncated');
                    if (result.finishReason === 'content_filter') throw failure('content_filter');
                    const parsed = parseResponse(result.content);
                    return { ...parsed, elapsedMs: Date.now() - started, attempts: attempt + 1 };
                } catch (error) {
                    const canRetry = ['truncated', 'empty_response', 'invalid_response', 'incomplete_stream'].includes(error.code);
                    if (attempt > 0 || !canRetry || controller.signal.aborted) throw error;
                    if (['empty_response', 'invalid_response'].includes(error.code)) useJsonMode = false;
                    if (error.code === 'truncated') options.max_tokens = Math.min(65536, options.max_tokens * 2);
                }
            }
        } catch (error) {
            if (timedOut) throw failure('timeout');
            if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
            throw error;
        } finally {
            clearTimeout(timeout);
            signal?.removeEventListener('abort', cancel);
        }
    }

    return { getRequestOptions, getPhysicsFacts, sanitizeSummary, parseResponse, getErrorMessage, request };
});
