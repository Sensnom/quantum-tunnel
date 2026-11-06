(function(root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.QuantumAnnotations = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
    'use strict';

    const clamp = (value, min, max) => Math.max(min, Math.min(Math.max(min, max), value));

    function getTargetAnchor(rect, range) {
        if (!range) return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        const span = Number(range.max) - Number(range.min);
        let ratio = span > 0 ? clamp((Number(range.value) - Number(range.min)) / span, 0, 1) : 0.5;
        if (range.direction === 'rtl') ratio = 1 - ratio;
        const radius = Math.min(rect.width, Number(range.thumbSize) || 16) / 2;
        return { x: rect.left + radius + ratio * (rect.width - radius * 2), y: rect.top + rect.height / 2 };
    }

    function overlapArea(a, b) {
        return Math.max(0, Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left)) *
            Math.max(0, Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top));
    }

    // Both HTML and SVG use layer-local CSS pixels and the card's measured size.
    function layoutAnnotation({ target, anchor, label, viewport, avoid = [] }) {
        const { width, height } = label;
        const gutter = 16;
        const originX = viewport.left || 0;
        const originY = viewport.top || 0;
        const gap = 28;
        const candidates = [
            { left: target.left - width - gap, top: anchor.y - height / 2 },
            { left: target.left + target.width + gap, top: anchor.y - height / 2 },
            { left: anchor.x - width / 2, top: target.top - height - gap },
            { left: anchor.x - width / 2, top: target.top + target.height + gap }
        ].map((candidate, index) => {
            const box = { left: clamp(candidate.left, originX + gutter, originX + viewport.width - width - gutter), top: clamp(candidate.top, originY + gutter, originY + viewport.height - height - gutter), width, height };
            const obstruction = overlapArea(box, target) + avoid.reduce((area, obstacle) => area + overlapArea(box, obstacle), 0);
            const displacement = Math.hypot(box.left - candidate.left, box.top - candidate.top);
            return { ...box, score: obstruction * 1000 + displacement + index * 0.1 };
        });
        candidates.sort((a, b) => a.score - b.score);
        const { left, top } = candidates[0];
        const center = { x: left + width / 2, y: top + height / 2 };
        // Approach the padded target border, never the content or slider handle itself.
        const towardLabel = { x: center.x - anchor.x, y: center.y - anchor.y };
        if (!towardLabel.x && !towardLabel.y) towardLabel.y = -1;
        const pad = 10;
        const tx = towardLabel.x > 0 ? (target.left + target.width + pad - anchor.x) / towardLabel.x
            : towardLabel.x < 0 ? (target.left - pad - anchor.x) / towardLabel.x : Infinity;
        const ty = towardLabel.y > 0 ? (target.top + target.height + pad - anchor.y) / towardLabel.y
            : towardLabel.y < 0 ? (target.top - pad - anchor.y) / towardLabel.y : Infinity;
        const distance = Math.min(tx, ty);
        const end = { x: anchor.x + towardLabel.x * distance, y: anchor.y + towardLabel.y * distance };
        const dx = end.x - center.x;
        const dy = end.y - center.y;
        const scale = 1 / Math.max(Math.abs(dx) / (width / 2), Math.abs(dy) / (height / 2), 0.001);
        const start = { x: center.x + dx * scale, y: center.y + dy * scale };
        const horizontal = Math.abs(start.x - center.x) >= width / 2 - 0.01;
        const bend = Math.min(50, Math.hypot(end.x - start.x, end.y - start.y) * 0.35);
        const sign = horizontal ? Math.sign(dx) : Math.sign(dy);
        const c1 = horizontal ? { x: start.x + sign * bend, y: start.y } : { x: start.x, y: start.y + sign * bend };
        const c2 = horizontal ? { x: end.x - sign * bend, y: end.y } : { x: end.x, y: end.y - sign * bend };
        const overlaps = overlapArea({ left, top, width, height }, target) > 0;
        const path = overlaps ? '' : `M ${start.x} ${start.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${end.x} ${end.y}`;
        return { left, top, start, end, path };
    }

    function hasCompletedInteraction(initial, current, direction = 'any') {
        if (!Number.isFinite(initial) || !Number.isFinite(current)) return false;
        const delta = current - initial;
        if (Math.abs(delta) < 1e-8) return false;
        return direction === 'increase' ? delta > 0 : direction === 'decrease' ? delta < 0 : true;
    }

    function createController({ layer, svg, label, spotlight, getSnapshot, onDismiss, onFollowup, onPractice }) {
        let session = null;
        let frame = null;
        let timer = null;
        const doc = layer.ownerDocument;
        const win = doc.defaultView;
        const svgNS = 'http://www.w3.org/2000/svg';
        const make = (tag, className, text) => {
            const node = doc.createElement(tag);
            node.className = className;
            if (text !== undefined) node.textContent = text;
            return node;
        };
        const vector = (tag, attributes, parent = svg) => {
            const node = doc.createElementNS(svgNS, tag);
            Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, value));
            parent.append(node);
            return node;
        };
        const formatT = value => Number.isFinite(value) ? value.toExponential(3) : '—';
        const isRange = element => element.matches('input[type="range"]');
        const visible = rect => rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < win.innerHeight && rect.right > 0 && rect.left < win.innerWidth;

        function clear(reason = 'dismissed') {
            if (frame !== null) win.cancelAnimationFrame(frame);
            frame = null;
            if (timer !== null) win.clearTimeout(timer);
            timer = null;
            const previous = session;
            const hadFocus = label.contains(doc.activeElement);
            session = null;
            observer?.disconnect();
            layer.classList.remove('active');
            layer.setAttribute('aria-hidden', 'true');
            layer.inert = true;
            spotlight.classList.remove('active');
            svg.replaceChildren();
            if (!previous) return;
            previous.element.removeEventListener('input', handleInput);
            previous.element.removeEventListener('change', handleChange);
            if (previous.description === null) previous.element.removeAttribute('aria-describedby');
            else previous.element.setAttribute('aria-describedby', previous.description);
            if (hadFocus && reason !== 'replaced') {
                const fallback = doc.getElementById('aiTutorLauncher');
                (visible(previous.element.getBoundingClientRect()) ? previous.element : fallback)?.focus({ preventScroll: true });
            }
            previous.resolve({ completed: previous.completed, reason });
            label.replaceChildren();
            onDismiss?.(reason);
        }

        function scheduleRedraw() {
            if (!session || frame !== null) return;
            frame = win.requestAnimationFrame(() => { frame = null; redraw(); });
        }

        function redraw() {
            if (!session) return;
            const rect = session.element.getBoundingClientRect();
            if (!session.element.isConnected || !visible(rect)) { clear('hidden'); return; }
            const origin = layer.getBoundingClientRect();
            const vv = win.visualViewport;
            const viewport = {
                left: (vv?.offsetLeft || 0) - origin.left,
                top: (vv?.offsetTop || 0) - origin.top,
                width: Math.min(origin.width, vv?.width || win.innerWidth),
                height: Math.min(origin.height, vv?.height || win.innerHeight)
            };
            label.style.maxWidth = `${Math.max(1, Math.min(300, viewport.width - 32))}px`;
            label.style.maxHeight = `${Math.max(1, viewport.height - 32)}px`;
            const target = { left: rect.left - origin.left, top: rect.top - origin.top, width: rect.width, height: rect.height };
            let range;
            if (isRange(session.element)) {
                const style = win.getComputedStyle(session.element);
                range = { min: session.element.min || 0, max: session.element.max || 100, value: session.element.value, thumbSize: parseFloat(style.getPropertyValue('--range-thumb-size')) || 16, direction: style.direction };
            }
            const anchor = getTargetAnchor(target, range);
            const avoid = Array.from(doc.querySelectorAll('.ai-tutor.open .ai-tutor-panel, .ai-whiteboard-backdrop.active .ai-whiteboard-panel, .theory-pip-window.active'))
                .filter(node => visible(node.getBoundingClientRect()) && win.getComputedStyle(node).opacity !== '0')
                .map(node => { const box = node.getBoundingClientRect(); return { left: box.left - origin.left, top: box.top - origin.top, width: box.width, height: box.height }; });
            const card = label.getBoundingClientRect();
            const layout = layoutAnnotation({ target, anchor, label: card, viewport, avoid });
            label.style.left = `${layout.left}px`;
            label.style.top = `${layout.top}px`;
            svg.setAttribute('viewBox', `0 0 ${origin.width} ${origin.height}`);
            session.arrow.setAttribute('d', layout.path);
            session.arrow.style.display = layout.path ? '' : 'none';
            const pad = 8;
            const x = Math.max(viewport.left + 2, target.left - pad);
            const y = Math.max(viewport.top + 2, target.top - pad);
            const width = Math.max(0, Math.min(viewport.left + viewport.width - 2, target.left + target.width + pad) - x);
            const height = Math.max(0, Math.min(viewport.top + viewport.height - 2, target.top + target.height + pad) - y);
            [session.ring, session.pulse].filter(Boolean).forEach(node => {
                Object.entries({ x, y, width, height }).forEach(([key, value]) => node.setAttribute(key, value));
            });
            if (session.payload.shape === 'spotlight') {
                Object.assign(spotlight.style, { left: `${x}px`, top: `${y}px`, width: `${width}px`, height: `${height}px` });
            }
        }

        function updateFeedback() {
            if (!session?.interactive) return;
            const snapshot = getSnapshot();
            const current = Number(session.element.value);
            const parameter = `${session.meta.name}：${session.initial.toFixed(2)} → ${current.toFixed(2)} ${session.meta.unit}`;
            session.feedback.textContent = `${parameter}\n理论 T：${formatT(session.snapshot.T)} → ${formatT(snapshot.T)}`;
            scheduleRedraw();
        }

        function handleInput(event) {
            if (!session) return;
            scheduleRedraw();
            if (!session.interactive) return;
            updateFeedback();
            // Synthetic parameter animations must not complete a learner's task.
            if (!event.isTrusted || session.completed) return;
            const current = Number(session.element.value);
            if (hasCompletedInteraction(session.initial, current, session.direction)) {
                session.completed = true;
                label.dataset.state = 'complete';
                session.kind.textContent = '已完成';
                session.kind.hidden = false;
                session.status.textContent = '已观察到参数变化。继续拖动可比较结果，或追问变化原因。';
                session.explain.hidden = false;
            } else if (current !== session.initial) {
                session.status.textContent = `当前方向相反，请${session.direction === 'increase' ? '调高' : '调低'}${session.meta.name}。`;
            } else session.status.textContent = session.instruction;
        }

        function handleChange() {
            if (session?.completed) session.resolve({ completed: true, reason: 'completed' });
        }

        function show(element, payload, meta = {}) {
            clear('replaced');
            const interactive = payload.shape === 'interact' && isRange(element);
            const shape = payload.shape === 'interact' && !interactive ? 'pulse' : payload.shape;
            const normalized = { ...payload, shape };
            let resolve;
            const finished = new Promise(done => { resolve = done; });
            const kind = make('span', 'ai-annotation-kind', interactive ? '动手试试' : shape === 'pulse' ? '聚焦观察' : '观察提示');
            kind.hidden = true;
            const close = make('button', 'ai-annotation-close', '×');
            close.type = 'button';
            close.setAttribute('aria-label', '关闭页面批注');
            close.addEventListener('click', () => clear());
            const header = make('div', 'ai-annotation-header');
            const text = make('p', 'ai-annotation-text', payload.label || meta.name || '观察标记区域');
            header.append(text, close);
            label.className = 'ai-annotation-label';
            label.dataset.shape = shape || 'ring';
            label.dataset.state = interactive ? 'waiting' : 'observing';
            label.replaceChildren(header, kind);
            const defs = vector('defs', {});
            const marker = vector('marker', { id: 'aiArrowHead', markerWidth: 10, markerHeight: 10, refX: 8, refY: 5, orient: 'auto', markerUnits: 'userSpaceOnUse' }, defs);
            vector('path', { d: 'M2,1 L8,5 L2,9', fill: 'none', stroke: 'context-stroke', 'stroke-width': 1.75, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, marker);
            const ring = vector('rect', { class: `ai-annotation-ring${shape === 'spotlight' ? ' spotlight-ring' : ''}`, rx: 10 });
            const pulse = ['pulse', 'interact'].includes(shape) ? vector('rect', { class: 'ai-annotation-pulse', rx: 10 }) : null;
            const arrow = vector('path', { class: 'ai-annotation-arrow', 'marker-end': 'url(#aiArrowHead)' });
            session = { element, payload: normalized, meta, interactive, snapshot: getSnapshot(), initial: Number(element.value), description: element.getAttribute('aria-describedby'), completed: false, resolve, finished, kind, ring, pulse, arrow };
            if (interactive) {
                const requestedDirection = ['increase', 'decrease'].includes(payload.direction) ? payload.direction : 'any';
                // At a range limit there is no room to move further in that direction.
                session.direction = (requestedDirection === 'increase' && session.initial >= Number(element.max)) || (requestedDirection === 'decrease' && session.initial <= Number(element.min)) ? 'any' : requestedDirection;
                const verb = session.direction === 'increase' ? '调高' : session.direction === 'decrease' ? '调低' : '调整';
                session.instruction = `${verb}${meta.name}，对比理论 T 的变化。支持拖动，或聚焦后按方向键。`;
                const status = make('p', 'ai-annotation-instruction', session.instruction);
                status.id = 'aiAnnotationInstruction';
                status.setAttribute('role', 'status');
                const feedback = make('p', 'ai-annotation-feedback');
                feedback.setAttribute('aria-live', 'off');
                const focus = make('button', 'ai-annotation-focus', '操作滑块');
                focus.type = 'button';
                focus.addEventListener('click', () => element.focus({ preventScroll: true }));
                const explain = make('button', 'ai-annotation-explain', '解释这次变化');
                explain.type = 'button';
                explain.hidden = true;
                explain.addEventListener('click', () => {
                    const summary = feedback.textContent;
                    clear('followup');
                    onFollowup?.(`我刚调整了${meta.name}。${summary}。请结合当前参数解释这次变化。`);
                });
                const controls = make('div', 'ai-annotation-controls');
                controls.append(focus, explain);
                Object.assign(session, { status, feedback, explain });
                label.append(status, feedback, controls);
                element.setAttribute('aria-describedby', [session.description, status.id].filter(Boolean).join(' '));
                updateFeedback();
            }
            if (!interactive && isRange(element) && onPractice) {
                const controls = make('div', 'ai-annotation-controls');
                const practice = make('button', 'ai-annotation-try', '我来试试');
                practice.type = 'button';
                practice.addEventListener('click', () => onPractice({ ...normalized, shape: 'interact' }));
                controls.append(practice);
                label.append(controls);
            }
            element.addEventListener('input', handleInput);
            element.addEventListener('change', handleChange);
            layer.inert = false;
            layer.setAttribute('aria-hidden', 'false');
            layer.classList.add('active');
            spotlight.classList.toggle('active', shape === 'spotlight');
            if (observer) { observer.observe(element); observer.observe(label); }
            redraw();
            if (!interactive) timer = win.setTimeout(() => clear('expired'), clamp(Number(payload.duration) || 9000, 1500, 60000));
            return { finished, interactive };
        }

        const observer = win.ResizeObserver ? new win.ResizeObserver(scheduleRedraw) : null;
        win.addEventListener('scroll', scheduleRedraw, { passive: true, capture: true });
        win.addEventListener('resize', scheduleRedraw, { passive: true });
        win.visualViewport?.addEventListener('resize', scheduleRedraw, { passive: true });
        win.visualViewport?.addEventListener('scroll', scheduleRedraw, { passive: true });
        layer.inert = true;
        return { show, clear, redraw, scheduleRedraw };
    }

    return { getTargetAnchor, layoutAnnotation, hasCompletedInteraction, createController };
});
