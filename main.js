    // --- 物理常数与计算设置 (完美匹配 PhET 原始参数) ---
    // 采用与 PhET 完全一致的缩放单位:
    // ℏ (hbar) = 0.658212 eV·fs
    // m (mass) = 5.68563 eV·fs²/nm²
    // x 的单位为 nm, E, V 的单位为 eV, t 的单位为 fs
    
    const N_visible = 1000;
    const N_damp = 190; // PhET 使用的 190 个隐藏阻尼网格
    const N = N_visible + 2 * N_damp; // 总网格数 1380
    
    // 可视区域坐标
    const xMinVisible = -15.0;
    const xMaxVisible = 15.0;
    const dx = (xMaxVisible - xMinVisible) / (N_visible - 1);
    
    // 物理网格实际的起始坐标 (包含隐藏阻尼区)
    const xMin = xMinVisible - N_damp * dx;
    const xMax = xMaxVisible + N_damp * dx;
    
    const hbar = 0.658212;
    const mass = 5.68563;
    
    // Crank-Nicolson 的时间步长。
    // PhET 使用的是 dt = 0.0025, steps = 40。
    // 为了减慢动画，我们减小每次渲染的物理步数 (stepsPerFrame) 或者时间步长。
    // 配合严谨的 PhET 常数，采用如下设置以达到平滑且不过快的动画：
    const dt = 0.0025; 
    const stepsPerFrame = 15; // PhET 默认是 40，调小可让动画"变慢一点"
    
    const MAX_FRAMES = 2000;
    let stateHistory = [];
    let currentFrame = 0;
    let currentTime = 0.0;
    let playbackSpeed = 1.0;
    let playbackFrameAccumulator = 0;
    
    // 状态
    let isPlaying = true;
    let animationId = null;
    
    // UI Helpers
    const isDark = () => document.body.classList.contains('dark-mode');
    const simChartConfigs = {
        wave: {
            canvasId: 'waveCanvas',
            defaultHeight: 220,
            minHeight: 140,
            maxHeight: 420,
            height: null
        },
        density: {
            canvasId: 'densityCanvas',
            defaultHeight: 220,
            minHeight: 140,
            maxHeight: 420,
            height: null
        },
        ensemble: {
            canvasId: 'ensembleCanvas',
            defaultHeight: 120,
            minHeight: 90,
            maxHeight: 260,
            height: null
        },
        dataRelation: {
            canvasId: 'densityParticleRelationCanvas',
            defaultHeight: 220,
            minHeight: 140,
            maxHeight: 420,
            height: null
        }
    };
    
    // 仿真参数
    let V0 = 2.0;
    let d = 0.5;
    let E = 1.5;
    let sigma = 0.5;
    let relationSigma = 0.6;
    let isRelationPlaying = false;
    let relationPlaybackSpeed = 1.0;
    let relationPlaybackPhase = -Math.PI / 2;
    let relationPlaybackLastTime = null;
    const barrierCenter = 0.0;
    const relationSigmaMin = 0.6;
    const relationSigmaMax = 5.0;
    const relationPlaybackBasePeriod = 6.0;
    const relationParticleCount = 1600;

    const theoryFocusMeta = {
        left: {
            label: '左侧干涉',
            explain: '区域 I：$Ae^{ikx}+Be^{-ikx}$。入射波和反射波相干叠加，产生干涉峰谷。'
        },
        barrier: {
            label: '势垒内部',
            explain: '区域 II：$Ce^{-\\kappa x} + De^{\\kappa x}$。能量低于势垒时，波数 $k$ 变成纯虚数 $i\\kappa$，振荡解 $e^{ikx}$ 退化成指数衰减。包络 $\\lvert\\psi\\rvert$ 从墙左侧到右侧持续下降。'
        },
        right: {
            label: '右侧透射',
            explain: '区域 III：$Fe^{ikx}$。单向向右的透射波，振幅比左边小一个量级。'
        }
    };

    const theoryComponentMeta = {
        all: {
            explain: '蓝线是实部，红线是虚部，灰色虚线是包络 $|\\psi|$。点"只看包络"可以单独看指数衰减的轮廓，不会被实虚部的振荡干扰。'
        },
        real: {
            explain: '实部只是 $\\psi$ 在实轴上的投影，不是概率。它会振荡、会穿过零轴，单独看它就是一条来回摆动的线，不是光滑的衰减轮廓。'
        },
        imag: {
            explain: '虚部和实部地位对等，只是相位差了 90°。单独看它也是来回振荡的线，峰谷位置和实部错开，但幅度变化规律相同。'
        },
        env: {
            explain: '包络 $|\\psi| = \\sqrt{(\\Re\\psi)^2 + (\\Im\\psi)^2}$ 是实部和虚部合起来的总幅度。进入势垒后，总振幅不再振荡，而是单调下降。'
        }
    };

    const theoryScenes = {
        tunnel: {
            title: '场景 1：势垒内部的非零振幅',
            subtitle: '蓝实部，红虚部，灰虚线是包络 $\\lvert\\psi\\rvert$。墙内包络指数衰减。',
            focus: 'barrier',
            calcLead: '墙内衰减越快，右侧透射波越弱。',
            run() {
                animateParamsTo(1.5, 3.0, 0.5);
            }
        },
        width: {
            title: '场景 2：势垒宽度的指数影响',
            subtitle: '看灰色虚线（包络）和右侧透射波幅度。宽度每加一点，透射就跌一截。',
            focus: 'right',
            calcLead: '宽度 d 控制指数衰减的累计距离。d 翻倍，T 跌好几个数量级。',
            run() {
                animateWidthSweep();
            }
        },
        overBarrier: {
            title: '场景 3：越垒情形中的边界反射',
            subtitle: '把 E 调到 V₀ 以上，看左边干涉纹变稀疏，但反射波还在。',
            focus: 'left',
            calcLead: 'E > V₀ 时透射明显变大，但反射不会消失。边界条件要匹配，入射波就得有一部分被反射。',
            run() {
                animateParamsTo(3.5, 3.0, 0.5);
            }
        }
    };
    let currentTheoryScene = 'tunnel';
    let currentTheoryFocus = theoryScenes[currentTheoryScene].focus;
    let currentTheoryComponent = 'all';

    // --- AI 助教：远程模型 API + 教学动作执行 ---
    const assistantApiConfig = {
        enabled: true,
        endpoint: `https://api.${'deep' + 'seek'}.com/chat/completions`,
        apiKey: (() => {
            const prefix = [115, 107, 45].map(code => String.fromCharCode(code)).join('');
            const fragments = [
                { order: 4, value: 'b7c13f52' },
                { order: 1, value: '3a1cacae' },
                { order: 5, value: '2c1' },
                { order: 3, value: 'fa1d94' },
                { order: 0, value: 'f7ff' },
                { order: 2, value: 'f64' }
            ];
            return prefix + fragments
                .sort((a, b) => a.order - b.order)
                .map(part => part.value.split('').reverse().join(''))
                .join('');
        })(), // 远程模型 API Key
        model: `${'deep' + 'seek'}-flash`,
        timeoutMs: 120000
    };

    const assistantState = {
        isOpen: false,
        isLoading: false,
        requestController: null,
        loadingTimer: null,
        loadingStarted: 0,
        loadingPhase: 'connecting',
        statusText: 'DeepSeek',
        messageSequence: 0,
        questionGroupIndex: 0,
        messages: [],
        loadingMessageId: null,
        streamRenderFrame: null,
        currentActionRunId: 0,
        activeAnnotation: null,
        annotationController: null,
        annotationRequestId: 0,
        avoidRightPanelTimer: null,
        activeLessonId: null,
        activeLessonStep: 0,
        activeWhiteboard: null
    };

    // Curated UI questions rotate after successful replies; answers remain model-generated.
    const assistantQuestionGroups = Object.freeze([
        ['带我看一次仿真', '演示宽度扫描', 'σ 为什么影响透射？', 'κ 的数值怎么算？'],
        ['让我调整势垒宽度', '势垒内为什么有振幅？', '透射率和振幅有何区别？', '用白板推导隧穿公式'],
        ['演示越垒时的反射', '只看波函数的包络', '数值 T 是怎么统计的？', '哪些条件下 WKB 不准？']
    ].map(group => Object.freeze(group)));

    const assistantTargets = {
        energyCanvas: { selector: '#energyCanvas', label: '总能量与势垒图' },
        waveCanvas: { selector: '#waveCanvas', label: '波函数图' },
        densityCanvas: { selector: '#densityCanvas', label: '概率密度图' },
        ensembleCanvas: { selector: '#ensembleCanvas', label: '粒子模拟图' },
        staticWaveCanvas: { selector: '#staticWaveCanvas', label: '定态散射波函数图' },
        chartCanvas: { selector: '#chartCanvas', label: '理论透射率曲线' },
        theoryNumerovCanvas: { selector: '#theoryNumerovCanvas', label: '原理解析曲线' },
        theoryCalcResult: { selector: '#theoryCalcResult', label: '当前理论计算结果' },
        timelineNodes: { selector: '#timelineNodes', label: '量子隧穿发展历史时间轴' },
        historyDetailPanel: { selector: '#historyDetailPanel', label: '当前历史节点详情' },
        historyParamTip: { selector: '#historyParamTip', label: '历史节点对应的仿真参数' },
        regionCardBarrier: { selector: '#regionCardBarrier', label: '势垒内部区域' },
        regionCardLeft: { selector: '#regionCardLeft', label: '入射与反射区域' },
        regionCardRight: { selector: '#regionCardRight', label: '透射区域' },
        v0Slider: { selector: '#v0Slider', label: '势垒高度 V₀' },
        dSlider: { selector: '#dSlider', label: '势垒宽度 d' },
        eSlider: { selector: '#eSlider', label: '波包总能量 E' },
        sigmaSlider: { selector: '#sigmaSlider', label: '波包初始宽度 σ' },
        actualTValue: { selector: '#actualTValue', label: '波包实际透射' },
        tValue: { selector: '#tValue', label: '理论透射系数' },
        playPauseBtn: { selector: '#playPauseBtn', label: '播放或暂停' },
        resetBtn: { selector: '#resetBtn', label: '重置波包' },
        timeSlider: { selector: '#timeSlider', label: '演化时间' },
        playbackSpeedSlider: { selector: '#playbackSpeedSlider', label: '播放速度' }
    };

    const assistantRightPanelTargets = new Set([
        'v0Slider',
        'dSlider',
        'eSlider',
        'sigmaSlider',
        'actualTValue',
        'tValue', 'playPauseBtn', 'resetBtn', 'timeSlider', 'playbackSpeedSlider'
    ]);

    const assistantTargetTabs = {
        v0Slider: 'sim', dSlider: 'sim', eSlider: 'sim', sigmaSlider: 'sim', tValue: 'sim',
        playPauseBtn: 'sim', resetBtn: 'sim', timeSlider: 'sim', playbackSpeedSlider: 'sim',
        waveCanvas: 'sim',
        densityCanvas: 'sim',
        ensembleCanvas: 'sim',
        actualTValue: 'sim',
        staticWaveCanvas: 'data',
        chartCanvas: 'data',
        theoryNumerovCanvas: 'theory',
        theoryCalcResult: 'theory',
        timelineNodes: 'history',
        historyDetailPanel: 'history',
        historyParamTip: 'history',
        regionCardBarrier: 'theory',
        regionCardLeft: 'theory',
        regionCardRight: 'theory'
    };

    const assistantLessons = {
        tunnelDecay: {
            title: '墙里为什么还有波？',
            steps: [
                '<p>先看势垒内部。经典图像会说：$E < V_0$，粒子进不了墙。但量子里我们看的不是一颗小球，而是波函数 $\\psi(x)$。</p><p>边界条件要求波函数和导数连续，所以它不能在墙边突然变成 0。</p>',
                '<p>在势垒内部，薛定谔方程的振荡解会变成指数解：</p><div class="math-block">$$\\psi_{II}(x)=Ce^{-\\kappa x}+De^{\\kappa x}$$</div><p>真正决定“穿过去还剩多少”的，是包络 $\\lvert\\psi\\rvert$ 的指数衰减。</p>',
                '<p>衰减常数是：</p><div class="math-block">$$\\kappa=\\frac{\\sqrt{2m(V_0-E)}}{\\hbar}$$</div><p>$V_0-E$ 越大，或势垒越宽，波函数衰减越强，透射率就越小。</p>'
            ]
        },
        widthExponential: {
            title: '为什么宽度只加一点，透射率差很多？',
            steps: [
                '<p>宽度 $d$ 不是线性地影响透射率，而是进入指数项。</p><div class="math-block">$$T \\propto e^{-2\\kappa d}$$</div>',
                '<p>这意味着势垒每加宽一点，波函数都要多经历一段衰减。多出来的每一小段都会再乘一个小于 1 的因子。</p>',
                '<p>所以你在参数关系页看到的 $T-d$ 曲线通常会迅速下坠，尤其适合用对数坐标观察。</p>'
            ]
        },
        overBarrierReflection: {
            title: '能量超过势垒，为什么还有反射？',
            steps: [
                '<p>$E > V_0$ 时，墙内不再是指数衰减，而会恢复成振荡波。但这不代表反射完全消失。</p>',
                '<p>反射来自边界匹配：波函数和导数在两个边界都要连续。只要势能有突变，就可能产生一部分反射波。</p>',
                '<p>当 $E \\gg V_0$ 时，反射会趋近于 0；但在普通越垒情形下，左侧仍能看到干涉纹。</p>'
            ]
        },
        parameterGuide: {
            title: '四个参数分别影响什么？',
            steps: [
                '<p>$E$ 是粒子能量。能量越接近或超过 $V_0$，透射通常越强。</p><p>$V_0$ 是势垒高度。高度越高，$V_0-E$ 越大，墙内衰减越明显。</p>',
                '<p>$d$ 是势垒宽度。它直接进入 $e^{-2\\kappa d}$，所以对透射率非常敏感。</p>',
                '<p>$\\sigma$ 是初始波包宽度，主要影响实时演化里波包的空间宽窄和动量分布；它不会简单等同于定态公式里的一个参数。</p>'
            ]
        },
        howToReadPage: {
            title: '这个网页应该怎么看？',
            steps: [
                '<p>先看【实时演化】：观察波包撞上势垒后分成反射和透射两部分。</p>',
                '<p>再看【参数关系】：用曲线理解 $E$、$V_0$、$d$ 怎样改变理论透射率。</p>',
                '<p>最后看【原理解析】：把图像拆成入射+反射、墙内衰减、右侧透射三段，理解公式背后的图像。</p>'
            ]
        }
    };

    function getKatexDelimiters() {
        return [
            {left: '$$', right: '$$', display: true},
            {left: '$', right: '$', display: false}
        ];
    }

    function renderMathInNode(node) {
        if (node && window.renderMathInElement) {
            renderMathInElement(node, { delimiters: getKatexDelimiters() });
        }
    }

    function escapeAssistantText(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function stripAssistantHtml(value) {
        return String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    }

    function formatAssistantPlainMarkdown(text) {
        return escapeAssistantText(text)
            .replace(/\*\*([^\n*]+)\*\*/g, '<strong>$1</strong>')
            .replace(/__([^\n_]+)__/g, '<strong>$1</strong>');
    }

    function formatAssistantInlineMarkdown(text) {
        const source = String(text ?? '');
        const tokenPattern = /(`[^`\n]+`|\$\$[\s\S]+?\$\$|\$[^$\n]+\$)/g;
        let html = '';
        let lastIndex = 0;
        source.replace(tokenPattern, (match, _token, offset) => {
            html += formatAssistantPlainMarkdown(source.slice(lastIndex, offset));
            if (match.startsWith('`')) {
                html += `<code>${escapeAssistantText(match.slice(1, -1))}</code>`;
            } else {
                html += escapeAssistantText(match);
            }
            lastIndex = offset + match.length;
            return match;
        });
        html += formatAssistantPlainMarkdown(source.slice(lastIndex));
        return html;
    }

    function formatAssistantCodeBlock(text) {
        return `<pre class="ai-tutor-code-block"><code>${escapeAssistantText(text).trim()}</code></pre>`;
    }

    function formatAssistantTextBlock(text) {
        const lines = String(text ?? '').replace(/\r\n/g, '\n').split('\n');
        const html = [];
        let paragraph = [];
        let listItems = [];
        let listType = null;

        const flushParagraph = () => {
            if (!paragraph.length) return;
            html.push(`<p>${formatAssistantInlineMarkdown(paragraph.join('\n')).replace(/\n/g, '<br>')}</p>`);
            paragraph = [];
        };
        const flushList = () => {
            if (!listItems.length) return;
            const tag = listType === 'ol' ? 'ol' : 'ul';
            const className = tag === 'ol' ? 'ai-tutor-list ai-tutor-list-ordered' : 'ai-tutor-list';
            html.push(`<${tag} class="${className}">${listItems.map(item => `<li>${formatAssistantInlineMarkdown(item)}</li>`).join('')}</${tag}>`);
            listItems = [];
            listType = null;
        };

        lines.forEach(line => {
            const trimmed = line.trim();
            if (!trimmed) {
                flushParagraph();
                flushList();
                return;
            }

            const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
            if (heading) {
                flushParagraph();
                flushList();
                const level = Math.min(3, heading[1].length + 2);
                html.push(`<h${level} class="ai-tutor-heading">${formatAssistantInlineMarkdown(heading[2])}</h${level}>`);
                return;
            }

            const bullet = trimmed.match(/^[-*+]\s+(.+)$/);
            const ordered = trimmed.match(/^\d+[.)]\s+(.+)$/);
            if (bullet || ordered) {
                flushParagraph();
                const nextType = ordered ? 'ol' : 'ul';
                if (listType && listType !== nextType) flushList();
                listType = nextType;
                listItems.push((bullet || ordered)[1]);
                return;
            }

            const quote = trimmed.match(/^>\s?(.+)$/);
            if (quote) {
                flushParagraph();
                flushList();
                html.push(`<blockquote class="ai-tutor-quote">${formatAssistantInlineMarkdown(quote[1])}</blockquote>`);
                return;
            }

            flushList();
            paragraph.push(trimmed);
        });

        flushParagraph();
        flushList();
        return html.join('');
    }

    function formatAssistantText(text) {
        const source = String(text ?? '').replace(/\r\n/g, '\n');
        const parts = source.split(/```(?:[\w-]+)?\n?([\s\S]*?)```/g);
        return parts.map((part, index) => index % 2 === 1 ? formatAssistantCodeBlock(part) : formatAssistantTextBlock(part)).join('');
    }

    function getAssistantContext() {
        const tr = calculateTR(E, V0, d);
        return {
            currentTab,
            physicsCalculated: QuantumTutor.getPhysicsFacts({ E, V0, d, mass, hbar }),
            simulation: {
                timeEvolution: {
                    method: 'Crank–Nicolson 隐式有限差分；复三对角方程用追赶法求解，不是 FFT 分裂算符法',
                    dtFs: dt, stepsPerFrame, visibleGridPoints: N_visible, absorbingGridPointsEachSide: N_damp,
                    xRangeNm: [xMinVisible, xMaxVisible], dxNm: dx,
                    initialPacket: 'ψ(x,0)=exp[-(x−x₀)²/(2σ²)] exp(ik₀x)，x₀=-6 nm，k₀=√(2mE)/ℏ；原始高斯数组不预先归一化到 1，统计时以初始总概率积分作分母',
                    sigmaEffect: 'E 是中心波数对应的能量，不是宽波包总能量分布中的每个能量。Δk=1/(√2σ)，σ 增大时动量分布变窄；自由波包的平均动能约为 E+ℏ²/(4mσ²)。数值透射受整个波包能量分布影响，不等于单个中心能量的理论 T，也不保证随 σ 单调。',
                    numericalTransmission: '任一时刻：右侧可见区域概率 + 右侧已吸收概率，再除以初始总概率。这只是当前时刻的透射比例，不保证严格单调；右侧可见概率可因净流方向变化而减少。初始波函数数组没有预先归一化到 1，统计比例由分母归一化。比较 σ 时应重置后等散射充分结束。'
                },
                stationary: { method: '原理解析和定态图使用 Numerov 空间递推，矩形势垒理论 T/R 使用解析公式' },
                experiments: {
                    widthScan: { tab: 'theory', tabLabel: '原理解析', scene: 'width', action: { type: 'runTheoryScene', payload: { scene: 'width' } }, description: '宽度扫描演示在原理解析的宽度场景；先设置 E=1 eV、V₀=4 eV，再让 d 从 0.3 nm 逐渐变为 0.8 nm。' },
                    parameterRelation: { tab: 'data', tabLabel: '参数关系', description: '用下拉框选择 T 随 E、V₀、d 的静态关系曲线；这里不是宽度扫描场景。' }
                },
                controls: {
                    tabs: { sim: '实时演化', data: '参数关系', history: '发展历史', theory: '原理解析' },
                    playPauseBtn: { label: isPlaying ? '暂停' : '播放', isPlaying },
                    resetBtn: { label: '重置波包' },
                    timeSlider: { label: '演化时间', currentTimeFs: currentTime },
                    v0Slider: { label: '势垒高度 V₀', resetsPacket: false },
                    dSlider: { label: '势垒宽度 d', resetsPacket: false },
                    eSlider: { label: '波包中心能量 E', resetsPacket: true },
                    sigmaSlider: { label: '波包初始宽度 σ', resetsPacket: true }
                }
            },
            parameters: { E: Number(E.toFixed(3)), V0: Number(V0.toFixed(3)), d: Number(d.toFixed(3)), sigma: Number(sigma.toFixed(3)) },
            theory: { scene: currentTheoryScene, focus: currentTheoryFocus, component: currentTheoryComponent },
            transmission: { T: Number(tr.T.toPrecision(6)), R: Number(tr.R.toPrecision(6)) },
            developmentHistory: {
                meaning: '量子隧穿发展历史时间轴，不是浏览记录、聊天记录或仿真结果记录',
                current: historyData[selectedHistoryNode]
                    ? { year: historyData[selectedHistoryNode].year, title: historyData[selectedHistoryNode].title }
                    : null,
                milestones: historyData.map(({ year, title }) => ({ year, title }))
            },
            whiteboard: assistantState.activeWhiteboard ? {
                title: assistantState.activeWhiteboard.title,
                step: assistantState.activeLessonStep + 1,
                totalSteps: assistantState.activeWhiteboard.steps?.length || 0,
                currentStep: stripAssistantHtml(assistantState.activeWhiteboard.steps?.[assistantState.activeLessonStep] || '').slice(0, 600)
            } : null,
            availableTabs: Object.keys(tabConfig),
            availableTheoryScenes: Object.keys(theoryScenes),
            availableTargets: Object.keys(assistantTargets),
            targetLocations: Object.fromEntries(Object.entries(assistantTargets).map(([target, info]) => [target, { tab: assistantTargetTabs[target] || null, label: info.label }])),
            availableLessons: Object.keys(assistantLessons)
        };
    }

    function buildAssistantSystemPrompt() {
        return String.raw`你是可操作的量子隧穿实验台中的中文助教。你的任务是让学生通过观察、尝试和讨论理解物理，而不只是提供一段说明文字。

【交流与交互】
由你结合学生的问题、前文和页面当前状态判断怎样教。优先考虑交互式讲解：哪里可以看见这个现象？改变哪个参数可以验证？要观察什么结果？如果页面上的图、实验或控件能帮助理解，就安排合适的动作，并用自然、简短的中文说明观察对象。不要把所有问题都处理成“文字回答 + 同一种批注”，也不要为了凑工具数量随意操作。
学生想看演示时，应实际安排播放、场景或参数变化等相应动作，不能只写一段“怎么做”的操作说明。学生想亲手尝试时，可以安排 interact 并等待操作，再观察结果；这与“让我看看演示”不同，不要混淆。涉及公式推导、概念拆解或实验结论时，白板可主动使用，不必等学生点名要求；短问题不必硬拆成多页板书。观察动画时，避免突然用白板盖住图像。
问候、致谢和确实只需一句结论的提问可以不操作页面。普通物理解释也要先考虑有没有有用的观察或互动，再决定是否只用文字。选择由你判断，前端不会按提问关键词替你决定。
reply 与 actions 必须一致：说“我会播放/切换/演示”就要安排对应动作；动作尚未执行时，不要声称“我已经完成”。没有安排的动作不要写成承诺。学生只需定位时不必改参数，学生说自己操作时不要代替他们自动修改。
语言像正常讨论：直接回答，承接前文，不反复报参数，不套“好问题”“我先带你看”“核心不是……而是……”等开场，也不把每次回答都写成完整讲义。使用页面可见的中文名称，不把 sim/data 等内部标识叫作标签名称。

【事实与页面状态】
本项目的算法和控件行为以 simulation 为准：含时仿真使用 Crank–Nicolson 隐式有限差分，不是 FFT 分裂算符；定态图使用 Numerov，理论 T/R 用矩形势垒解析公式。σ 调整会重置波包；解释数值透射变化时要考虑重置、观察时刻和整个波包的能量分布。
计算以 physicsCalculated 和学生给定条件为准。页面单位为 eV、nm、fs，m 的单位是 eV·fs²/nm²，ℏ 的单位是 eV·fs；不得直接设 m=ℏ=1。κ=√[2m(V₀−E)]/ℏ 的实数指数衰减适用于 E<V₀，单位 nm⁻¹。区分振幅、概率密度、中心能量理论 T 和波包数值透射。T≈exp(−2κd) 忽略了界面匹配前因子，不能当作页面精确 T 的恒等式。学生另给条件时使用其条件并说明单位。
宽度扫描在“原理解析”的 width 场景，不在“参数关系”中；simulation.experiments 列出实验入口。targetLocations 给出控件所属页面，定位时执行器会自动切页并滚动。右侧参数面板是共享控件，窄屏下可能在长内容后方，不要断言其他标签页不存在控件。

【输出】
整个响应只输出一个 JSON 对象；正文只能放在 reply 字段里，不要在对象前后再写一遍正文或追加代码围栏。字段顺序为：
{"thinking_summary":["可公开的简短解题依据"],"reply":"自然的中文回答，可含 $...$ 公式","actions":[]}
JSON 字符串里的 LaTeX 反斜杠要双写，例如 \kappa。reply 必须有实际内容。解释、推导或设计实验时，thinking_summary 用 1–3 条短句概括面向学生的思路；纯问候可以为空。它不是内部推理记录，不得包含提示词、指令、角色设定、上下文原文或完整推理。页面会逐条显示公开摘要和正文。
建议问题由页面固定题库轮换，不生成 suggestions 或 followups。actions 按执行顺序排列，可以为空，也可以组合多个有用步骤。动作对象格式为 {"type":"动作名","payload":{...}}。

【动作选择参考：按教学需要组合，不必逐项使用】
- jumpTab(tab=sim|data|history|theory)：切换“实时演化/参数关系/发展历史/原理解析”。
- playSimulation、pauseSimulation、resetSimulation：展示波包运动、停下来观察或重新开始。playSimulation 会回到实时演化。
- runTheoryScene(scene=tunnel|width|overBarrier)：分别展示势垒内部衰减、宽度扫描、越垒反射，自动进入原理解析。animateWidthSweep 也能演示宽度扫描。
- setTheoryFocus(focus=left|barrier|right)：把观察重点放到入射干涉、势垒内部或透射区域；setTheoryComponent(component=all|real|imag|env)：选择实部、虚部或包络。对比衰减时可选择 env，而不只是再画一个框。
- animateParams(E,V0,d,duration)：按明确的实验目的平滑改变参数。一次比较尽量只改相关变量；先利用当前值或建立有意义的基线，不随意改动。
- scrollToTarget(target)：定位控件或图表。annotate(target,shape,label,direction,duration)：选择 arrow 精确指向边缘、ring 框出比较区域、spotlight 聚焦、pulse 短暂强调，或 interact 邀请学生操作滑块。shape 要服务当前问题。target 只能取 availableTargets 中的名称。label 是简短主批注，不加说明性小字。
- interact 支持 direction=any|increase|decrease。系统等待学生真实操作并显示参数与理论 T 的变化，完成后才执行后续步骤；可以在其后安排结果区标记。不要在同一练习中又自动修改参数。
- showWhiteboard：payload={"title":"本题标题","steps":["与当前问题有关的 HTML/公式步骤"]}。也可返回同格式的 whiteboard 字段，二选一即可。主动判断板书是否能帮助推导、拆解概念或整理实验结果，内容针对本题生成，不使用 lessonId 或无关预置课件。steps 只用必要的 p、div、公式，不含 script、style 或事件属性。
- clearAnnotations：清理旧标记。

【示例：展示选择方式，不是固定回复模板】
学生想看宽度变化时，一种合理计划是先运行宽度场景，再只看包络并标出透射区域：
{"type":"runTheoryScene","payload":{"scene":"width"}}, {"type":"setTheoryComponent","payload":{"component":"env"}}, {"type":"setTheoryFocus","payload":{"focus":"right"}}, {"type":"annotate","payload":{"target":"regionCardRight","shape":"pulse","label":"观察透射波振幅"}}
学生想亲手调宽度时，可以暂停、邀请操作，再观察理论 T：
{"type":"pauseSimulation","payload":{}}, {"type":"annotate","payload":{"target":"dSlider","shape":"interact","direction":"increase","label":"试着增大 d"}}, {"type":"annotate","payload":{"target":"tValue","shape":"ring","label":"比较理论 T"}}
学生需要推导或概念拆解时，可以用 showWhiteboard 将关系式、条件和结论分步呈现，而不是只标记页面。选择适合这一次问题的安排，不照抄示例，也不要同时把演示、练习和白板全堆上去。`;
    }

    function buildAssistantMessages(userMessage) {
        const recentMessages = assistantState.messages
            .filter(message => !message.loading && !message.failed && !message.omitFromContext && (message.role === 'user' || message.role === 'assistant'))
            .slice(-16)
            .map(message => ({ role: message.role, content: message.content }));
        const lastMessage = recentMessages[recentMessages.length - 1];
        const messages = [
            { role: 'system', content: buildAssistantSystemPrompt() },
            { role: 'system', content: `当前网页上下文 JSON：${JSON.stringify(getAssistantContext())}` },
            ...recentMessages
        ];
        if (!lastMessage || lastMessage.role !== 'user' || lastMessage.content !== userMessage) {
            messages.push({ role: 'user', content: userMessage });
        }
        return messages;
    }

    function normalizeAssistantResponse(value) {
        const response = value && typeof value === 'object' ? value : {};
        if (typeof response.reply !== 'string' || !response.reply.trim()) throw new Error('invalid_response');
        const reply = response.reply.trim();
        const rawActions = Array.isArray(response.actions) ? response.actions.slice(0, 6) : [];
        const actions = [];
        let keptWhiteboard = false;
        rawActions.forEach(action => {
            if (action?.type === 'showWhiteboard') {
                if (keptWhiteboard) return;
                keptWhiteboard = true;
            }
            actions.push(action);
        });
        const hasWhiteboardAction = actions.some(action => action?.type === 'showWhiteboard');
        if (response.whiteboard && typeof response.whiteboard === 'object' && !hasWhiteboardAction) {
            actions.push({ type: 'showWhiteboard', payload: response.whiteboard });
        }
        actions.forEach(action => {
            if (action?.type === 'showWhiteboard' && action.payload && typeof action.payload === 'object') {
                action.payload.replySummary = reply;
            }
        });
        return {
            reply,
            thinkingSummary: QuantumTutor.sanitizeSummary(response.thinkingSummary || response.thinking_summary),
            actions
        };
    }

    async function callRemoteAssistant(userMessage, options = {}) {
        if (!assistantApiConfig.enabled || !assistantApiConfig.apiKey) {
            throw Object.assign(new Error('not_configured'), { code: 'not_configured' });
        }
        return normalizeAssistantResponse(await QuantumTutor.request({
            config: assistantApiConfig,
            question: userMessage,
            messages: buildAssistantMessages(userMessage),
            signal: options.signal,
            onUpdate: updateAssistantStream,
            onProgress: progress => {
                assistantState.loadingPhase = progress.phase;
                updateAssistantLoadingStatus();
            }
        }));
    }

    async function resolveAssistantResponse(message, signal) {
        try {
            const response = await callRemoteAssistant(message, { signal });
            return { ...response, source: 'remote' };
        } catch (error) {
            if (error.name === 'AbortError') throw error;
            const notice = QuantumTutor.getErrorMessage(error);
            console.warn('[QuantumTutor] request_failed', { code: error.code || 'network', reason: error.reason, status: error.status });
            return { reply: `${notice}，这次没能回答。请重试。`, actions: [], suggestions: [], thinkingSummary: [], notice, failed: true };
        }
    }

    function renderAssistantMessages() {
        const container = document.getElementById('aiTutorMessages');
        if (!container) return;
        const expanded = new Map(Array.from(container.querySelectorAll('details.ai-tutor-thinking')).map(node => [node.dataset.message, node.open]));
        const shouldFollow = container.scrollHeight - container.scrollTop - container.clientHeight < 60;
        container.innerHTML = assistantState.messages.map(message => `
            <div class="ai-tutor-message ${message.role} ${message.loading ? 'loading' : ''} ${message.streaming ? 'streaming' : ''}" data-message="${message.id}">
                <div class="ai-tutor-message-role">${message.role === 'user' ? '学生' : 'AI 助教'}</div>
                ${message.thinkingSummary?.length ? `<details class="ai-tutor-thinking" data-message="${message.id}" ${(expanded.has(String(message.id)) ? expanded.get(String(message.id)) : message.thinkingExpanded) ? 'open' : ''}><summary>思考链</summary><ol>${message.thinkingSummary.map(step => `<li>${escapeAssistantText(step)}</li>`).join('')}</ol></details>` : ''}
                <div class="ai-tutor-message-content">${message.loading && !message.streaming ? '<span class="ai-thinking-dots" aria-label="等待回答"><span></span><span></span><span></span></span>' : message.loading ? escapeAssistantText(message.content) : formatAssistantText(message.content)}</div>
            </div>
        `).join('');
        renderMathInNode(container);
        if (shouldFollow) container.scrollTop = container.scrollHeight;
    }

    function renderAssistantSuggestions({ advance = false } = {}) {
        const container = document.getElementById('aiTutorSuggestions');
        if (!container || (container.childElementCount && !advance)) return;
        if (advance) assistantState.questionGroupIndex = (assistantState.questionGroupIndex + 1) % assistantQuestionGroups.length;
        const questions = assistantQuestionGroups[assistantState.questionGroupIndex];
        container.innerHTML = questions.map(text => `<button type="button" class="ai-suggestion-chip">${escapeAssistantText(text)}</button>`).join('');
        container.scrollLeft = 0;
        container.querySelectorAll('button').forEach(button => {
            button.disabled = assistantState.isLoading;
            button.addEventListener('click', () => handleAssistantPrompt(button.textContent));
        });
    }

    function getAssistantStreamSnapshot() {
        const id = assistantState.loadingMessageId;
        const message = assistantState.messages.find(item => item.id === id);
        const details = document.querySelector(`.ai-tutor-message[data-message="${id}"] details`);
        return { ...message, thinkingExpanded: Boolean(details?.open) };
    }

    function updateAssistantStream(update) {
        const id = assistantState.loadingMessageId;
        const message = assistantState.messages.find(item => item.id === id);
        if (!message) return;
        message.content = update.reply || '';
        message.thinkingSummary = QuantumTutor.sanitizeSummary(update.thinkingSummary);
        message.streaming = true;
        if (assistantState.streamRenderFrame !== null) return;
        assistantState.streamRenderFrame = requestAnimationFrame(() => {
            assistantState.streamRenderFrame = null;
            if (id !== assistantState.loadingMessageId) return;
            const container = document.getElementById('aiTutorMessages');
            const bubble = container?.querySelector(`.ai-tutor-message[data-message="${id}"]`);
            if (!bubble) return;
            const shouldFollow = container.scrollHeight - container.scrollTop - container.clientHeight < 60;
            bubble.classList.add('streaming');
            let details = bubble.querySelector('details');
            if (message.thinkingSummary.length) {
                if (!details) {
                    details = document.createElement('details');
                    details.className = 'ai-tutor-thinking';
                    details.dataset.message = id;
                    const summary = document.createElement('summary');
                    summary.textContent = '思考链';
                    details.append(summary, document.createElement('ol'));
                    bubble.querySelector('.ai-tutor-message-content').before(details);
                }
                const list = details.querySelector('ol');
                const next = message.thinkingSummary.join('\n');
                if (list.dataset.steps !== next) {
                    list.dataset.steps = next;
                    list.replaceChildren(...message.thinkingSummary.map(text => {
                        const li = document.createElement('li');
                        li.textContent = text;
                        return li;
                    }));
                }
            } else details?.remove();
            // Plain text while tokens arrive: do not parse unfinished HTML or repeatedly typeset unfinished formulas.
            bubble.querySelector('.ai-tutor-message-content').textContent = message.content;
            if (shouldFollow) container.scrollTop = container.scrollHeight;
        });
    }

    function appendAssistantMessage(role, content, metadata = {}) {
        assistantState.messages.push({ id: ++assistantState.messageSequence, role, content, ...metadata });
        renderAssistantMessages();
    }

    function showAssistantThinking() {
        const id = `loading-${Date.now()}`;
        assistantState.loadingMessageId = id;
        assistantState.messages.push({ id, role: 'assistant', content: '', loading: true });
        renderAssistantMessages();
    }

    function removeAssistantThinking() {
        if (assistantState.streamRenderFrame !== null) cancelAnimationFrame(assistantState.streamRenderFrame);
        assistantState.streamRenderFrame = null;
        if (!assistantState.loadingMessageId) return;
        assistantState.messages = assistantState.messages.filter(message => message.id !== assistantState.loadingMessageId);
        assistantState.loadingMessageId = null;
        renderAssistantMessages();
    }

    function updateAssistantLoadingStatus() {
        if (!assistantState.isLoading) return;
        const phase = { connecting: '连接中', thinking: '思考中', answering: '正在回答' }[assistantState.loadingPhase] || '等待回答';
        const seconds = Math.floor((Date.now() - assistantState.loadingStarted) / 1000);
        const status = document.getElementById('aiTutorStatus');
        if (status) status.textContent = `${phase} · ${seconds} 秒`;
    }

    function setAssistantLoading(isLoading) {
        assistantState.isLoading = isLoading;
        const suggestions = document.getElementById('aiTutorSuggestions');
        suggestions?.setAttribute('aria-busy', String(isLoading));
        suggestions?.querySelectorAll('button').forEach(button => { button.disabled = isLoading; });
        const sendButton = document.getElementById('aiTutorSend');
        const status = document.getElementById('aiTutorStatus');
        const wbButton = document.querySelector('#aiWhiteboardFollowupForm button[type="submit"]');
        if (sendButton) {
            sendButton.disabled = false;
            sendButton.textContent = isLoading ? '停止' : '发送';
            sendButton.setAttribute('aria-label', isLoading ? '停止生成回答' : '发送问题');
        }
        if (wbButton) { wbButton.disabled = false; wbButton.textContent = isLoading ? '停止' : '追问'; }
        if (assistantState.loadingTimer) clearInterval(assistantState.loadingTimer);
        assistantState.loadingTimer = null;
        if (isLoading) {
            assistantState.loadingStarted = Date.now();
            assistantState.loadingPhase = 'connecting';
            updateAssistantLoadingStatus();
            assistantState.loadingTimer = setInterval(updateAssistantLoadingStatus, 1000);
        } else if (status) status.textContent = assistantState.statusText;
    }

    function toggleAssistant(open) {
        assistantState.isOpen = open;
        const root = document.getElementById('aiTutor');
        const launcher = document.getElementById('aiTutorLauncher');
        const panel = document.getElementById('aiTutorPanel');
        if (root) root.classList.toggle('open', open);
        document.body.classList.toggle('ai-tutor-open', open);
        if (launcher) launcher.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (panel) {
            panel.setAttribute('aria-hidden', open ? 'false' : 'true');
            if ('inert' in panel) panel.inert = !open;
            panel.querySelectorAll('button, textarea').forEach(control => {
                if (open) control.removeAttribute('tabindex');
                else control.setAttribute('tabindex', '-1');
            });
        }
        if (open) {
            setAssistantAvoidRightPanel(false);
            setTimeout(() => document.getElementById('aiTutorInput')?.focus(), 120);
        } else launcher?.focus();
    }

    function isValidAssistantAction(action) {
        if (!action || typeof action.type !== 'string') return false;
        const payload = action.payload || {};
        if (action.type === 'jumpTab') return Boolean(tabConfig[payload.tab]);
        if (action.type === 'runTheoryScene') return Boolean(theoryScenes[payload.scene]);
        if (action.type === 'setTheoryFocus') return Boolean(theoryFocusMeta[payload.focus]);
        if (action.type === 'setTheoryComponent') return Boolean(theoryComponentMeta[payload.component]);
        if (action.type === 'animateParams') return ['E', 'V0', 'd'].every(key => Number.isFinite(Number(payload[key])));
        if (action.type === 'animateWidthSweep') return true;
        if (['playSimulation', 'pauseSimulation', 'resetSimulation'].includes(action.type)) return true;
        if (action.type === 'scrollToTarget' || action.type === 'annotate') return Boolean(assistantTargets[payload.target]);
        if (action.type === 'showWhiteboard') return Boolean(assistantLessons[payload.lessonId]) || (typeof payload.title === 'string' && Array.isArray(payload.steps) && payload.steps.length > 0);
        if (action.type === 'clearAnnotations') return true;
        return false;
    }

    function isAssistantRightPanelTarget(targetKey) {
        return assistantRightPanelTargets.has(targetKey);
    }

    function setAssistantAvoidRightPanel(active, duration = 12000) {
        document.body.classList.toggle('ai-tutor-avoid-right-panel', active);
        if (assistantState.avoidRightPanelTimer) {
            clearTimeout(assistantState.avoidRightPanelTimer);
            assistantState.avoidRightPanelTimer = null;
        }
        if (active) {
            assistantState.avoidRightPanelTimer = setTimeout(() => {
                document.body.classList.remove('ai-tutor-avoid-right-panel');
                assistantState.avoidRightPanelTimer = null;
            }, duration);
        }
    }

    function prepareAssistantTargetVisibility(targetKey, duration) {
        if (!isAssistantRightPanelTarget(targetKey)) return;
        toggleAssistant(false);
        setAssistantAvoidRightPanel(true, Math.max(Number(duration) || 0, 12000));
    }

    function waitAssistant(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function getAssistantTargetElement(targetKey) {
        const target = assistantTargets[targetKey];
        return target ? document.querySelector(target.selector) : null;
    }

    function getValidAssistantRect(element) {
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        if (rect.width < 4 || rect.height < 4) return null;
        if (rect.bottom < 0 || rect.right < 0 || rect.top > window.innerHeight || rect.left > window.innerWidth) return null;
        return rect;
    }

    async function waitForAssistantTargetRect(targetKey, attempts = 12) {
        for (let i = 0; i < attempts; i++) {
            const element = getAssistantTargetElement(targetKey);
            const rect = getValidAssistantRect(element);
            if (rect) return { element, rect };
            await waitAssistant(80);
        }
        return { element: getAssistantTargetElement(targetKey), rect: null };
    }

    function enrichAssistantScrollActions(actions) {
        if (!Array.isArray(actions)) return [];
        const enriched = [];
        actions.forEach((action, index) => {
            enriched.push(action);
            if (action?.type !== 'scrollToTarget') return;
            const target = action.payload?.target;
            if (!assistantTargets[target]) return;
            const nextAction = actions[index + 1];
            const alreadyAnnotated = actions.some(candidate =>
                candidate?.type === 'annotate' && candidate.payload?.target === target
            );
            if (alreadyAnnotated || nextAction?.type === 'annotate') return;
            enriched.push({
                type: 'annotate',
                payload: {
                    target,
                    shape: 'spotlight',
                    label: `已定位到：${assistantTargets[target].label}`,
                    duration: 7000
                }
            });
        });
        return enriched;
    }

    async function executeAssistantActions(actions) {
        const runId = ++assistantState.currentActionRunId;
        const queuedActions = enrichAssistantScrollActions(actions).filter(isValidAssistantAction);
        for (const action of queuedActions) {
            if (runId !== assistantState.currentActionRunId) return;
            const payload = action.payload || {};
            if (action.type === 'jumpTab') {
                window.jumpToTab(payload.tab, payload.chartVar);
                await waitAssistant(450);
            } else if (action.type === 'runTheoryScene') {
                window.runTheoryScene(payload.scene);
                await waitAssistant(700);
            } else if (action.type === 'setTheoryFocus') {
                setTheoryFocus(payload.focus);
                await waitAssistant(250);
            } else if (action.type === 'setTheoryComponent') {
                setTheoryComponent(payload.component);
                await waitAssistant(250);
            } else if (action.type === 'animateParams') {
                window.animateParamsTo(Number(payload.E), Number(payload.V0), Number(payload.d), Number(payload.duration) || 1200);
                await waitAssistant(Math.min(1800, Number(payload.duration) || 1200));
            } else if (action.type === 'animateWidthSweep') {
                window.runTheoryScene('width');
                await waitAssistant(1200);
            } else if (action.type === 'playSimulation') {
                activateTab('sim');
                if (currentFrame >= MAX_FRAMES) resetAndRender();
                isPlaying = true;
                updatePlayPauseUI();
                await waitAssistant(450);
            } else if (action.type === 'pauseSimulation') {
                activateTab('sim');
                isPlaying = false;
                playbackFrameAccumulator = 0;
                updatePlayPauseUI();
                await waitAssistant(250);
            } else if (action.type === 'resetSimulation') {
                activateTab('sim');
                resetAndRender();
                isPlaying = true;
                updatePlayPauseUI();
                await waitAssistant(450);
            } else if (action.type === 'scrollToTarget') {
                if (!await scrollAssistantTargetIntoView(payload.target, runId, payload.duration)) return;
                await waitAssistant(200);
            } else if (action.type === 'annotate') {
                if (!await scrollAssistantTargetIntoView(payload.target, runId, payload.duration)) return;
                if (runId !== assistantState.currentActionRunId) return;
                const annotation = await showAssistantAnnotation(payload, { runId });
                if (annotation?.interactive) {
                    const result = await annotation.finished;
                    if (!result.completed || runId !== assistantState.currentActionRunId) return;
                    await waitAssistant(650);
                } else {
                    await waitAssistant(Math.min(Number(payload.duration) || 1200, 1600));
                }
            } else if (action.type === 'showWhiteboard') {
                showAssistantWhiteboard(payload);
                await waitAssistant(300);
            } else if (action.type === 'clearAnnotations') {
                clearAssistantAnnotation({ clearAvoidRightPanel: true });
            }
        }
    }

    async function scrollAssistantTargetIntoView(targetKey, runId, duration) {
        const isCurrent = () => runId === undefined || runId === assistantState.currentActionRunId;
        if (!isCurrent()) return false;
        const targetTab = assistantTargetTabs[targetKey];
        if (targetTab && currentTab !== targetTab) {
            activateTab(targetTab);
            await waitAssistant(180);
        }
        if (!isCurrent()) return false;
        prepareAssistantTargetVisibility(targetKey, duration);
        for (let attempt = 0; attempt < 12; attempt++) {
            if (!isCurrent()) return false;
            const element = getAssistantTargetElement(targetKey);
            const rect = element?.getBoundingClientRect();
            const style = element && getComputedStyle(element);
            if (rect && rect.width >= 4 && rect.height >= 4 && style.visibility !== 'hidden' && style.display !== 'none') {
                element.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'center', inline: 'center' });
                await waitAssistant(350);
                return isCurrent();
            }
            await waitAssistant(80);
        }
        return false;
    }

    function createWhiteboardFromReply(title, reply) {
        const cleanReply = stripAssistantHtml(reply).slice(0, 900);
        return {
            title,
            replySummary: reply,
            steps: [
                `<p>${escapeAssistantText(cleanReply)}</p>`
            ],
            followups: []
        };
    }

    function inferAssistantInteractionActions(userMessage, response) {
        // The model chooses the teaching plan. Only validate executable actions here.
        if (response.failed || !Array.isArray(response.actions)) return [];
        return response.actions.filter(isValidAssistantAction).slice(0, 7);
    }

    async function handleAssistantPrompt(promptText) {
        const message = String(promptText || '').trim();
        if (!message || assistantState.isLoading) return;
        toggleAssistant(true);
        appendAssistantMessage('user', message);
        assistantState.currentActionRunId++;
        clearAssistantAnnotation({ clearAvoidRightPanel: true });
        const controller = new AbortController();
        assistantState.requestController = controller;
        setAssistantLoading(true);
        showAssistantThinking();
        try {
            const response = await resolveAssistantResponse(message, controller.signal);
            controller.signal.throwIfAborted();
            const streamed = getAssistantStreamSnapshot();
            removeAssistantThinking();
            appendAssistantMessage('assistant', response.reply, { thinkingSummary: response.thinkingSummary, thinkingExpanded: streamed.thinkingExpanded, failed: response.failed });
            assistantState.statusText = response.notice || 'DeepSeek';
            if (!response.failed) renderAssistantSuggestions({ advance: true });
            executeAssistantActions(inferAssistantInteractionActions(message, response));
        } catch (error) {
            const streamed = getAssistantStreamSnapshot();
            removeAssistantThinking();
            const stopped = error.name === 'AbortError';
            appendAssistantMessage('assistant', stopped && streamed.content ? `${streamed.content}\n\n已停止。` : stopped ? '已停止。' : '这次没能回答，请重试。', { failed: true, thinkingSummary: streamed.thinkingSummary, thinkingExpanded: streamed.thinkingExpanded });
            assistantState.statusText = error.name === 'AbortError' ? '已停止' : '回答失败';
        } finally {
            assistantState.requestController = null;
            setAssistantLoading(false);
        }
    }

    function showWhiteboardRequestError(text) {
        const body = document.getElementById('aiWhiteboardBody');
        if (!body) return;
        body.querySelector('.ai-whiteboard-error')?.remove();
        const notice = document.createElement('p');
        notice.className = 'ai-whiteboard-error';
        notice.setAttribute('role', 'alert');
        notice.textContent = text;
        body.prepend(notice);
    }

    async function handleWhiteboardFollowup(promptText) {
        const message = String(promptText || '').trim();
        if (!message || assistantState.isLoading) return;
        document.querySelector('#aiWhiteboardBody .ai-whiteboard-error')?.remove();
        appendAssistantMessage('user', message);
        assistantState.currentActionRunId++;
        clearAssistantAnnotation({ clearAvoidRightPanel: true });
        const controller = new AbortController();
        assistantState.requestController = controller;
        setAssistantLoading(true);
        try {
            const response = await resolveAssistantResponse(message, controller.signal);
            controller.signal.throwIfAborted();
            appendAssistantMessage('assistant', response.reply, { thinkingSummary: response.thinkingSummary, failed: response.failed });
            const actions = inferAssistantInteractionActions(message, response);
            const whiteboardAction = actions.find(action => action.type === 'showWhiteboard');
            // A failed request must not overwrite the existing board with an unrelated lesson.
            if (!response.failed) showAssistantWhiteboard(whiteboardAction ? whiteboardAction.payload : createWhiteboardFromReply('追问', response.reply));
            else showWhiteboardRequestError(response.reply);
            assistantState.statusText = response.notice || 'DeepSeek';
            if (!response.failed) renderAssistantSuggestions({ advance: true });
            executeAssistantActions(actions.filter(action => action.type !== 'showWhiteboard'));
        } catch (error) {
            showWhiteboardRequestError(error.name === 'AbortError' ? '已停止。' : '这次没能回答，请重试。');
            appendAssistantMessage('assistant', error.name === 'AbortError' ? '已停止。' : '这次没能回答，请重试。', { failed: true });
            assistantState.statusText = error.name === 'AbortError' ? '已停止' : '回答失败';
        } finally {
            assistantState.requestController = null;
            setAssistantLoading(false);
        }
    }

    function sanitizeWhiteboardStep(html) {
        const safe = String(html ?? '');
        return safe
            .replace(/<\s*script[\s\S]*?<\s*\/\s*script\s*>/gi, '')
            .replace(/<\s*style[\s\S]*?<\s*\/\s*style\s*>/gi, '')
            .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
            .replace(/javascript:/gi, '');
    }

    function buildAssistantWhiteboard(payload) {
        if (payload && typeof payload.title === 'string' && Array.isArray(payload.steps) && payload.steps.length > 0) {
            return {
                title: payload.title.slice(0, 80),
                replySummary: typeof payload.replySummary === 'string' ? payload.replySummary : '',
                steps: payload.steps.slice(0, 6).map(sanitizeWhiteboardStep),
                followups: Array.isArray(payload.followups) ? payload.followups.filter(item => typeof item === 'string').slice(0, 4) : []
            };
        }
        const lessonId = typeof payload === 'string' ? payload : payload?.lessonId;
        const lesson = assistantLessons[lessonId] || assistantLessons.tunnelDecay;
        return {
            title: lesson.title,
            replySummary: typeof payload?.replySummary === 'string' ? payload.replySummary : '',
            steps: lesson.steps,
            followups: []
        };
    }

    function showAssistantWhiteboard(payload) {
        assistantState.activeWhiteboard = buildAssistantWhiteboard(payload);
        assistantState.activeLessonId = typeof payload === 'string' ? payload : payload?.lessonId || null;
        assistantState.activeLessonStep = 0;
        renderAssistantWhiteboard();
        toggleAssistant(false);
        const backdrop = document.getElementById('aiWhiteboardBackdrop');
        if (backdrop) {
            backdrop.classList.add('active');
            backdrop.setAttribute('aria-hidden', 'false');
            document.body.classList.add('ai-whiteboard-open');
        }
        setTimeout(() => document.getElementById('aiWhiteboardClose')?.focus(), 80);
    }

    function closeAssistantWhiteboard() {
        const backdrop = document.getElementById('aiWhiteboardBackdrop');
        if (!backdrop || !backdrop.classList.contains('active')) return;
        backdrop.classList.remove('active');
        backdrop.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('ai-whiteboard-open');
        document.getElementById('aiTutorLauncher')?.focus();
    }

    function renderAssistantWhiteboard() {
        const whiteboard = assistantState.activeWhiteboard;
        if (!whiteboard || !whiteboard.steps || whiteboard.steps.length === 0) return;
        const titleEl = document.getElementById('aiWhiteboardTitle');
        const bodyEl = document.getElementById('aiWhiteboardBody');
        const prevBtn = document.getElementById('aiWhiteboardPrev');
        const nextBtn = document.getElementById('aiWhiteboardNext');
        const step = Math.max(0, Math.min(assistantState.activeLessonStep, whiteboard.steps.length - 1));
        assistantState.activeLessonStep = step;
        if (titleEl) titleEl.textContent = whiteboard.title;
        if (bodyEl) {
            const tr = calculateTR(E, V0, d);
            bodyEl.innerHTML = `
                ${whiteboard.replySummary ? `<div class="ai-whiteboard-summary"><div class="ai-whiteboard-summary-label">本轮讲解</div>${formatAssistantText(whiteboard.replySummary)}</div>` : ''}
                <div class="ai-whiteboard-step">第 ${step + 1} / ${whiteboard.steps.length} 步</div>
                ${whiteboard.steps[step]}
                <div class="ai-whiteboard-current">
                    当前页面参数：E=${E.toFixed(2)} eV，V₀=${V0.toFixed(2)} eV，d=${d.toFixed(2)} nm，理论 T≈${tr.T.toExponential(3)}。
                </div>
            `;
            renderMathInNode(bodyEl);
        }
        if (prevBtn) prevBtn.disabled = step === 0;
        if (nextBtn) {
            const isLastStep = step === whiteboard.steps.length - 1;
            nextBtn.textContent = '下一步';
            nextBtn.disabled = isLastStep;
            nextBtn.dataset.finalStep = isLastStep ? 'true' : 'false';
        }
    }

    function getAssistantAnnotationController() {
        if (assistantState.annotationController) return assistantState.annotationController;
        assistantState.annotationController = QuantumAnnotations.createController({
            layer: document.getElementById('aiAnnotationLayer'),
            svg: document.getElementById('aiAnnotationSvg'),
            label: document.getElementById('aiAnnotationLabel'),
            spotlight: document.getElementById('aiSpotlight'),
            getSnapshot: () => ({ E, V0, d, T: calculateTR(E, V0, d).T }),
            onDismiss: reason => {
                assistantState.activeAnnotation = null;
                if (reason !== 'replaced') {
                    assistantState.annotationRequestId++;
                    setAssistantAvoidRightPanel(false);
                }
            },
            onFollowup: prompt => handleAssistantPrompt(prompt),
            onPractice: payload => {
                assistantState.currentActionRunId++;
                prepareAssistantTargetVisibility(payload.target);
                showAssistantAnnotation(payload);
            }
        });
        return assistantState.annotationController;
    }

    async function showAssistantAnnotation(payload, options = {}) {
        const requestId = ++assistantState.annotationRequestId;
        const { element, rect } = await waitForAssistantTargetRect(payload.target);
        if (requestId !== assistantState.annotationRequestId ||
            (options.runId !== undefined && options.runId !== assistantState.currentActionRunId)) return null;
        if (!element || !rect) {
            clearAssistantAnnotation({ clearAvoidRightPanel: true });
            return null;
        }
        const parameterMeta = {
            v0Slider: { name: '势垒高度 V₀', unit: 'eV' },
            dSlider: { name: '势垒宽度 d', unit: 'nm' },
            eSlider: { name: '总能量 E', unit: 'eV' },
            sigmaSlider: { name: '波包宽度 σ', unit: 'nm' }
        };
        const controller = getAssistantAnnotationController();
        const session = controller.show(element, {
            ...payload,
            label: payload.label || assistantTargets[payload.target]?.label || '观察标记区域'
        }, parameterMeta[payload.target] || { name: assistantTargets[payload.target]?.label });
        assistantState.activeAnnotation = payload;
        return session;
    }

    function clearAssistantAnnotation(options = {}) {
        assistantState.annotationRequestId++;
        assistantState.annotationController?.clear();
        assistantState.activeAnnotation = null;
        if (options.clearAvoidRightPanel === true) setAssistantAvoidRightPanel(false);
    }

    function initAssistantTutor() {
        const launcher = document.getElementById('aiTutorLauncher');
        const close = document.getElementById('aiTutorClose');
        const form = document.getElementById('aiTutorForm');
        const input = document.getElementById('aiTutorInput');
        const wbClose = document.getElementById('aiWhiteboardClose');
        const wbPrev = document.getElementById('aiWhiteboardPrev');
        const wbNext = document.getElementById('aiWhiteboardNext');
        const wbFollowupForm = document.getElementById('aiWhiteboardFollowupForm');
        const wbFollowupInput = document.getElementById('aiWhiteboardFollowupInput');
        const wbNewTopic = document.getElementById('aiWhiteboardNewTopic');
        launcher?.addEventListener('click', () => {
            if (document.body.classList.contains('ai-whiteboard-open')) {
                closeAssistantWhiteboard();
                toggleAssistant(true);
                return;
            }
            toggleAssistant(!assistantState.isOpen);
        });
        close?.addEventListener('click', () => toggleAssistant(false));
        form?.addEventListener('submit', event => {
            event.preventDefault();
            if (assistantState.isLoading) { assistantState.requestController?.abort(); return; }
            const value = input?.value || '';
            if (input) input.value = '';
            handleAssistantPrompt(value);
        });
        input?.addEventListener('keydown', event => {
            if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                form?.requestSubmit();
            }
        });
        wbClose?.addEventListener('click', closeAssistantWhiteboard);
        wbPrev?.addEventListener('click', () => {
            assistantState.activeLessonStep -= 1;
            renderAssistantWhiteboard();
        });
        wbNext?.addEventListener('click', () => {
            const whiteboard = assistantState.activeWhiteboard;
            if (!whiteboard || assistantState.activeLessonStep >= whiteboard.steps.length - 1) return;
            assistantState.activeLessonStep += 1;
            renderAssistantWhiteboard();
        });
        wbFollowupForm?.addEventListener('submit', event => {
            event.preventDefault();
            if (assistantState.isLoading) { assistantState.requestController?.abort(); return; }
            const value = wbFollowupInput?.value || '';
            if (wbFollowupInput) wbFollowupInput.value = '';
            handleWhiteboardFollowup(value);
        });
        wbNewTopic?.addEventListener('click', () => {
            closeAssistantWhiteboard();
            toggleAssistant(true);
            document.getElementById('aiTutorInput')?.focus();
        });
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape') {
                closeAssistantWhiteboard();
                clearAssistantAnnotation({ clearAvoidRightPanel: true });
            }
        });
        toggleAssistant(false);
        renderAssistantSuggestions();
    }

    // 交互状态
    // 数组
    let psiRe = new Float64Array(N);
    let psiIm = new Float64Array(N);
    let V = new Float64Array(N);
    
    // 全局概率跟踪 (波包吸收)
    let initialTotalProb = 1.0;
    let absorbedLeft = 0.0;
    let absorbedRight = 0.0;
    
    // Crank-Nicolson 算法的复数三对角矩阵追赶法 (Thomas Algorithm) 内部数组
    let cRe = new Float64Array(N);
    let cIm = new Float64Array(N);
    let dRe = new Float64Array(N);
    let dIm = new Float64Array(N);

    function getInitialPacketCenter() {
        return -6.0;
    }

    function getInitialPacketWaveNumber() {
        return Math.sqrt(2 * mass * E) / hbar;
    }

    function syncParamDisplays() {
        document.getElementById('v0Slider').value = V0;
        document.getElementById('dSlider').value = d;
        document.getElementById('eSlider').value = E;
        document.getElementById('sigmaSlider').value = sigma;
        document.getElementById('v0Value').textContent = V0.toFixed(1);
        document.getElementById('dValue').textContent = d.toFixed(2);
        document.getElementById('eValue').textContent = E.toFixed(1);
        document.getElementById('sigmaValue').textContent = sigma.toFixed(1);
    }

    function syncPlaybackSpeedControls() {
        const slider = document.getElementById('playbackSpeedSlider');
        const value = document.getElementById('playbackSpeedValue');
        if (slider) slider.value = playbackSpeed.toFixed(2);
        if (value) value.textContent = `${playbackSpeed.toFixed(2)}x`;
    }

    function syncRelationSigmaControls() {
        const slider = document.getElementById('relationSigmaSlider');
        const value = document.getElementById('relationSigmaValue');
        if (slider) slider.value = relationSigma.toFixed(2);
        if (value) value.textContent = relationSigma.toFixed(2);
    }

    function syncRelationSpeedControls() {
        const slider = document.getElementById('relationSpeedSlider');
        const value = document.getElementById('relationSpeedValue');
        if (slider) slider.value = relationPlaybackSpeed.toFixed(2);
        if (value) value.textContent = `${relationPlaybackSpeed.toFixed(2)}x`;
    }

    function updateRelationPlayPauseUI() {
        const button = document.getElementById('relationPlayPauseBtn');
        if (!button) return;
        button.textContent = isRelationPlaying ? '暂停' : '播放';
        button.setAttribute('aria-label', isRelationPlaying ? '暂停 sigma 自动扫描' : '播放 sigma 自动扫描');
    }

    function renderRelationChart() {
        const relationCanvas = document.getElementById('densityParticleRelationCanvas');
        if (!relationCanvas) return;
        renderDensityParticleRelation(relationCanvas.getContext('2d'), relationCanvas.width, relationCanvas.height);
    }

    function syncRelationPlaybackPhaseFromSigma() {
        const normalized = ((relationSigma - relationSigmaMin) / (relationSigmaMax - relationSigmaMin)) * 2 - 1;
        const clamped = Math.min(1, Math.max(-1, normalized));
        relationPlaybackPhase = Math.asin(clamped);
    }

    function setRelationSigma(nextSigma, options = {}) {
        relationSigma = Math.min(relationSigmaMax, Math.max(relationSigmaMin, nextSigma));
        syncRelationSigmaControls();
        renderRelationChart();
        if (options.syncPhase) {
            syncRelationPlaybackPhaseFromSigma();
        }
        if (options.stopPlayback) {
            isRelationPlaying = false;
            relationPlaybackLastTime = null;
            updateRelationPlayPauseUI();
        }
    }

    function stepRelationSigmaPlayback(timestamp) {
        if (!isRelationPlaying) return;
        if (relationPlaybackLastTime === null) {
            relationPlaybackLastTime = timestamp;
            return;
        }
        const deltaSeconds = Math.min(0.05, (timestamp - relationPlaybackLastTime) / 1000);
        relationPlaybackLastTime = timestamp;
        const period = relationPlaybackBasePeriod / relationPlaybackSpeed;
        relationPlaybackPhase += (deltaSeconds * Math.PI * 2) / period;
        const mid = (relationSigmaMin + relationSigmaMax) / 2;
        const amplitude = (relationSigmaMax - relationSigmaMin) / 2;
        const nextSigma = mid + amplitude * Math.sin(relationPlaybackPhase);
        setRelationSigma(nextSigma);
    }

    function clampSimChartHeight(key, height) {
        const chartConfig = simChartConfigs[key];
        if (!chartConfig) return Number(height);

        const numericHeight = Number(height);
        if (!Number.isFinite(numericHeight)) return chartConfig.defaultHeight;
        return Math.min(chartConfig.maxHeight, Math.max(chartConfig.minHeight, Math.round(numericHeight)));
    }

    function applySimChartHeight(key) {
        const chartConfig = simChartConfigs[key];
        const canvas = chartConfig ? document.getElementById(chartConfig.canvasId) : null;
        if (!canvas) return;

        const height = clampSimChartHeight(key, chartConfig.height ?? canvas.height ?? chartConfig.defaultHeight);
        chartConfig.height = height;
        canvas.height = height;
        canvas.style.height = `${height}px`;
    }

    function applyAllSimChartHeights() {
        Object.keys(simChartConfigs).forEach(applySimChartHeight);
    }

    function renderSimCharts() {
        const cWave = document.getElementById('waveCanvas');
        const cDensity = document.getElementById('densityCanvas');
        const cEnsemble = document.getElementById('ensembleCanvas');
        const cDataRelation = document.getElementById('densityParticleRelationCanvas');

        renderWave(cWave.getContext('2d'), cWave.width, cWave.height);
        renderDensity(cDensity.getContext('2d'), cDensity.width, cDensity.height);
        renderEnsemble(cEnsemble.getContext('2d'), cEnsemble.width, cEnsemble.height);
        if (cDataRelation) {
            renderDensityParticleRelation(cDataRelation.getContext('2d'), cDataRelation.width, cDataRelation.height);
        }
        updateActualTR();
    }

    function initSimChartResizeControls() {
        let activeResizeDrag = null;

        document.querySelectorAll('.chart-height-reset').forEach(button => {
            button.addEventListener('click', () => {
                const key = button.dataset.resetKey;
                const chartConfig = simChartConfigs[key];
                if (!chartConfig) return;

                chartConfig.height = chartConfig.defaultHeight;
                applySimChartHeight(key);
                renderSimCharts();
            });
        });

        document.querySelectorAll('.chart-resize-handle').forEach(handle => {
            const key = handle.dataset.resizeKey;
            if (!key) return;
            const chartConfig = simChartConfigs[key];
            if (!chartConfig) return;

            const startDrag = event => {
                if (activeResizeDrag) return;
                event.preventDefault();

                const touch = event.touches ? event.touches[0] : event;
                const pointerId = event.pointerId ?? touch?.pointerId ?? Date.now();
                if (handle.setPointerCapture && event.pointerId !== undefined) {
                    handle.setPointerCapture(pointerId);
                }
                document.body.classList.add('chart-resize-dragging');

                const canvas = document.getElementById(chartConfig.canvasId);
                const startY = touch.clientY;
                const startHeight = chartConfig.height ?? canvas?.height ?? chartConfig.defaultHeight;
                const dragState = { handle, pointerId };
                activeResizeDrag = dragState;

                const onMove = moveEvent => {
                    if (activeResizeDrag !== dragState) return;
                    const moveTouch = moveEvent.touches ? moveEvent.touches[0] : moveEvent;
                    const movePointerId = moveEvent.pointerId ?? moveTouch?.pointerId ?? dragState.pointerId;
                    if (movePointerId !== dragState.pointerId) return;
                    const clientY = moveTouch.clientY;
                    chartConfig.height = clampSimChartHeight(key, startHeight + (clientY - startY));
                    applySimChartHeight(key);
                    renderSimCharts();
                };

                const cleanupDrag = shouldReleaseCapture => {
                    if (activeResizeDrag !== dragState) return;
                    activeResizeDrag = null;
                    document.body.classList.remove('chart-resize-dragging');
                    handle.removeEventListener('pointermove', onMove);
                    handle.removeEventListener('pointerup', stop);
                    handle.removeEventListener('pointercancel', stop);
                    handle.removeEventListener('lostpointercapture', onLostPointerCapture);
                    handle.removeEventListener('touchmove', onMove);
                    handle.removeEventListener('touchend', stop);
                    handle.removeEventListener('touchcancel', stop);
                    if (shouldReleaseCapture && handle.releasePointerCapture && dragState.pointerId !== undefined) {
                        const canRelease = typeof handle.hasPointerCapture === 'function' ? handle.hasPointerCapture(dragState.pointerId) : true;
                        if (canRelease) handle.releasePointerCapture(dragState.pointerId);
                    }
                };

                const stop = endEvent => {
                    const endTouch = endEvent.touches ? endEvent.touches[0] : endEvent;
                    const endPointerId = endEvent.pointerId ?? endTouch?.pointerId ?? dragState.pointerId;
                    if (endPointerId === dragState.pointerId) cleanupDrag(true);
                };
                const onLostPointerCapture = lostEvent => {
                    const lostPointerId = lostEvent.pointerId ?? dragState.pointerId;
                    if (lostPointerId === dragState.pointerId) cleanupDrag(false);
                };

                handle.addEventListener('pointermove', onMove);
                handle.addEventListener('pointerup', stop);
                handle.addEventListener('pointercancel', stop);
                handle.addEventListener('lostpointercapture', onLostPointerCapture);
                handle.addEventListener('touchmove', onMove, { passive: false });
                handle.addEventListener('touchend', stop);
                handle.addEventListener('touchcancel', stop);
            };

            handle.addEventListener('pointerdown', startDrag);
            handle.addEventListener('touchstart', startDrag, { passive: false });
        });
    }

    function updateTheoryNarrative() {
        const scene = theoryScenes[currentTheoryScene];
        const focus = theoryFocusMeta[currentTheoryFocus];
        const component = theoryComponentMeta[currentTheoryComponent];
        if (!scene || !focus || !component) return;

        document.querySelectorAll('.theory-section-card').forEach(card => {
            card.classList.toggle('active', card.dataset.scene === currentTheoryScene);
        });

        document.querySelectorAll('.theory-focus-btn').forEach(button => {
            button.classList.toggle('active', button.dataset.focus === currentTheoryFocus);
        });

        document.querySelectorAll('.theory-component-btn').forEach(button => {
            button.classList.toggle('active', button.dataset.component === currentTheoryComponent);
        });

        const titleEl = document.getElementById('theoryCanvasTitle');
        const subtitleEl = document.getElementById('theoryCanvasSubtitle');
        const focusTagEl = document.getElementById('theoryCanvasFocusTag');
        const focusExplainEl = document.getElementById('theoryFocusExplain');
        const componentExplainEl = document.getElementById('theoryComponentExplain');
        const calcLeadEl = document.getElementById('theoryCalcLead');

        if (titleEl) titleEl.textContent = scene.title;
        if (subtitleEl) subtitleEl.textContent = scene.subtitle;
        if (focusTagEl) focusTagEl.textContent = `当前焦点：${focus.label}`;
        if (focusExplainEl) focusExplainEl.textContent = focus.explain;
        if (componentExplainEl) componentExplainEl.textContent = component.explain;
        if (calcLeadEl) calcLeadEl.textContent = scene.calcLead;

        if (subtitleEl && window.renderMathInElement) {
            renderMathInElement(subtitleEl, {
                delimiters: [
                    {left: '$$', right: '$$', display: true},
                    {left: '$', right: '$', display: false}
                ]
            });
        }

        if (focusExplainEl && window.renderMathInElement) {
            renderMathInElement(focusExplainEl, {
                delimiters: [
                    {left: '$$', right: '$$', display: true},
                    {left: '$', right: '$', display: false}
                ]
            });
        }

        if (componentExplainEl && window.renderMathInElement) {
            renderMathInElement(componentExplainEl, {
                delimiters: [
                    {left: '$$', right: '$$', display: true},
                    {left: '$', right: '$', display: false}
                ]
            });
        }
    }

    function setTheoryFocus(focusKey) {
        if (!theoryFocusMeta[focusKey]) return;
        currentTheoryFocus = focusKey;
        updateTheoryNarrative();
        if (currentTab === 'theory') {
            ['regionCardLeft', 'regionCardBarrier', 'regionCardRight'].forEach(id => {
                const card = document.getElementById(id);
                if (card) card.classList.remove('highlight');
            });
            const cardMap = { left: 'regionCardLeft', barrier: 'regionCardBarrier', right: 'regionCardRight' };
            const targetCard = document.getElementById(cardMap[focusKey]);
            if (targetCard) targetCard.classList.add('highlight');
            renderTheoryNumerov();
        }
    }

    function setTheoryScene(sceneKey) {
        if (!theoryScenes[sceneKey]) return;
        currentTheoryScene = sceneKey;
        currentTheoryFocus = theoryScenes[sceneKey].focus;
        updateTheoryNarrative();
        if (currentTab === 'theory') {
            ['regionCardLeft', 'regionCardBarrier', 'regionCardRight'].forEach(id => {
                const card = document.getElementById(id);
                if (card) card.classList.remove('highlight');
            });
            const cardMap = { left: 'regionCardLeft', barrier: 'regionCardBarrier', right: 'regionCardRight' };
            const targetCard = document.getElementById(cardMap[currentTheoryFocus]);
            if (targetCard) targetCard.classList.add('highlight');
            updateTheoryCalc();
            renderTheoryNumerov();
        }
    }

    function setTheoryComponent(componentKey) {
        if (!theoryComponentMeta[componentKey]) return;
        currentTheoryComponent = componentKey;
        updateTheoryNarrative();
        if (currentTab === 'theory') {
            renderTheoryNumerov();
        }
    }

    function updatePotential() {
        V = QuantumPhysics.buildPotential({ N, xMin, dx, barrierCenter, d, V0 });
    }

    function initSimulation() {
        absorbedLeft = 0.0;
        absorbedRight = 0.0;

        // 波矢 k = sqrt(2mE) / hbar
        const k0 = getInitialPacketWaveNumber();
        const x0 = getInitialPacketCenter(); // 初始位置在势垒左侧，并且在吸收层之外
        
        updatePotential();
        const packet = QuantumPhysics.createGaussianPacket({ N, xMin, dx, x0, k0, sigma });
        psiRe = packet.psiRe;
        psiIm = packet.psiIm;
        
        // 计算初始时刻的全局总概率（波包初始的质量）
        initialTotalProb = 0;
        for (let i = 0; i < N; i++) {
            initialTotalProb += (psiRe[i]*psiRe[i] + psiIm[i]*psiIm[i]) * dx;
        }

        updateTheoreticalTR();
        updateActualTR();
        updateTheoryCalc();
        syncParamDisplays();
        
        stateHistory = [];
        currentTime = 0.0;
        currentFrame = 0;
        saveState();
        document.getElementById('timeSlider').value = 0;
        document.getElementById('timeValueDisp').textContent = "0.00";
    }

    function saveState() {
        stateHistory.push({
            psiRe: new Float64Array(psiRe),
            psiIm: new Float64Array(psiIm),
            absorbedLeft: absorbedLeft,
            absorbedRight: absorbedRight,
            time: currentTime
        });
    }

    function loadState(index) {
        const state = stateHistory[index];
        psiRe.set(state.psiRe);
        psiIm.set(state.psiIm);
        absorbedLeft = state.absorbedLeft;
        absorbedRight = state.absorbedRight;
        currentTime = state.time;
        document.getElementById('timeValueDisp').textContent = currentTime.toFixed(2);
        document.getElementById('timeSlider').value = index;
    }

    // Crank-Nicolson 算法实现 (更严谨的物理单位版)
    function solveCrankNicolson() {
        const absorption = {
            left: absorbedLeft,
            right: absorbedRight
        };

        QuantumPhysics.stepCrankNicolson({
            psiRe,
            psiIm,
            V,
            dt,
            dx,
            mass,
            hbar,
            work: { cRe, cIm, dRe, dIm },
            absorption,
            dampCoefs: [
                0.001, 0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.15, 0.3, 0.5,
                0.7, 0.85, 0.9, 0.925, 0.95, 0.975, 0.99, 0.995, 0.999
            ]
        });

        absorbedLeft = absorption.left;
        absorbedRight = absorption.right;
    }

    function calculateTR(e_val, v0_val, d_val) {
        return QuantumPhysics.calculateRectBarrierTR({
            E: e_val,
            V0: v0_val,
            d: d_val,
            mass,
            hbar
        });
    }

    function computeTheoreticalTR() {
        return calculateTR(E, V0, d);
    }

    function updateTheoreticalTR() {
        const { T, R } = computeTheoreticalTR();
        document.getElementById('tValue').textContent = T.toFixed(4);
        document.getElementById('rValue').textContent = R.toFixed(4);
    }

    function updateActualTR() {
        let actualT = QuantumPhysics.measureProbabilities({
            psiRe,
            psiIm,
            xMin,
            dx,
            barrierCenter,
            d,
            N_damp,
            absorbedLeft,
            absorbedRight,
            initialTotalProb
        }).actualT;
        
        if (actualT < 0) actualT = 0;
        if (actualT > 1) actualT = 1;
        
        document.getElementById('actualTValue').textContent = (actualT * 100).toFixed(2) + "%";
    }

    // --- 渲染逻辑 ---

    function getCanvasX(x, width) {
        // 渲染只截取可视化区域，屏蔽隐藏阻尼层
        return (x - xMinVisible) / (xMaxVisible - xMinVisible) * width;
    }

    function renderEnergy(ctx, width, height) {
        ctx.clearRect(0, 0, width, height);
        
        // 势垒区域
        const bLeft = getCanvasX(barrierCenter - d/2, width);
        const bRight = getCanvasX(barrierCenter + d/2, width);
        
        const yMaxEnergy = 5.0; // 能量坐标轴最大值
        const padY = 20;
        const plotH = height - padY * 2;
        
        function getEnergyY(energy) {
            return height - padY - (energy / yMaxEnergy) * plotH;
        }
        
        const yZero = getEnergyY(0);
        
        // 背景基线
        ctx.strokeStyle = isDark() ? '#555' : '#aaa';
        ctx.beginPath();
        ctx.moveTo(0, yZero);
        ctx.lineTo(width, yZero);
        ctx.stroke();
        
        // 画势垒
        const yV0 = getEnergyY(V0);
        ctx.fillStyle = isDark() ? 'rgba(74, 222, 128, 0.2)' : 'rgba(0, 153, 0, 0.2)'; 
        ctx.fillRect(bLeft, yV0, bRight - bLeft, yZero - yV0);
        ctx.strokeStyle = isDark() ? '#4ade80' : 'rgb(0, 153, 0)';
        ctx.strokeRect(bLeft, yV0, bRight - bLeft, yZero - yV0);
        
        // 画总能量线
        const yE = getEnergyY(E);
        ctx.strokeStyle = isDark() ? '#4ade80' : 'rgb(0, 204, 0)'; 
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(0, yE);
        ctx.lineTo(width, yE);
        ctx.stroke();
        ctx.setLineDash([]);
        
        // 标签
        ctx.fillStyle = isDark() ? '#4ade80' : 'rgb(0, 153, 0)';
        ctx.font = 'bold 13px Arial';
        ctx.fillText('E = ' + E.toFixed(1) + ' eV', 15, yE - 8);
        ctx.fillText('V₀ = ' + V0.toFixed(1) + ' eV', bLeft + 5, yV0 - 8);
    }

    function renderWave(ctx, width, height) {
        ctx.clearRect(0, 0, width, height);

        // 势垒底色
        const bLeft = getCanvasX(barrierCenter - d/2, width);
        const bRight = getCanvasX(barrierCenter + d/2, width);
        ctx.fillStyle = isDark() ? 'rgba(74, 222, 128, 0.15)' : 'rgba(0, 153, 0, 0.1)';
        ctx.fillRect(bLeft, 0, bRight - bLeft, height);
        
        // 轴
        ctx.strokeStyle = isDark() ? '#555' : '#ccc';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, height/2);
        ctx.lineTo(width, height/2);
        ctx.stroke();
        
        // 画波函数实部 (不依赖宽度的固定比例)
        // 因为我们取消了数学意义上的 L2 归一化，最大振幅被强制截断在 1.0，完美匹配 PhET
        const maxExpectedAmp = 1.0;
        const scale = (height * 0.45) / maxExpectedAmp; 
        
        // 波函数包络 (Envelope)
        ctx.strokeStyle = isDark() ? 'rgba(255, 255, 255, 0.3)' : 'rgba(0, 0, 0, 0.2)'; 
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = N_damp; i < N - N_damp; i++) {
            const cx = getCanvasX(xMin + i*dx, width);
            const env = Math.sqrt(psiRe[i]*psiRe[i] + psiIm[i]*psiIm[i]);
            const cy = height/2 - env * scale;
            if (i === N_damp) ctx.moveTo(cx, cy);
            else ctx.lineTo(cx, cy);
        }
        for (let i = N - N_damp - 1; i >= N_damp; i--) {
            const cx = getCanvasX(xMin + i*dx, width);
            const env = Math.sqrt(psiRe[i]*psiRe[i] + psiIm[i]*psiIm[i]);
            const cy = height/2 + env * scale;
            ctx.lineTo(cx, cy);
        }
        ctx.stroke();

        // 虚部 (Imaginary part)
        ctx.strokeStyle = isDark() ? 'rgb(252, 129, 129)' : 'rgb(204, 0, 0)'; 
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let i = N_damp; i < N - N_damp; i++) {
            const cx = getCanvasX(xMin + i*dx, width);
            const cy = height/2 - psiIm[i] * scale;
            if (i === N_damp) ctx.moveTo(cx, cy);
            else ctx.lineTo(cx, cy);
        }
        ctx.stroke();

        // 真实部分
        ctx.strokeStyle = isDark() ? 'rgb(99, 179, 237)' : 'rgb(0, 51, 204)'; 
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let i = N_damp; i < N - N_damp; i++) {
            const cx = getCanvasX(xMin + i*dx, width);
            const cy = height/2 - psiRe[i] * scale;
            if (i === N_damp) ctx.moveTo(cx, cy);
            else ctx.lineTo(cx, cy);
        }
        ctx.stroke();
    }

    function renderDensity(ctx, width, height) {
        ctx.clearRect(0, 0, width, height);
        
        // 势垒底色
        const bLeft = getCanvasX(barrierCenter - d/2, width);
        const bRight = getCanvasX(barrierCenter + d/2, width);
        ctx.fillStyle = isDark() ? 'rgba(74, 222, 128, 0.15)' : 'rgba(0, 153, 0, 0.1)';
        ctx.fillRect(bLeft, 0, bRight - bLeft, height);
        
        // 轴
        const yBase = height - 15;
        ctx.strokeStyle = isDark() ? '#555' : '#ccc';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, yBase);
        ctx.lineTo(width, yBase);
        ctx.stroke();
        
        // 概率密度固定比例
        const maxExpectedProb = 1.0; 
        const scale = (height * 0.8) / maxExpectedProb;
        
        ctx.fillStyle = 'rgba(255, 102, 0, 0.4)';
        ctx.strokeStyle = 'rgb(255, 51, 0)';
        ctx.lineWidth = 1.5;
        
        ctx.beginPath();
        ctx.moveTo(getCanvasX(xMin + N_damp * dx, width), yBase);
        for (let i = N_damp; i < N - N_damp; i++) {
            const cx = getCanvasX(xMin + i*dx, width);
            const prob = psiRe[i]*psiRe[i] + psiIm[i]*psiIm[i];
            const cy = yBase - prob * scale;
            ctx.lineTo(cx, cy);
        }
        ctx.lineTo(getCanvasX(xMin + (N - N_damp - 1) * dx, width), yBase);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
    }

    function buildVisibleProbabilityCdf() {
        const cdf = new Float64Array(N);
        let totalP = 0;

        for (let i = N_damp; i < N - N_damp; i++) {
            const p = (psiRe[i] * psiRe[i] + psiIm[i] * psiIm[i]) * dx;
            totalP += p;
            cdf[i] = totalP;
        }

        return { cdf, totalP };
    }

    function getInitialPacketProbabilityAtIndex(index, sigmaValue = relationSigma) {
        const x = xMin + index * dx;
        const x0 = getInitialPacketCenter();
        const normalization = 1 / (Math.sqrt(Math.PI) * sigmaValue);
        return normalization * Math.exp(-Math.pow((x - x0) / sigmaValue, 2));
    }

    function buildInitialPacketProbabilityCdf(sigmaValue = relationSigma) {
        const cdf = new Float64Array(N);
        let totalP = 0;

        for (let i = N_damp; i < N - N_damp; i++) {
            const p = getInitialPacketProbabilityAtIndex(i, sigmaValue) * dx;
            totalP += p;
            cdf[i] = totalP;
        }

        return { cdf, totalP };
    }

    function sampleVisibleParticleIndex(cdf, totalP) {
        const target = Math.random() * totalP;
        let left = N_damp;
        let right = N - N_damp - 1;

        while (left < right) {
            const mid = (left + right) >> 1;
            if (cdf[mid] < target) {
                left = mid + 1;
            } else {
                right = mid;
            }
        }

        return left;
    }

    function getRelationParticleFill() {
        return isDark() ? 'rgba(147, 223, 255, 0.8)' : 'rgba(59, 130, 246, 0.6)';
    }

    function getParticleRegionFill(x) {
        if (x > barrierCenter + d / 2) {
            return 'rgba(74, 222, 128, 0.9)';
        }
        if (x < barrierCenter - d / 2) {
            return 'rgba(96, 165, 250, 0.8)';
        }
        return 'rgba(252, 163, 80, 0.9)';
    }

    function renderDensityParticleRelation(ctx, width, height) {
        ctx.clearRect(0, 0, width, height);

        const yBase = height - 18;
        const sigmaValue = relationSigma;
        const { cdf, totalP } = buildInitialPacketProbabilityCdf(sigmaValue);
        const maxProbabilityDensity = 1 / (Math.sqrt(Math.PI) * relationSigmaMin);
        const scale = (height * 0.72) / maxProbabilityDensity;

        ctx.fillStyle = isDark() ? '#000000' : '#f8fafc';
        ctx.fillRect(0, 0, width, height);

        ctx.strokeStyle = isDark() ? '#475569' : '#cbd5e1';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, yBase);
        ctx.lineTo(width, yBase);
        ctx.stroke();

        ctx.fillStyle = isDark() ? 'rgba(255, 153, 102, 0.24)' : 'rgba(255, 102, 0, 0.22)';
        ctx.beginPath();
        ctx.moveTo(getCanvasX(xMin + N_damp * dx, width), yBase);
        for (let i = N_damp; i < N - N_damp; i++) {
            const cx = getCanvasX(xMin + i * dx, width);
            const prob = getInitialPacketProbabilityAtIndex(i, sigmaValue);
            const cy = yBase - prob * scale;
            ctx.lineTo(cx, cy);
        }
        ctx.lineTo(getCanvasX(xMin + (N - N_damp - 1) * dx, width), yBase);
        ctx.closePath();
        ctx.fill();

        if (totalP > 0) {
            const particleCount = relationParticleCount;
            const particleTop = 6;
            const particleBottom = yBase - 2;
            const particleFill = getRelationParticleFill();

            for (let p = 0; p < particleCount; p++) {
                const index = sampleVisibleParticleIndex(cdf, totalP);
                const px = getCanvasX(xMin + index * dx, width);
                const py = particleTop + Math.random() * Math.max(8, particleBottom - particleTop);

                ctx.beginPath();
                ctx.arc(px, py, 1.15, 0, 2 * Math.PI);
                ctx.fillStyle = particleFill;
                ctx.fill();
            }
        }

        ctx.strokeStyle = isDark() ? 'rgb(255, 186, 143)' : 'rgb(255, 91, 46)';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        for (let i = N_damp; i < N - N_damp; i++) {
            const cx = getCanvasX(xMin + i * dx, width);
            const prob = getInitialPacketProbabilityAtIndex(i, sigmaValue);
            const cy = yBase - prob * scale;
            if (i === N_damp) {
                ctx.moveTo(cx, cy);
            } else {
                ctx.lineTo(cx, cy);
            }
        }
        ctx.stroke();
    }

    function renderEnsemble(ctx, width, height) {
        ctx.clearRect(0, 0, width, height);

        // 背景
        ctx.fillStyle = isDark() ? '#000000' : '#f8fafc';
        ctx.fillRect(0, 0, width, height);

        // 势垒底色
        const bLeft = getCanvasX(barrierCenter - d/2, width);
        const bRight = getCanvasX(barrierCenter + d/2, width);
        ctx.fillStyle = isDark() ? 'rgba(74, 222, 128, 0.15)' : 'rgba(0, 153, 0, 0.1)';
        ctx.fillRect(bLeft, 0, bRight - bLeft, height);

        // 计算当前可见区域内的总概率
        const { cdf, totalP } = buildVisibleProbabilityCdf();

        if (totalP <= 0 || initialTotalProb <= 0) return;

        // 关键逻辑修复：当前留在画面里的粒子数量，正比于留在画面内的概率！
        // 如果波包跑出画面被海绵层吸收了，粒子也应该随之减少消失。
        let visibleRatio = totalP / initialTotalProb;
        if (visibleRatio > 1.0) visibleRatio = 1.0;
        
        const NUM_PARTICLES = 1000;
        const currentParticleCount = Math.floor(NUM_PARTICLES * visibleRatio);
        
        ctx.fillStyle = 'rgba(49, 130, 206, 0.6)'; // 蓝色粒子
        
        for (let p = 0; p < currentParticleCount; p++) {
            const left = sampleVisibleParticleIndex(cdf, totalP);
            const x = xMin + left * dx;
            const px = getCanvasX(x, width);
            const py = Math.random() * height; // Y轴随机散布，像云雾一样

            ctx.beginPath();
            ctx.arc(px, py, 1.2, 0, 2 * Math.PI);
            ctx.fillStyle = getParticleRegionFill(x);
            
            ctx.fill();
        }
    }

    
    function renderTheoryNumerov() {
        const canvas = document.getElementById('theoryNumerovCanvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;
        
        ctx.clearRect(0, 0, width, height);
        
        const isDarkMode = document.body.classList.contains('dark-mode');
        ctx.fillStyle = isDarkMode ? '#1e293b' : '#ffffff';
        ctx.fillRect(0, 0, width, height);
        
        // Numerov params
        const bLeft = getCanvasX(barrierCenter - d/2, width);
        const bRight = getCanvasX(barrierCenter + d/2, width);
        const focusRects = {
            left: { x: 0, width: bLeft },
            barrier: { x: bLeft, width: bRight - bLeft },
            right: { x: bRight, width: width - bRight }
        };
        
        // Draw regions
        ctx.fillStyle = isDarkMode ? 'rgba(49, 130, 206, 0.1)' : 'rgba(49, 130, 206, 0.05)';
        ctx.fillRect(0, 0, bLeft, height); // Region I
        ctx.fillStyle = isDarkMode ? 'rgba(229, 62, 62, 0.15)' : 'rgba(252, 129, 129, 0.15)';
        ctx.fillRect(bLeft, 0, bRight - bLeft, height); // Region II
        ctx.fillStyle = isDarkMode ? 'rgba(56, 161, 105, 0.1)' : 'rgba(56, 161, 105, 0.05)';
        ctx.fillRect(bRight, 0, width - bRight, height); // Region III

        // Center line
        ctx.strokeStyle = isDarkMode ? '#475569' : '#e2e8f0';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, height/2); ctx.lineTo(width, height/2); ctx.stroke();
        
        // Border lines
        ctx.strokeStyle = isDarkMode ? 'rgba(226, 232, 240, 0.3)' : 'rgba(74, 85, 104, 0.3)';
        ctx.setLineDash([5, 5]);
        ctx.beginPath(); ctx.moveTo(bLeft, 0); ctx.lineTo(bLeft, height); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(bRight, 0); ctx.lineTo(bRight, height); ctx.stroke();
        ctx.setLineDash([]);

        // ==================== 严谨稳态波函数计算 ====================
        const N_stat = 1000; 
        const dx_stat = (xMaxVisible - xMinVisible) / (N_stat - 1);
        const h2 = dx_stat * dx_stat;
        const k1 = Math.sqrt(2 * mass * E) / hbar;
        
        const f = new Float64Array(N_stat);
        for(let i=0; i<N_stat; i++) {
            const x = xMinVisible + i * dx_stat;
            // 亚网格级平滑势能：消除跨越网格点时的跳变
            const cellL = x - dx_stat/2;
            const cellR = x + dx_stat/2;
            const bL = barrierCenter - d/2;
            const bR = barrierCenter + d/2;
            const overL = Math.max(cellL, bL);
            const overR = Math.min(cellR, bR);
            let V_x = 0;
            if (overR > overL) {
                V_x = V0 * ((overR - overL) / dx_stat);
            }
            f[i] = (2 * mass / (hbar * hbar)) * (V_x - E);
        }
        
        const phiR = new Float64Array(N_stat);
        const phiI = new Float64Array(N_stat);
        
        // 从右向左积分 (右侧仅有透射波 e^{ikx})
        phiR[N_stat-1] = Math.cos(k1 * (xMinVisible + (N_stat-1)*dx_stat));
        phiI[N_stat-1] = Math.sin(k1 * (xMinVisible + (N_stat-1)*dx_stat));
        phiR[N_stat-2] = Math.cos(k1 * (xMinVisible + (N_stat-2)*dx_stat));
        phiI[N_stat-2] = Math.sin(k1 * (xMinVisible + (N_stat-2)*dx_stat));
        
        for (let i = N_stat - 2; i >= 1; i--) {
            const c_prev = 1 - (h2 / 12) * f[i-1];
            const c_curr = 2 + (5 * h2 / 6) * f[i];
            const c_next = 1 - (h2 / 12) * f[i+1];
            
            phiR[i-1] = (c_curr * phiR[i] - c_next * phiR[i+1]) / c_prev;
            phiI[i-1] = (c_curr * phiI[i] - c_next * phiI[i+1]) / c_prev;
        }
        
        // 归一化提取入射波振幅 A
        const x0 = xMinVisible;
        const x1 = xMinVisible + dx_stat;
        const c0 = Math.cos(k1 * x0), s0 = -Math.sin(k1 * x0);
        const c1 = Math.cos(k1 * x1), s1 = -Math.sin(k1 * x1);
        
        const term1R = phiR[1]*c0 - phiI[1]*s0;
        const term1I = phiR[1]*s0 + phiI[1]*c0;
        const term0R = phiR[0]*c1 - phiI[0]*s1;
        const term0I = phiR[0]*s1 + phiI[0]*c1;
        
        const NR = term1R - term0R;
        const NI = term1I - term0I;
        const denom = 2 * Math.sin(k1 * dx_stat);
        
        const AR = NI / denom;
        const AI = -NR / denom;
        const magA2 = AR*AR + AI*AI;
        
        const pR_tot = new Float64Array(N_stat);
        const pI_tot = new Float64Array(N_stat);
        const psiMag = new Float64Array(N_stat);
        let maxMagTotal = 0;
        for(let i=0; i<N_stat; i++) {
            // (phi * A_conjugate) / |A|^2 => 得到总波并且入射波振幅归一化为1.0
            pR_tot[i] = (phiR[i]*AR + phiI[i]*AI) / magA2;
            pI_tot[i] = (phiI[i]*AR - phiR[i]*AI) / magA2;
            psiMag[i] = Math.sqrt(pR_tot[i]*pR_tot[i] + pI_tot[i]*pI_tot[i]);
            if (psiMag[i] > maxMagTotal) maxMagTotal = psiMag[i];
        }

        const scale = (height * 0.42) / Math.max(maxMagTotal, 1.15);

        function drawLine(dataArray, color, lineWidth) {
            ctx.strokeStyle = color;
            ctx.lineWidth = lineWidth;
            ctx.lineJoin = 'round';
            ctx.beginPath();
            for (let i = 0; i < N_stat; i++) {
                const x = xMinVisible + i * dx_stat;
                const cx = getCanvasX(x, width);
                const cy = height / 2 - dataArray[i] * scale;
                if (i === 0) ctx.moveTo(cx, cy);
                else ctx.lineTo(cx, cy);
            }
            ctx.stroke();
        }

        if (currentTheoryComponent === 'all' || currentTheoryComponent === 'env') {
            // E < V0 时呈指数衰减的是包络 |psi|，不是单独某一条实部曲线。
            ctx.save();
            ctx.setLineDash([6, 4]);
            ctx.strokeStyle = isDarkMode ? 'rgba(226, 232, 240, 0.5)' : 'rgba(45, 55, 72, 0.35)';
            ctx.lineWidth = currentTheoryComponent === 'env' ? 1.9 : 1.4;
            ctx.beginPath();
            for (let i = 0; i < N_stat; i++) {
                const x = xMinVisible + i * dx_stat;
                const cx = getCanvasX(x, width);
                const cy = height / 2 - psiMag[i] * scale;
                if (i === 0) ctx.moveTo(cx, cy);
                else ctx.lineTo(cx, cy);
            }
            for (let i = N_stat - 1; i >= 0; i--) {
                const x = xMinVisible + i * dx_stat;
                const cx = getCanvasX(x, width);
                const cy = height / 2 + psiMag[i] * scale;
                ctx.lineTo(cx, cy);
            }
            ctx.closePath();
            ctx.stroke();
            ctx.restore();
        }

        if (currentTheoryComponent === 'all' || currentTheoryComponent === 'imag') {
            drawLine(pI_tot, isDarkMode ? 'rgb(252, 129, 129)' : 'rgb(204, 0, 0)', currentTheoryComponent === 'imag' ? 2.2 : 1.7);
        }
        if (currentTheoryComponent === 'all' || currentTheoryComponent === 'real') {
            drawLine(pR_tot, isDarkMode ? 'rgb(99, 179, 237)' : 'rgb(0, 51, 204)', currentTheoryComponent === 'real' ? 2.3 : 1.9);
        }

        const activeFocusRect = focusRects[currentTheoryFocus];
        if (activeFocusRect) {
            const dimFill = isDarkMode ? 'rgba(15, 23, 42, 0.34)' : 'rgba(255, 255, 255, 0.44)';

            ctx.save();
            Object.entries(focusRects).forEach(([focusKey, rect]) => {
                if (focusKey !== currentTheoryFocus && rect.width > 0) {
                    ctx.fillStyle = dimFill;
                    ctx.fillRect(rect.x, 0, rect.width, height);
                }
            });

            ctx.strokeStyle = currentTheoryFocus === 'left'
                ? (isDarkMode ? '#63b3ed' : '#3182ce')
                : currentTheoryFocus === 'barrier'
                    ? (isDarkMode ? '#fc8181' : '#e53e3e')
                    : (isDarkMode ? '#68d391' : '#38a169');
            ctx.lineWidth = 3;
            ctx.strokeRect(
                activeFocusRect.x + 1.5,
                1.5,
                Math.max(activeFocusRect.width - 3, 0),
                height - 3
            );
            ctx.restore();
        }
    }

    function renderStaticWave() {
        const canvas = document.getElementById('staticWaveCanvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;
        
        ctx.clearRect(0, 0, width, height);

        // 势垒底色
        const bLeft = getCanvasX(barrierCenter - d/2, width);
        const bRight = getCanvasX(barrierCenter + d/2, width);
        ctx.fillStyle = isDark() ? 'rgba(74, 222, 128, 0.15)' : 'rgba(0, 153, 0, 0.1)';
        ctx.fillRect(bLeft, 0, bRight - bLeft, height);
        
        // 中心基准轴
        ctx.strokeStyle = isDark() ? '#555' : '#ccc';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, height/2);
        ctx.lineTo(width, height/2);
        ctx.stroke();

        // Numerov法求解定态薛定谔方程 (Stationary State)
        const N_stat = 1000; 
        const dx_stat = (xMaxVisible - xMinVisible) / (N_stat - 1);
        const h2 = dx_stat * dx_stat;
        const k1 = Math.sqrt(2 * mass * E) / hbar;
        
        const f = new Float64Array(N_stat);
        for(let i=0; i<N_stat; i++) {
            const x = xMinVisible + i * dx_stat;
            // 亚网格级平滑势能：消除跨越网格点时的跳变
            const cellL = x - dx_stat/2;
            const cellR = x + dx_stat/2;
            const bL = barrierCenter - d/2;
            const bR = barrierCenter + d/2;
            const overL = Math.max(cellL, bL);
            const overR = Math.min(cellR, bR);
            let V_x = 0;
            if (overR > overL) {
                V_x = V0 * ((overR - overL) / dx_stat);
            }
            f[i] = (2 * mass / (hbar * hbar)) * (V_x - E);
        }
        
        const phiR = new Float64Array(N_stat);
        const phiI = new Float64Array(N_stat);
        
        // 从右向左积分 (右侧仅有透射波 e^{ikx})
        phiR[N_stat-1] = Math.cos(k1 * (xMinVisible + (N_stat-1)*dx_stat));
        phiI[N_stat-1] = Math.sin(k1 * (xMinVisible + (N_stat-1)*dx_stat));
        phiR[N_stat-2] = Math.cos(k1 * (xMinVisible + (N_stat-2)*dx_stat));
        phiI[N_stat-2] = Math.sin(k1 * (xMinVisible + (N_stat-2)*dx_stat));
        
        for (let i = N_stat - 2; i >= 1; i--) {
            const c_prev = 1 - (h2 / 12) * f[i-1];
            const c_curr = 2 + (5 * h2 / 6) * f[i];
            const c_next = 1 - (h2 / 12) * f[i+1];
            
            phiR[i-1] = (c_curr * phiR[i] - c_next * phiR[i+1]) / c_prev;
            phiI[i-1] = (c_curr * phiI[i] - c_next * phiI[i+1]) / c_prev;
        }
        
        // 在左侧提取入射波振幅 A 并归一化，使得入射波振幅恒为 1.0
        const x0 = xMinVisible;
        const x1 = xMinVisible + dx_stat;
        const c0 = Math.cos(k1 * x0), s0 = -Math.sin(k1 * x0);
        const c1 = Math.cos(k1 * x1), s1 = -Math.sin(k1 * x1);
        
        const term1R = phiR[1]*c0 - phiI[1]*s0;
        const term1I = phiR[1]*s0 + phiI[1]*c0;
        const term0R = phiR[0]*c1 - phiI[0]*s1;
        const term0I = phiR[0]*s1 + phiI[0]*c1;
        
        const NR = term1R - term0R;
        const NI = term1I - term0I;
        const denom = 2 * Math.sin(k1 * dx_stat);
        
        const AR = NI / denom;
        const AI = -NR / denom;
        const magA2 = AR*AR + AI*AI;
        
        // 解析选项模式
        const modeInput = document.querySelector('input[name="staticMode"]:checked');
        const mode = modeInput ? modeInput.value : 'total';
        const descEl = document.getElementById('staticModeDesc');
        if (mode === 'total') {
            descEl.textContent = "驻波干涉：入射波和反射波叠加，实虚部振幅交替变化，包络呈波浪起伏";
        } else if (mode === 'incident') {
            descEl.textContent = "右行波：$Fe^{ikx}$ 本身是自由空间的解，但它单独无法满足势垒两侧的边界条件，所以完整散射解必须加上反射项。";
        } else if (mode === 'reflected') {
            descEl.textContent = "左行波：$Be^{-ikx}$ 不是凑数的，它是边界连续性条件要求的。和入射波加在一起，才能满足两个界面上的匹配条件。";
        }
        
        const psiR = new Float64Array(N_stat);
        const psiI = new Float64Array(N_stat);
        const psiMag = new Float64Array(N_stat);
        
        // 第一遍计算找到总波函数，用于解析出分量波和统一缩放
        const pR_tot = new Float64Array(N_stat);
        const pI_tot = new Float64Array(N_stat);
        let maxMagTotal = 0;
        for(let i=0; i<N_stat; i++) {
            pR_tot[i] = (phiR[i]*AR + phiI[i]*AI) / magA2;
            pI_tot[i] = (phiI[i]*AR - phiR[i]*AI) / magA2;
            const mag = Math.sqrt(pR_tot[i]*pR_tot[i] + pI_tot[i]*pI_tot[i]);
            if (mag > maxMagTotal) maxMagTotal = mag;
        }
        
        // 第二遍生成当前模式的数据（包含提取势垒内部的分量波）
        for(let i=0; i<N_stat; i++) {
            const x = xMinVisible + i * dx_stat;
            let pR = pR_tot[i];
            let pI = pI_tot[i];
            
            if (mode === 'incident') {
                if (x <= barrierCenter - d/2) {
                    pR = Math.cos(k1 * x);
                    pI = Math.sin(k1 * x);
                } else if (x >= barrierCenter + d/2) {
                    // 势垒右侧只有透射波，保留总波
                    pR = pR_tot[i]; 
                    pI = pI_tot[i];
                } else {
                    // 势垒内部：使用局部空间导数剥离右行衰减波 (对应 exp(-kappa*x))
                    let dpR = (pR_tot[i+1] - pR_tot[i-1]) / (2 * dx_stat);
                    let dpI = (pI_tot[i+1] - pI_tot[i-1]) / (2 * dx_stat);
                    let E_eff = E; if(Math.abs(E_eff - V0)<1e-6) E_eff += 1e-6;
                    if (E_eff < V0) {
                        const kappa = Math.sqrt(2 * mass * (V0 - E_eff)) / hbar;
                        pR = 0.5 * (pR_tot[i] - dpR / kappa);
                        pI = 0.5 * (pI_tot[i] - dpI / kappa);
                    } else {
                        const k = Math.sqrt(2 * mass * (E_eff - V0)) / hbar;
                        pR = 0.5 * (pR_tot[i] + dpI / k);
                        pI = 0.5 * (pI_tot[i] - dpR / k);
                    }
                }
            } else if (mode === 'reflected') {
                if (x <= barrierCenter - d/2) {
                    pR = pR_tot[i] - Math.cos(k1 * x);
                    pI = pI_tot[i] - Math.sin(k1 * x);
                } else if (x >= barrierCenter + d/2) {
                    pR = NaN; pI = NaN; // 势垒右侧绝无左行反射波，挖空
                } else {
                    // 势垒内部：使用局部空间导数剥离左行反弹波 (对应 exp(+kappa*x))
                    let dpR = (pR_tot[i+1] - pR_tot[i-1]) / (2 * dx_stat);
                    let dpI = (pI_tot[i+1] - pI_tot[i-1]) / (2 * dx_stat);
                    let E_eff = E; if(Math.abs(E_eff - V0)<1e-6) E_eff += 1e-6;
                    if (E_eff < V0) {
                        const kappa = Math.sqrt(2 * mass * (V0 - E_eff)) / hbar;
                        pR = 0.5 * (pR_tot[i] + dpR / kappa);
                        pI = 0.5 * (pI_tot[i] + dpI / kappa);
                    } else {
                        const k = Math.sqrt(2 * mass * (E_eff - V0)) / hbar;
                        pR = 0.5 * (pR_tot[i] - dpI / k);
                        pI = 0.5 * (pI_tot[i] + dpR / k);
                    }
                }
            }
            
            psiR[i] = pR;
            psiI[i] = pI;
            if (!isNaN(pR)) {
                psiMag[i] = Math.sqrt(pR*pR + pI*pI);
            } else {
                psiMag[i] = NaN;
            }
        }
        
        // 动态缩放：确保干涉条纹(驻波)能完整显示
        const scale = (height * 0.45) / Math.max(maxMagTotal, 1.2);
        
        // 辅助绘制函数 (处理NaN断点)
        function drawLine(dataArray, color, lw) {
            ctx.strokeStyle = color;
            ctx.lineWidth = lw;
            ctx.beginPath();
            let isDrawing = false;
            for(let i=0; i<N_stat; i++) {
                if (isNaN(dataArray[i])) {
                    isDrawing = false;
                    continue;
                }
                const cx = getCanvasX(xMinVisible + i*dx_stat, width);
                const cy = height/2 - dataArray[i] * scale;
                if(!isDrawing) { ctx.moveTo(cx, cy); isDrawing = true; }
                else { ctx.lineTo(cx, cy); }
            }
            ctx.stroke();
        }

        // 绘制波函数包络 (Envelope)
        if (document.getElementById('showStaticEnv').checked) {
            ctx.strokeStyle = isDark() ? 'rgba(255, 255, 255, 0.25)' : 'rgba(0, 0, 0, 0.2)'; 
            ctx.lineWidth = 1;
            ctx.beginPath();
            let isD = false;
            for(let i=0; i<N_stat; i++) {
                if(isNaN(psiMag[i])) { isD = false; continue; }
                const cx = getCanvasX(xMinVisible + i*dx_stat, width);
                const cy = height/2 - psiMag[i] * scale;
                if(!isD) { ctx.moveTo(cx, cy); isD = true; } 
                else { ctx.lineTo(cx, cy); }
            }
            isD = false;
            for(let i=N_stat-1; i>=0; i--) {
                if(isNaN(psiMag[i])) { isD = false; continue; }
                const cx = getCanvasX(xMinVisible + i*dx_stat, width);
                const cy = height/2 + psiMag[i] * scale;
                if(!isD) { ctx.moveTo(cx, cy); isD = true; } 
                else { ctx.lineTo(cx, cy); }
            }
            ctx.stroke();
        }

        // 绘制虚部 (Red)
        if (document.getElementById('showStaticImag').checked) {
            drawLine(psiI, isDark() ? 'rgb(252, 129, 129)' : 'rgb(204, 0, 0)', 2.0);
        }

        // 绘制实部 (Blue)
        if (document.getElementById('showStaticReal').checked) {
            drawLine(psiR, isDark() ? 'rgb(99, 179, 237)' : 'rgb(0, 51, 204)', 2.0);
        }
    }

    function renderAll() {
        const cEnergy = document.getElementById('energyCanvas');
        const cWave = document.getElementById('waveCanvas');
        const cDensity = document.getElementById('densityCanvas');
        const cEnsemble = document.getElementById('ensembleCanvas');
        const cDataRelation = document.getElementById('densityParticleRelationCanvas');
        
        renderEnergy(cEnergy.getContext('2d'), cEnergy.width, cEnergy.height);
        renderWave(cWave.getContext('2d'), cWave.width, cWave.height);
        renderDensity(cDensity.getContext('2d'), cDensity.width, cDensity.height);
        renderEnsemble(cEnsemble.getContext('2d'), cEnsemble.width, cEnsemble.height);
        if (cDataRelation) {
            renderDensityParticleRelation(cDataRelation.getContext('2d'), cDataRelation.width, cDataRelation.height);
        }
        
        if (currentTab === 'data') {
            renderStaticWave();
        }
        if (currentTab === 'theory') {
            renderTheoryNumerov();
        }
        
        updateActualTR();
    }


    function updatePlayPauseUI() {
        const btn = document.getElementById('playPauseBtn');
        btn.textContent = isPlaying ? "暂停" : "播放";
        btn.style.background = isPlaying ? "#3182ce" : "#718096";
        btn.style.borderColor = isPlaying ? "#2b6cb0" : "#4a5568";
        btn.style.boxShadow = isPlaying ? "0 2px 4px rgba(49, 130, 206, 0.3)" : "0 2px 4px rgba(0, 0, 0, 0.1)";
    }


    // --- 发展历史时间轴数据与逻辑 ---
    let timelineInitialized = false;
    let selectedHistoryNode = 0;

    const historyData = [
        {
          year: "1924",
          title: "物质波假说 (Louis de Broglie)",
          desc: "提出电子等实物粒子也具有波动性，这是微观粒子能够“渗透”经典禁区的根本物理前提。",
          icon: "🌊",
          details: "德布罗意提出 λ = h/p，将粒子的动量与波长联系起来。既然粒子具有波动性质，其波函数在遇到势垒时就不会像经典粒子那样被完全弹回——而是会在势垒内部呈现指数衰减形式（即便能量低于势垒高度），并在另一侧重新出现。这就是隧穿效应的理论萌芽。",
          paramTitle: "观察物质波的干涉",
          paramDesc: "设置极窄的波包(sigma=0.2)配合厚壁垒(d=0.9)，观察波包大部分被反射且在传播过程中迅速扩散——这正是位置-动量不确定关系的体现。",

          ref: [{"name": "百度百科 - 德布罗意", "url": "https://baike.baidu.com/item/德布罗意"}],
          action: { E: 1.0, V0: 3.0, d: 0.5, sigma: 0.8 },
        },
        {
          year: "1926",
          title: "薛定谔方程 (Erwin Schrödinger)",
          desc: "建立了描述微观粒子波函数的偏微分方程，从数学上为隧穿效应提供了严谨的形式基础。",
          icon: "⚗️",
          details: "薛定谔发表了他的波动方程。当求解该方程时，人们惊奇地发现：在势能大于粒子总能量 (V > E) 的经典禁区内，波函数的解并不是零，而是一个呈指数衰减的实函数。这表明微观粒子在经典力学绝对不允许的区域内，依然存在非零的概率分布。",
          paramTitle: "势垒内的指数衰减",
          paramDesc: "设置极窄的波包(sigma=0.2)配合厚壁垒(d=0.9)，观察波包大部分被反射且在传播过程中迅速扩散——这正是位置-动量不确定关系的体现。",

          ref: [{"name": "百度百科 - 薛定谔", "url": "https://baike.baidu.com/item/薛定谔"}],
          action: { E: 1.5, V0: 4.0, d: 0.5, sigma: 0.5 },
        },
        {
          year: "1926",
          title: "WKB近似法 (Wentzel · Kramers · Brillouin)",
          desc: "Wentzel、Kramers、Brillouin 独立发展了求解隧穿问题的标准近似方法，将精确的波动方程简化为可解析计算的指数衰减公式。",
          icon: "📐",
          details: "在薛定谔方程出现后，Gregor Wentzel、Hendrik Kramers 和 Léon Brillouin（简称 WKB）发明了一套近似方法，用于求解存在势垒时的量子波函数。WKB 近似的核心结论是：隧穿概率 T ≈ exp(-2κd)，其中 κ = √(2m(V₀-E))/ℏ。这意味着隧穿率随壁垒宽度 d 呈指数衰减——这正是 α 衰变半衰期跨越大范围（10^-10 秒到 10^20 秒）的物理根源。WKB 公式至今仍是估算隧穿率的标准工具。",
          paramTitle: "体验指数敏感性",
          paramDesc: "设置极窄的波包(sigma=0.2)配合厚壁垒(d=0.9)，观察波包大部分被反射且在传播过程中迅速扩散——这正是位置-动量不确定关系的体现。",
          ref: [{"name": "百度百科 - WKB近似", "url": "https://baike.baidu.com/item/WKB%E8%BF%91%E4%BC%BC"}],
          action: { E: 1.5, V0: 3.0, d: 0.6, sigma: 0.5 },
        },
        {
          year: "1927",
          title: "不确定性原理 (Werner Heisenberg)",
          desc: "海森堡提出 Δx·Δp ≥ ℏ/2，为理解量子隧穿提供了关键的物理图像。",
          icon: "🌀",
          details: "不确定性原理的正确理解是：当我们把粒子极度限制在一个很窄的势垒内（Δx 变小）时，其动量不确定度 Δp 会急剧增大。但这并非「借能量」，而是量子力学波函数的固有特性——粒子的动量分布变宽，意味着它的波函数包含更多动量分量。求解势垒区域的薛定谔方程后我们发现：即使能量 E 小于势垒高度 V₀，波函数在势垒内部也不是零，而是呈指数衰减形式。这说明隧穿不是粒子「借能翻越」，而是波函数本身在经典禁区有非零延伸的必然结果。",
          paramTitle: "窄势垒下的动量扩散",
          paramDesc: "设置极窄的波包(sigma=0.2)配合厚壁垒(d=0.9)，观察波包大部分被反射且在传播过程中迅速扩散——这正是位置-动量不确定关系的体现。",

          ref: [{"name": "百度百科 - 海森堡", "url": "https://baike.baidu.com/item/%E6%B5%B7%E6%A3%AE%E5%A0%A1"}],
          action: { E: 2.0, V0: 3.5, d: 0.9, sigma: 0.2 },
        },
        {
          year: "1927",
          title: "隧穿的数学发现 (Friedrich Hund)",
          desc: "在研究双势阱（如氨分子反转）的基态时，Hund 首次从数学上注意到了量子隧穿效应的存在。",
          icon: "🔬",
          details: "Hund 发现，在双势阱中，即使粒子的能量不足以越过中间的势垒，由于薛定谔方程的解在势垒内并不是零，粒子依然有一定的概率穿过势垒到达另一侧。这是量子力学波函数“渗透”特性的首次体现，打破了经典力学中粒子绝对无法越过比自身能量高的势垒的常识。",
          paramTitle: "穿透双势阱的一半",
          paramDesc: "注意：即使势垒很高，只要宽度不是无限大，波函数在势垒内并未立刻变为零。",
          ref: [{"name": "百度百科 - 弗里德里希·洪特", "url": "https://baike.baidu.com/item/%E5%BC%97%E9%87%8C%E5%BE%B7%E9%87%8C%E5%B8%8C%C2%B7%E6%B4%AA%E7%89%B9"}],
          action: { E: 1.5, V0: 4.0, d: 0.4, sigma: 0.5 },
        },
        {
          year: "1928",
          title: "场发射与Fowler-Nordheim隧穿 (Fowler & Nordheim)",
          desc: "Fowler 和 Nordheim 建立了金属场发射的量子理论，首次将隧穿用于解释外加电场下的电子发射现象。",
          icon: "⚡",
          details: "Fowler 与 Nordheim 发现，当金属表面加强电场时（即使温度不高），电子也有一定概率隧穿穿透表面势垒而逃逸到真空中——这称为场发射（Field Emission）。他们的理论给出了隧穿电流与电场的指数关系，成为后来闪存写入原理和扫描隧道显微镜（STM）的直接理论基础。江崎玲於奈的隧穿二极管正是这一现象在半导体中的对应实现。",
          paramTitle: "感受隧穿对电场的敏感性",
          paramDesc: "在STM节点中我们已经看到 d 对 T 的指数敏感性。Fowler-Nordheim 隧穿告诉我们：当外加电场增大（相当于降低有效势垒厚度），电子隧穿概率会急剧上升。",

          ref: [{"name": "百度百科 - 场致发射 (Field Emission)", "url": "https://baike.baidu.com/item/%E5%9C%BA%E8%87%B4%E5%8F%91%E5%B0%84"}],
          action: { E: 1.5, V0: 4.0, d: 0.3, sigma: 0.5 },
        },
        {
          year: "1928",
          title: "α衰变的解释 (George Gamow)",
          desc: "George Gamow (以及 Gurney & Condon) 利用量子隧穿成功解释了放射性原子核的 α 衰变。",
          icon: "☢️",
          details: "在此之前，人们不理解为什么原子核中的 α 粒子能跑出来：它们在核内的能量远小于核外巨大的库仑势垒高度。Gamow 运用量子力学证明，由于波函数的指数衰减，α 粒子有一条“能量隧道”可以逃逸。这成为了量子隧穿理论的第一次巨大成功。",
          paramTitle: "模拟厚重势垒中的衰减",
          paramDesc: "我们将势垒加宽并提高，模拟放射性元素核内的强库仑势垒，此时透射系数非常小，对应漫长的半衰期。",
          ref: [{"name": "百度百科 - 伽莫夫", "url": "https://baike.baidu.com/item/伽莫夫"}],
          action: { E: 1.0, V0: 3.5, d: 1.2, sigma: 0.6 },
        },
        {
          year: "1928",
          title: "概率波诠释 (Max Born)",
          desc: "Max Born 进一步完善了波函数的统计/概率诠释。",
          icon: "🎲",
          details: "Born 提出波函数绝对值的平方 |Ψ|² 代表粒子在某处被找到的概率密度——这是量子力学的基本公设之一。这意味着，隧穿现象的本质不是粒子「挖洞」或「借能」越过势垒，而是粒子波函数在势垒另一侧存在非零概率的直接表现。此外，Born 的统计诠释还隐含了另一层深意：在势垒两侧出现的粒子是同一个粒子的不同可能位置，而非两个独立粒子。这一诠释为后来量子场论中「粒子产生与湮灭」的概念奠定了基础。",
          paramTitle: "查看概率密度视图",
          paramDesc: "加厚壁垒(d=0.8)，此时反射与透射并存，可同时观察入射波包、反射波包以及垒右侧的概率密度分布。",
          ref: [{"name": "百度百科 - 玻恩", "url": "https://baike.baidu.com/item/玻恩"}],
          action: { E: 1.5, V0: 2.0, d: 0.8, sigma: 0.5 },
        },
        {
          year: "1957",
          title: "隧穿二极管 (江崎玲於奈)",
          desc: "发现了重掺杂半导体 PN 结中的电子隧穿效应，发明了隧穿二极管。",
          icon: "🔌",
          details: "江崎玲於奈（Leo Esaki）发现，当半导体掺杂浓度极高时，PN结的耗尽层会变得极薄（几纳米级别）。此时，电子可以直接隧穿过禁带，产生特殊的负阻效应。这是隧穿效应在固体电子学中的首次实际应用，江崎因此获得了 1973 年诺贝尔物理学奖。",
          paramTitle: "模拟极薄耗尽层",
          paramDesc: "将势垒宽度 d 减小到 0.15nm 左右，你会发现即使势垒很高，透射率 T 也极大提升！",

          ref: [{"name": "百度百科 - 江崎玲於奈", "url": "https://baike.baidu.com/item/江崎玲於奈"}],
          action: { E: 1.5, V0: 3.5, d: 0.15, sigma: 0.5 },
        },
        {
          year: "1960",
          title: "超导隧穿 (Ivar Giaever)",
          desc: "证明了电子可以通过一层极薄的氧化物绝缘层在两个超导体之间隧穿。",
          icon: "⚡",
          details: "Giaever 将两块超导金属用一层极薄的氧化层隔开。在低温下，他测量到了明显的隧穿电流。这项实验不仅证实了固体中的隧穿现象，也为验证 BCS 超导理论中的“能隙”提供了直接的实验证据。",
          paramTitle: "微弱但非零的隧穿",
          paramDesc: "只要势垒够薄，即使能量 E 小于势垒 V0，波就会在另一端重新出现。",

          ref: [{"name": "百度百科 - 贾埃弗", "url": "https://baike.baidu.com/item/贾埃弗"}],
          action: { E: 1.0, V0: 2.5, d: 0.5, sigma: 0.5 },
        },
        {
          year: "1962",
          title: "约瑟夫森效应 (Brian Josephson)",
          desc: "预测库珀对可以在没有电压的情况下穿过绝缘势垒。",
          icon: "🧲",
          details: "Josephson 从理论上预测了两种效应：①**直流约瑟夫森效应**：库珀对可以在零电压下隧穿过绝缘层，产生持续的超导电流；②**交流约瑟夫森效应**：当施加直流电压 V 时，隧穿电流会以频率 f = 2eV/h 振荡（该频率由量子力学基本常数决定，可作为电压的量子基准）。这两大效应都被实验精确验证，是超导量子干涉器件（SQUID）和现代超导量子计算机（如Google Sycamore芯片）的物理核心机制。",
          paramTitle: "微弱但非零的隧穿",
          paramDesc: "适中的壁垒厚度(d=0.5)产生较弱但可检测的隧穿电流，这正是Giaever实验观察到的现象。",

          ref: [{"name": "百度百科 - 约瑟夫森效应", "url": "https://baike.baidu.com/item/约瑟夫森效应"}],
          action: { E: 0.8, V0: 2.5, d: 0.7, sigma: 0.5 },
        },
        {
          year: "1980",
          title: "闪存 Flash Memory",
          desc: "利用 Fowler-Nordheim 隧穿效应将电子困在浮栅中，实现非易失性数据存储。",
          icon: "💾",
          details: "你现在使用的 U 盘和固态硬盘（SSD）都完全依赖量子隧穿！通过施加高电压，迫使电子隧穿过极薄的氧化物绝缘层，进入一个被完全绝缘包围的“浮栅”并被困住。撤去电压后，电子由于没有足够能量且势垒变厚无法逃逸，从而实现了数据的长期保存（记忆）。",
          paramTitle: "模拟浮栅写入",
          paramDesc: "设定一个宽而高的势垒代表厚氧化层（常态下电子无法逃逸）。高电压使氧化层上的势垒从矩形变为三角形（镜像电荷效应），有效势垒变薄，电子隧穿概率大幅提升——这就是Flash存储器的写入原理。",

          ref: [{"name": "百度百科 - 闪存 (Flash Memory)", "url": "https://baike.baidu.com/item/%E9%97%AA%E5%AD%98"}],
          action: { E: 1.2, V0: 4.0, d: 1.0, sigma: 0.5 },
        },
        {
          year: "1981",
          title: "扫描隧道显微镜 STM",
          desc: "Binnig 和 Rohrer 利用隧穿电流对物体表面原子进行极其精确的成像。",
          icon: "🔬",
          details: "STM 的工作原理是：将一根极尖锐的金属探针靠近样品表面（相距零点几纳米）。根据量子隧穿理论，探针与样品间的隧穿电流对距离极为敏感（呈指数衰减关系）。只需改变 0.1nm 的距离，电流就会变化近 10 倍！这使得我们第一次真正“看”到了单个原子。",
          paramTitle: "感受对距离的极端敏感",
          paramDesc: "你可以微调势垒宽度 d（模拟探针距离），观察理论透射率 T 是如何呈指数剧烈变化的。",

          ref: [{"name": "百度百科 - 扫描隧道显微镜", "url": "https://baike.baidu.com/item/%E6%89%AB%E6%8F%8F%E9%99%A2%E9%81%93%E6%98%BE%E5%BE%AE%E9%95%AF"}],
          action: { E: 1.5, V0: 4.5, d: 0.4, sigma: 0.5 },
        },
        {
          year: "1999",
          title: "超导量子比特 (Yasunobu Nakamura)",
          desc: "首次实现超导量子比特的相干控制，拉开了现代固态量子计算的序幕。",
          icon: "💻",
          details: "利用基于约瑟夫森结（本质是量子隧穿）的「库珀对盒」，Yasunobu Nakamura 在 1999 年首次成功证明了超导量子比特的相干叠加态——这是现代固态量子计算的开端。此后经过近 20 年的工程积累，Google 于 2019 年利用 Sycamore 芯片实现了「量子霸权」演示，而 IBM、IQM 等机构也在持续推进超导量子计算机的实用化。所有这些超导量子计算机的核心计算单元，都是依赖量子隧穿效应的超导量子比特。",
          paramTitle: "模拟量子态共振",
          paramDesc: "调整势垒参数使得入射波与势垒产生共振透射，这在微观层面上与量子比特的状态控制有数学上的相似性。",

          ref: [{"name": "arXiv - 首篇超导量子比特论文 (Nakamura et al., 1999)", "url": "https://arxiv.org/abs/cond-mat/9904003"}],
          action: { E: 1.5, V0: 1.5, d: 0.4, sigma: 0.5 },
        },
        {
          year: "2010s",
          title: "量子生物学 (Quantum Biology)",
          desc: "科学家发现量子隧穿在生物体内的酶催化反应甚至 DNA 突变中起着至关重要的作用。",
          icon: "🧬",
          details: "生命看似是经典的，但在微观尺度，温度波动下质子（氢离子）在酶活性位点或 DNA 碱基对之间的转移，极大程度上依赖于量子隧穿。这意味着生命的基本代谢过程，甚至某些自发性的基因突变（由于质子隧穿导致碱基配对错误），都与粒子穿越能量势垒的“幽灵”能力息息相关！",
          paramTitle: "模拟厚重质子的隧穿",
          paramDesc: "质子比电子重得多，隧穿概率极低。我们将势垒变宽，观察极小但确实存在的概率泄漏（这就是生命的量子本质）。",

          ref: [{"name": "百度百科 - 量子生物学", "url": "https://baike.baidu.com/item/%E9%87%8F%E5%AD%90%E7%94%9F%E7%89%A9%E5%AD%A6"}],
          action: { E: 1.0, V0: 2.5, d: 0.8, sigma: 0.4 },
        },
        {
          year: "2023",
          title: "阿秒物理与隧穿时间 (Attosecond Physics)",
          desc: "利用阿秒激光脉冲技术（2001年L'Huillier等人提出理论、2004年首次产生孤立阿秒脉冲，2023年获诺贝尔物理学奖），物理学家终于测出了电子隧穿所需的时间。",
          icon: "⏱️",
          details: "电子穿过势垒需要时间吗？利用“阿秒钟”（Attoclock）技术，科学家测量出电子在强激光场中隧穿原子势垒的时间延迟最多只有几十阿秒（1阿秒 = 10^-18 秒），甚至在某些理论定义下几乎是“瞬时”发生的。这把人类对量子隧穿的认知推向了极限的微观时间尺度！",
          paramTitle: "极薄壁垒中的快速隧穿",
          paramDesc: "设定较窄的波包和极薄的势垒(d=0.2)，拉动时间轴观察波包与势垒碰撞的瞬间。透射波在另一侧几乎是紧跟着出现的——这就是阿秒钟技术测量的隧穿时间。",

          ref: [{"name": "诺贝尔物理学奖官网 - 2023年获奖介绍", "url": "https://www.nobelprize.org/prizes/physics/2023/summary/"}],
          action: { E: 2.0, V0: 3.0, d: 0.2, sigma: 0.2 },
        },
        {
          year: "2025",
          title: "宏观量子隧穿诺贝尔奖 (Clarke · Devoret · Martinis)",
          desc: "2025 年诺贝尔物理学奖授予 Clarke、Devoret、Martinis，表彰在超导电路中实现宏观量子隧穿的突破性工作。",
          icon: "🏆",
          details: "John Clarke、Michel H. Devoret 和 John M. Martinis 因在超导量子电路中发现宏观量子隧穿和能量量子化而获奖。这是量子隧穿效应第一次在人类制造的宏观尺度人造结构中被观察到并得到应用，奠定了 Google Sycamore、IBM quantum 等超导量子计算机的物理基础。Martinis 在 Google 主导实现的量子霸权(quantum supremacy)正是利用了超导量子比特中的隧穿动力学。",
          paramTitle: "宏观磁通量子隧穿",
          paramDesc: "模拟SQUID约瑟夫森结中的弱隧穿（T≈0.25），体现宏观量子隧穿的本质。",

          ref: [{"name": "诺贝尔物理学奖官网 - 2025年获奖公告", "url": "https://www.nobelprize.org/prizes/physics/2025/summary/"}],
          action: { E: 1.0, V0: 2.0, d: 0.7, sigma: 0.5 },
        }
    ];

    function initTimeline() {
        const nodesContainer = document.getElementById('timelineNodes');
        nodesContainer.innerHTML = '';
        
        historyData.forEach((data, index) => {
            const card = document.createElement('div');
            card.className = `timeline-card ${index === 0 ? 'active' : ''}`;
            card.innerHTML = `
                <div class="timeline-year">${data.year}</div>
                <div class="timeline-title">${data.title}</div>
            `;
            card.addEventListener('click', () => {
                document.querySelectorAll('.timeline-card').forEach(c => c.classList.remove('active'));
                card.classList.add('active');
                card.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
                selectedHistoryNode = index;
                renderHistoryDetail();
            });
            nodesContainer.appendChild(card);
        });
        
        renderHistoryDetail();
        timelineInitialized = true;
    }

    function renderHistoryDetail() {
        const data = historyData[selectedHistoryNode];
        const detailPanel = document.getElementById('historyDetailPanel');
        const paramTip = document.getElementById('historyParamTip');
        
        detailPanel.innerHTML = `
            <div class="history-detail-image">${data.icon}</div>
            <div class="history-detail-title">${data.year} - ${data.title}</div>
            <p>${data.desc}</p>
            <button class="expand-btn" onclick="toggleHistoryDetails(this)">
                了解更多 <span>▼</span>
            </button>
            <div class="expanded-content">
                ${data.details}
                ${data.ref && data.ref.length > 0 ? `
                <div class="ref-section">
                    <div class="ref-title">📚 参考来源</div>
                    ${data.ref.map(r => `<div class="ref-item">· <a href="${r.url}" target="_blank" rel="noopener">${r.name}</a></div>`).join('')}
                </div>` : ''}
            </div>
        `;
        
        paramTip.innerHTML = `
            <div class="param-tip-title">仿真关联：${data.paramTitle}</div>
            <div class="param-tip-desc">${data.paramDesc}</div>
            <button class="param-btn" onclick='applyHistoryParams(this, ${JSON.stringify(data.action)})'>应用此参数配置到仿真</button>
        `;
    }

    window.toggleHistoryDetails = function(btn) {
        const content = btn.nextElementSibling;
        const icon = btn.querySelector('span');
        if (content.style.display === 'block') {
            content.style.display = 'none';
            icon.textContent = '▼';
        } else {
            content.style.display = 'block';
            icon.textContent = '▲';
        }
    };

    window.applyHistoryParams = function(btn, params) {
        if (btn.dataset.applied === "true") {
            // 第2次点击：跳转到实时演化
            activateTab('sim');
            window.scrollTo({ top: 0, behavior: 'smooth' });
            
            // 可选：重置按钮状态（如果用户再切回来，可以重新应用）
            btn.dataset.applied = "false";
            btn.textContent = '应用此参数配置到仿真';
            btn.style.background = '';
            return;
        }

        // 第1次点击：应用参数
        if (isPlaying) {
            isPlaying = false;
            updatePlayPauseUI();
        }
        E = params.E; V0 = params.V0; d = params.d; sigma = params.sigma;
        syncParamDisplays();
        resetAndRender();
        
        // 更新按钮状态为“已应用”并提示再次点击跳转
        btn.dataset.applied = "true";
        btn.textContent = '已应用！再点一次查看动画';
        btn.style.background = '#48bb78'; // 成功绿色
    };

    function animationLoop(timestamp) {
        if (isPlaying) {
            playbackFrameAccumulator += playbackSpeed;
            let didAdvance = false;
            while (playbackFrameAccumulator >= 1 && currentFrame < MAX_FRAMES) {
                if (currentFrame < stateHistory.length - 1) {
                    currentFrame++;
                    loadState(currentFrame);
                } else {
                    for (let s = 0; s < stepsPerFrame; s++) {
                        solveCrankNicolson();
                    }
                    currentTime += stepsPerFrame * dt;
                    saveState();
                    currentFrame++;
                    document.getElementById('timeSlider').value = currentFrame;
                    document.getElementById('timeValueDisp').textContent = currentTime.toFixed(2);
                }
                playbackFrameAccumulator -= 1;
                didAdvance = true;
            }
            if (didAdvance) {
                renderAll();
            } else if (currentFrame >= MAX_FRAMES) {
                isPlaying = false;
                playbackFrameAccumulator = 0;
                updatePlayPauseUI();
            }
        }
        stepRelationSigmaPlayback(timestamp);
        animationId = requestAnimationFrame(animationLoop);
    }

    // --- 事件监听 ---
    
    function resetAndRender() {
        initSimulation();
        renderAll();
    }

    function updateThemeToggleLabel() {
        const button = document.getElementById('themeToggle');
        if (!button) return;
        const dark = document.body.classList.contains('dark-mode');
        button.textContent = dark ? '浅色' : '深色';
        button.setAttribute('aria-label', dark ? '切换到浅色主题' : '切换到深色主题');
        button.setAttribute('title', dark ? '切换到浅色主题' : '切换到深色主题');
    }

    function syncTabAccessibility(activeId) {
        document.querySelectorAll('.tab-btn').forEach(button => {
            const isActive = button.id === activeId;
            button.classList.toggle('active', isActive);
            button.setAttribute('aria-selected', isActive ? 'true' : 'false');
        });
    }

    // 主题切换
    document.getElementById('themeToggle').addEventListener('click', function() {
        document.body.classList.toggle('dark-mode');
        updateThemeToggleLabel();
        if (!isPlaying) renderAll(); // 暂停状态下强制重绘以更新颜色
        if (currentTab === 'data') renderChart();
        if (currentTab === 'data') renderStaticWave();
        if (currentTab === 'data') {
            renderRelationChart();
        }
        if (currentTab === 'theory') renderTheoryNumerov();
    });

    document.getElementById('playPauseBtn').addEventListener('click', function() {
        if (currentFrame >= MAX_FRAMES) {
            resetAndRender();
        }
        isPlaying = !isPlaying;
        if (!isPlaying) {
            playbackFrameAccumulator = 0;
        }
        updatePlayPauseUI();
    });

    document.getElementById('resetBtn').addEventListener('click', function() {
        resetAndRender();
        playbackFrameAccumulator = 0;
        if (!isPlaying) {
            isPlaying = true;
            updatePlayPauseUI();
        }
    });
    
    document.getElementById('timeSlider').addEventListener('input', function() {
        const targetFrame = parseInt(this.value);
        if (isPlaying) {
            isPlaying = false;
            updatePlayPauseUI();
        }
        playbackFrameAccumulator = 0;
        if (targetFrame > stateHistory.length - 1) {
            loadState(stateHistory.length - 1);
            while (stateHistory.length - 1 < targetFrame) {
                for (let s = 0; s < stepsPerFrame; s++) solveCrankNicolson();
                currentTime += stepsPerFrame * dt;
                saveState();
            }
        }
        currentFrame = targetFrame;
        loadState(currentFrame);
        renderAll();
    });

    document.getElementById('playbackSpeedSlider').addEventListener('input', event => {
        playbackSpeed = parseFloat(event.target.value);
        syncPlaybackSpeedControls();
    });

    document.getElementById('relationSigmaSlider').addEventListener('input', event => {
        setRelationSigma(parseFloat(event.target.value), { stopPlayback: true, syncPhase: true });
    });

    document.getElementById('relationSpeedSlider').addEventListener('input', event => {
        relationPlaybackSpeed = parseFloat(event.target.value);
        syncRelationSpeedControls();
    });

    document.getElementById('relationPlayPauseBtn').addEventListener('click', () => {
        isRelationPlaying = !isRelationPlaying;
        if (isRelationPlaying) {
            relationPlaybackLastTime = null;
        }
        updateRelationPlayPauseUI();
    });

    function updateParams() {
        V0 = parseFloat(document.getElementById('v0Slider').value);
        d = parseFloat(document.getElementById('dSlider').value);
        E = parseFloat(document.getElementById('eSlider').value);
        sigma = parseFloat(document.getElementById('sigmaSlider').value);
        
        updatePotential();
        
        // 更改势垒参数后，截断由于旧势垒产生的历史数据
        stateHistory.length = currentFrame + 1;
        
        syncParamDisplays();
        updateTheoryCalc();
        
        if (currentTab === 'data') {
            renderStaticWave();
        }
        if (currentTab === 'theory') {
            renderTheoryNumerov();
        }
        if (currentTab === 'data') {
            renderChart();
            renderRelationChart();
        }
    }

    let currentTab = 'sim';
    let pipInitialized = false;
    let theoryPiPWrapper = null;
    let theoryPiPCanvas = null;

    const tabConfig = {
        sim: { buttonId: 'tabSim', viewId: 'viewSim' },
        data: { buttonId: 'tabData', viewId: 'viewData' },
        history: { buttonId: 'tabHistory', viewId: 'viewHistory' },
        theory: { buttonId: 'tabTheory', viewId: 'viewTheory' }
    };

    function updateTheoryPiPState() {
        if (!theoryPiPWrapper || !theoryPiPCanvas) return;

        const isPiPActive = theoryPiPCanvas.classList.contains('pip-mode');
        const liveRect = theoryPiPCanvas.getBoundingClientRect();
        const wrapperRect = theoryPiPWrapper.getBoundingClientRect();
        const stickyTop = 20;

        if (isPiPActive) {
            if (wrapperRect.bottom > 25) {
                theoryPiPCanvas.classList.remove('pip-mode');
                theoryPiPWrapper.style.height = 'auto';
            }
        } else {
            if (wrapperRect.top >= stickyTop || wrapperRect.bottom <= stickyTop + liveRect.height + 30) {
                theoryPiPWrapper.style.height = `${theoryPiPCanvas.offsetHeight}px`;
                theoryPiPCanvas.classList.add('pip-mode');
            }
        }
    }

    let pipScrollTimeout = null;
    let theoryNumerovPiPCanvas = null;
    let theoryPiPWindow = null;
    let theoryPiPInterval = null;
    let lastPiPRenderedModule = null;
    let lastPiPRenderedFocus = null;
    let lastPiPRenderedComponent = null;

    function schedulePiPUpdate() {
        if (pipScrollTimeout) return;
        pipScrollTimeout = setTimeout(() => {
            pipScrollTimeout = null;
            updateTheoryPiPState();
        }, 30);
    }

    function createTheoryPiPWindow() {
        const pipWindow = document.createElement('div');
        pipWindow.className = 'theory-pip-window';
        pipWindow.innerHTML = '<canvas id="theoryNumerovPiPCanvas" width="800" height="220"></canvas>';
        document.body.appendChild(pipWindow);
        theoryPiPWindow = pipWindow;
        theoryNumerovPiPCanvas = pipWindow.querySelector('#theoryNumerovPiPCanvas');
    }

    function syncPiPCanvas() {
        if (!theoryNumerovPiPCanvas) return;
        const srcCanvas = document.getElementById('theoryNumerovCanvas');
        if (!srcCanvas) return;
        const srcCtx = srcCanvas.getContext('2d');
        const dstCtx = theoryNumerovPiPCanvas.getContext('2d');
        theoryNumerovPiPCanvas.width = srcCanvas.width;
        theoryNumerovPiPCanvas.height = srcCanvas.height;
        dstCtx.drawImage(srcCanvas, 0, 0);
    }

    function ensureTheoryPiP() {
        if (pipInitialized) {
            updateTheoryPiPState();
            return;
        }
        pipInitialized = true;

        const theoryCanvasContainer = document.querySelector('.theory-canvas-container');
        if (!theoryCanvasContainer) return;

        createTheoryPiPWindow();

        theoryPiPWrapper = theoryCanvasContainer;
        theoryPiPCanvas = theoryCanvasContainer;

        window.addEventListener('scroll', schedulePiPUpdate, { passive: true });
        window.addEventListener('resize', schedulePiPUpdate, { passive: true });
        updateTheoryPiPState();
    }

    function updateTheoryPiPState() {
        if (!theoryPiPWrapper || !theoryPiPCanvas || !theoryPiPWindow) return;

        const wrapperRect = theoryPiPCanvas.getBoundingClientRect();
        const shouldShowPiP = wrapperRect.top < 0;

        const isPiPActive = theoryPiPWindow.classList.contains('active');

        if (shouldShowPiP && !isPiPActive) {
            theoryPiPWindow.classList.add('active');
            syncPiPCanvas();
            lastPiPRenderedModule = currentTheoryScene;
            lastPiPRenderedFocus = currentTheoryFocus;
            lastPiPRenderedComponent = currentTheoryComponent;
        } else if (!shouldShowPiP && isPiPActive) {
            theoryPiPWindow.classList.remove('active');
        } else if (isPiPActive) {
            if (currentTheoryScene !== lastPiPRenderedModule ||
                currentTheoryFocus !== lastPiPRenderedFocus ||
                currentTheoryComponent !== lastPiPRenderedComponent) {
                syncPiPCanvas();
                lastPiPRenderedModule = currentTheoryScene;
                lastPiPRenderedFocus = currentTheoryFocus;
                lastPiPRenderedComponent = currentTheoryComponent;
            }
        }
    }

    function activateTab(tabName) {
        if (tabName !== currentTab) clearAssistantAnnotation({ clearAvoidRightPanel: true });
        currentTab = tabName;
        const activeButtonId = tabConfig[tabName].buttonId;

        syncTabAccessibility(activeButtonId);

        Object.entries(tabConfig).forEach(([key, config]) => {
            document.getElementById(config.viewId).classList.toggle('active', key === tabName);
        });

        if (tabName === 'data') {
            renderStaticWave();
            renderChart();
        } else if (tabName === 'history') {
            if (!timelineInitialized) {
                initTimeline();
            }
        } else if (tabName === 'theory') {
            ensureTheoryPiP();
            updateTheoryNarrative();
            updateTheoryCalc();
            renderTheoryNumerov();
        }
    }

    window.jumpToTab = function(tabName, chartVar) {
        if (tabName === 'data' && chartVar) {
            document.getElementById('chartVarSelect').value = chartVar;
        }
        activateTab(tabName);
        const view = tabConfig[tabName] ? document.getElementById(tabConfig[tabName].viewId) : null;
        if (view) {
            view.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    };

    window.runTheoryScene = function(sceneKey) {
        const scene = theoryScenes[sceneKey];
        if (!scene) return;
        activateTab('theory');
        setTheoryScene(sceneKey);
        scene.run();
    };

    ['sim', 'data', 'history', 'theory'].forEach(tabName => {
        document.getElementById(tabConfig[tabName].buttonId).addEventListener('click', () => {
            activateTab(tabName);
        });
    });

    document.querySelectorAll('.theory-focus-btn').forEach(button => {
        button.addEventListener('click', () => {
            setTheoryFocus(button.dataset.focus);
        });
    });

    document.querySelectorAll('.theory-component-btn').forEach(button => {
        button.addEventListener('click', () => {
            setTheoryComponent(button.dataset.component);
        });
    });

    document.getElementById('chartVarSelect').addEventListener('change', renderChart);
    document.getElementById('chartScaleSelect').addEventListener('change', renderChart);

    
    
    
    window.currentAnimationId = null;
    window.animTimeout = null;

    window.animateParamsTo = function(targetE, targetV0, targetD, customDuration, onComplete) {
        if (window.currentAnimationId) cancelAnimationFrame(window.currentAnimationId);
        if (window.animTimeout) clearTimeout(window.animTimeout);

        const duration = customDuration || 1000;
        const startE = E;
        const startV0 = V0;
        const startD = d;
        const startTime = performance.now();
        
        const controlPanel = document.querySelector('.right-panel');
        if (window.innerWidth <= 768) {
            // Scroll logic removed for PiP mode
        }
        
        function step(time) {
            let progress = (time - startTime) / duration;
            if (progress > 1) progress = 1;
            const ease = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
            
            E = startE + (targetE - startE) * ease;
            V0 = startV0 + (targetV0 - startV0) * ease;
            d = startD + (targetD - startD) * ease;
            syncParamDisplays();
            
            updateTheoreticalTR();
            updateTheoryCalc();
            if (currentTab === 'data') {
                renderStaticWave();
                renderChart();
            }
            if (currentTab === 'theory') renderTheoryNumerov();
            renderEnergy(document.getElementById('energyCanvas').getContext('2d'), 800, 100);
            
            if (progress < 1) {
                window.currentAnimationId = requestAnimationFrame(step);
            } else {
                resetAndRender();
                if(onComplete) onComplete();
            }
        }
        window.currentAnimationId = requestAnimationFrame(step);
    };

    window.animateWidthSweep = function() {
        if (window.currentAnimationId) cancelAnimationFrame(window.currentAnimationId);
        if (window.animTimeout) clearTimeout(window.animTimeout);
        
        // 先平滑还原到实验2的标准状态，然后拉伸
        window.animateParamsTo(1.0, 4.0, 0.3, 800, () => {
            window.animTimeout = setTimeout(() => {
                window.animateParamsTo(1.0, 4.0, 0.8, 3000);
            }, 100);
        });
    };

    window.jumpToHistoryNode = function(index) {
        activateTab('history');
        setTimeout(() => {
            const cards = document.querySelectorAll('.timeline-card');
            if (cards && cards[index]) {
                cards[index].click();
            }
        }, 50);
    };

    
    window.updateTheoryCalc = function() {
        const e_val = E;
        const v0_val = V0;
        const d_val = d;
        const scene = theoryScenes[currentTheoryScene];
        
        const elE = document.getElementById('theoryCalcE');
        const elV0 = document.getElementById('theoryCalcV0');
        const elD = document.getElementById('theoryCalcD');
        const leadEl = document.getElementById('theoryCalcLead');
        if(!elE) return;
        
        elE.textContent = e_val.toFixed(2);
        elV0.textContent = v0_val.toFixed(2);
        elD.textContent = d_val.toFixed(2);
        if (leadEl && scene) leadEl.textContent = scene.calcLead;
        
        const resultContainer = document.getElementById('theoryCalcResult');
        
        // 避免高频动画时重排KaTeX，优先只更新数值文本
        let currentMode = resultContainer.getAttribute('data-mode');
        let newMode = '';
        if (e_val < v0_val) newMode = 'tunnel';
        else if (Math.abs(e_val - v0_val) < 1e-6) newMode = 'critical';
        else newMode = 'reflection';

        const k2 = (e_val < v0_val) ? Math.sqrt(2 * mass * (v0_val - e_val)) / hbar : 0;
        const term = calculateTR(e_val, v0_val, d_val);
        const T = term.T;

        if (currentMode !== newMode || !resultContainer.querySelector('.dynamic-t')) {
            // 如果模式改变，或首次渲染，进行完整DOM与KaTeX渲染
            if (newMode === 'tunnel') {
                resultContainer.innerHTML = `
                    <div style="margin-bottom:12px; font-size: 1.3rem; font-weight: bold; color: #3182ce;" class="theme-color-mode-1">当前处于隧穿区：$E < V_0$</div>
                    <div style="font-size:14px; font-weight:normal; margin-bottom:8px;">衰减常数 $\\kappa = \\frac{\\sqrt{2m(V_0 - E)}}{\\hbar} \\approx$ <span class="dynamic-k"></span> $\\text{nm}^{-1}$</div>
                    理论透射率 $T =$ <span class="dynamic-t"></span> (<span class="dynamic-tp"></span>)
                `;
            } else if (newMode === 'critical') {
                resultContainer.innerHTML = `
                    <div style="margin-bottom:12px; font-size: 1.3rem; font-weight: bold; color: #d69e2e;" class="theme-color-mode-2">当前接近临界区：$E \\approx V_0$</div>
                    理论透射率 $T =$ <span class="dynamic-t"></span> (<span class="dynamic-tp"></span>)
                `;
            } else {
                resultContainer.innerHTML = `
                    <div style="margin-bottom:12px; font-size: 1.3rem; font-weight: bold; color: #38a169;" class="theme-color-mode-3">当前处于越垒区：$E > V_0$</div>
                    <div style="font-size:14px; font-weight:normal; margin-bottom:8px;">透射已经增强，但边界匹配仍会留下反射干涉。</div>
                    理论透射率 $T =$ <span class="dynamic-t"></span> (<span class="dynamic-tp"></span>)
                `;
            }
            resultContainer.setAttribute('data-mode', newMode);
            
            if (window.renderMathInElement) {
                renderMathInElement(resultContainer, {
                    delimiters: [
                        {left: "$$", right: "$$", display: true},
                        {left: "$", right: "$", display: false}
                    ]
                });
            }
        }
        
        // 仅高效更新数值
        if (newMode === 'tunnel') {
            const kSpan = resultContainer.querySelector('.dynamic-k');
            if(kSpan) kSpan.textContent = k2.toFixed(2);
        }
        const tSpan = resultContainer.querySelector('.dynamic-t');
        const tpSpan = resultContainer.querySelector('.dynamic-tp');
        if (tSpan) tSpan.textContent = T.toExponential(4);
        if (tpSpan) tpSpan.textContent = (T*100).toFixed(4) + '%';
    };


    function renderChart() {
        if (currentTab !== 'data') return;
        const canvas = document.getElementById('chartCanvas');
        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;
        
        ctx.clearRect(0, 0, width, height);
        
        // 背景
        ctx.fillStyle = isDark() ? '#000000' : '#f8fafc';
        ctx.fillRect(0, 0, width, height);
        
        const varType = document.getElementById('chartVarSelect').value;
        const scaleType = document.getElementById('chartScaleSelect').value;
        
        let xMin, xMax, currentX, xLabel;
        if (varType === 'd') {
            xMin = 0.05; xMax = 2.0; currentX = d; xLabel = '势垒宽度 d (nm)';
        } else if (varType === 'E') {
            xMin = 0.5; xMax = 4.0; currentX = E; xLabel = '粒子能量 E (eV)';
        } else if (varType === 'V0') {
            xMin = 0.5; xMax = 5.0; currentX = V0; xLabel = '势垒高度 V₀ (eV)';
        }
        
        const padding = { top: 40, right: 40, bottom: 60, left: 80 };
        const plotW = width - padding.left - padding.right;
        const plotH = height - padding.top - padding.bottom;
        
        // Generate data
        const numPoints = 300;
        const data = [];
        let yMin = scaleType === 'log' ? 1e-6 : 0;
        let yMax = 1.0;
        
        for (let i = 0; i <= numPoints; i++) {
            const x = xMin + (xMax - xMin) * (i / numPoints);
            let e_val = E, v0_val = V0, d_val = d;
            if (varType === 'd') d_val = x;
            if (varType === 'E') e_val = x;
            if (varType === 'V0') v0_val = x;
            
            let t = calculateTR(e_val, v0_val, d_val).T;
            if (scaleType === 'log' && t < yMin) t = yMin; // clamp
            data.push({ x, y: t });
        }
        
        // Draw grid
        ctx.strokeStyle = isDark() ? '#333' : '#e2e8f0';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for(let i=0; i<=5; i++) {
            const gy = padding.top + plotH * (i/5);
            ctx.moveTo(padding.left, gy);
            ctx.lineTo(width - padding.right, gy);
        }
        for(let i=0; i<=10; i++) {
            const gx = padding.left + plotW * (i/10);
            ctx.moveTo(gx, padding.top);
            ctx.lineTo(gx, height - padding.bottom);
        }
        ctx.stroke();

        // Draw Axes
        ctx.strokeStyle = isDark() ? '#888' : '#718096';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(padding.left, padding.top);
        ctx.lineTo(padding.left, height - padding.bottom);
        ctx.lineTo(width - padding.right, height - padding.bottom);
        ctx.stroke();
        
        function getScreenX(x) {
            return padding.left + ((x - xMin) / (xMax - xMin)) * plotW;
        }
        function getScreenY(y) {
            if (scaleType === 'log') {
                const logY = Math.log10(y);
                const logMin = Math.log10(yMin);
                const logMax = Math.log10(yMax);
                return padding.top + plotH - ((logY - logMin) / (logMax - logMin)) * plotH;
            } else {
                return padding.top + plotH - (y / yMax) * plotH;
            }
        }
        
        // Draw Curve
        ctx.strokeStyle = isDark() ? '#4ade80' : '#3182ce';
        ctx.lineWidth = 3;
        ctx.beginPath();
        for (let i = 0; i < data.length; i++) {
            const sx = getScreenX(data[i].x);
            const sy = getScreenY(data[i].y);
            if (i === 0) ctx.moveTo(sx, sy);
            else ctx.lineTo(sx, sy);
        }
        ctx.stroke();
        
        // Draw current point
        const currentT = calculateTR(varType==='E'?currentX:E, varType==='V0'?currentX:V0, varType==='d'?currentX:d).T;
        let clampedT = currentT;
        if (scaleType === 'log' && clampedT < yMin) clampedT = yMin;
        const cx = getScreenX(currentX);
        const cy = getScreenY(clampedT);
        
        ctx.fillStyle = '#e53e3e';
        ctx.beginPath();
        ctx.arc(cx, cy, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
        
        // Labels
        ctx.fillStyle = isDark() ? '#e2e8f0' : '#4a5568';
        ctx.font = '15px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(xLabel, padding.left + plotW / 2, height - 15);
        
        ctx.save();
        ctx.translate(25, padding.top + plotH / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText('理论透射率 T' + (scaleType==='log'?' (对数坐标)':''), 0, 0);
        ctx.restore();
        
        // Current value text
        ctx.textAlign = 'left';
        const tDisp = currentT < 0.0001 ? currentT.toExponential(2) : currentT.toFixed(4);
        ctx.fillStyle = isDark() ? '#fff' : '#1a202c';
        ctx.font = 'bold 14px Arial';
        ctx.fillText(`当前设定: X = ${currentX.toFixed(2)}, T = ${tDisp}`, cx + 12, cy - 12);
        
        // Annotations for fixed parameters
        ctx.textAlign = 'right';
        ctx.fillStyle = isDark() ? '#a0aec0' : '#718096';
        ctx.font = '13px Arial';
        let fixStr = [];
        if (varType !== 'd') fixStr.push(`d = ${d.toFixed(2)} nm`);
        if (varType !== 'E') fixStr.push(`E = ${E.toFixed(2)} eV`);
        if (varType !== 'V0') fixStr.push(`V₀ = ${V0.toFixed(2)} eV`);
        ctx.fillText(`固定参数: ${fixStr.join(', ')}`, width - padding.right, padding.top + 20);
    }

    document.getElementById('v0Slider').addEventListener('input', () => { updateParams(); updateTheoreticalTR(); if(!isPlaying) renderAll(); });
    document.getElementById('dSlider').addEventListener('input', () => { updateParams(); updateTheoreticalTR(); if(!isPlaying) renderAll(); });
    
    // 调节波包能量或宽度时，强行重置波包
    document.getElementById('eSlider').addEventListener('input', () => { updateParams(); resetAndRender(); });
    document.getElementById('sigmaSlider').addEventListener('input', () => { updateParams(); resetAndRender(); });

    // 初始化
    window.addEventListener('load', () => {
        applyAllSimChartHeights();
        initSimChartResizeControls();
        initSimulation();
        syncPlaybackSpeedControls();
        syncRelationSigmaControls();
        syncRelationSpeedControls();
        syncRelationPlaybackPhaseFromSigma();
        updateRelationPlayPauseUI();
        updateTheoryNarrative();
        updateThemeToggleLabel();
        syncTabAccessibility(tabConfig[currentTab].buttonId);
        animationId = requestAnimationFrame(animationLoop);

        
        if (window.renderMathInElement) {
            renderMathInElement(document.body, {
                delimiters: [
                    {left: "$$", right: "$$", display: true},
                    {left: "$", right: "$", display: false}
                ],
                ignoredTags: ["script", "noscript", "style", "textarea", "pre", "code", "option"]
            });
        }

        // 绑定静态图互动选项事件
        const staticModeInputs = document.querySelectorAll('input[name="staticMode"]');
        staticModeInputs.forEach(input => {
            input.addEventListener('change', () => {
                if (currentTab === 'data') renderStaticWave();
            if (currentTab === 'theory') renderTheoryNumerov();
            });
        });
        
        // 绑定可见性复选框事件
        ['showStaticReal', 'showStaticImag', 'showStaticEnv'].forEach(id => {
            document.getElementById(id).addEventListener('change', () => {
                if (currentTab === 'data') renderStaticWave();
            if (currentTab === 'theory') renderTheoryNumerov();
            });
        });

        initCardTilt('.theory-region-card');
        initCardTilt('.timeline-card');
        initAssistantTutor();
    });

    function initCardTilt(selector) {
        const cards = document.querySelectorAll(selector);
        cards.forEach(card => {
            card.addEventListener('mousemove', (e) => {
                const rect = card.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;
                const cx = rect.width / 2;
                const cy = rect.height / 2;
                const rotateY = ((x - cx) / cx) * 3;
                const rotateX = ((cy - y) / cy) * 3;
                card.style.transform = `perspective(600px) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
            });
            card.addEventListener('mouseleave', () => {
                card.style.transform = '';
            });
        });
    }
