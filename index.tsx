import { GoogleGenAI } from "@google/genai";

// ─── Application State ────────────────────────────────────────────────────────
const appState = {
    currentView: 'upload-view',
    mode: 'karaoke' as 'karaoke' | 'board',
    songTitle: '',
    files: {
        images: [] as File[],
        audioVocal: null as File | null,
        audioBacking: null as File | null,
        pdf: null as File | null
    },
    audioUrl: null as string | null,
    pages: [] as { image: HTMLImageElement, width: number, height: number, symbols: any[], sequence: number[] }[],
    currentPageIndex: 0,
    symbols: [] as any[],
    isRecordingSync: false,
    currentSyncIndex: 0,
    syncData: [] as { symbolIndex: number, time: number }[],
    audioBuffer: null as AudioBuffer | null,
    stats: { avgDuration: 0 },
    gridConfig: {
        rowBreakThreshold: 50,
        colBreakThreshold: 10,
        minSymbolWidth: 20,
        minSymbolHeight: 20,
        contentThreshold: 240
    },
    styleConfig: {
        backgroundColor: '#f0f8ff',
        activeScale: 1.1,
        nextCount: 2,
        nextScale: 0.7,
        nextOpacity: 0.7,
        spacing: 200,
        prevScale: 0.7,
        prevOpacity: 0.4
    },
    interaction: {
        isDragging: false,
        dragStart: { x: 0, y: 0 },
        selectedIndices: new Set<number>(),
        initialSelection: new Set<number>(),
        dragAction: 'none',
        zoomLevel: 1.0,
        marqueeStart: { x: 0, y: 0 },
        marqueeCurrent: { x: 0, y: 0 },
        timelineZoom: 100,
        timelineDragIndex: -1,
        selectedSyncIndex: -1,
        syncScrollX: 0,
        lastTouchDistance: 0,
        latencyOffset: 0.0
    },
    preview: {
        isPlaying: false,
        animationId: 0,
        startTime: 0,
        loadedImages: new Map<number, HTMLImageElement>()
    }
};

let dom = {} as any;

// ─── Toast Notification System ───────────────────────────────────────────────
function showToast(msg: string, type: 'success' | 'error' | 'warning' | '' = '', duration = 3400) {
    const container = document.getElementById('toast-container');
    if (!container) { console.warn('[Toast]', msg); return; }
    const el = document.createElement('div');
    el.className = `toast${type ? ' ' + type : ''}`;
    el.textContent = msg;
    container.appendChild(el);
    setTimeout(() => {
        el.style.animation = 'toastOut 0.3s cubic-bezier(0.4,0,0.2,1) forwards';
        setTimeout(() => el.remove(), 320);
    }, duration);
}

// ─── Step Progress Indicator ─────────────────────────────────────────────────
const VIEW_STEP_MAP: Record<string, number> = {
    'upload-view': 1,
    'define-symbols-view': 2,
    'order-view': 3,
    'sync-view': 4,
    'result-view': 5
};

function updateStepProgress(activeStep: number) {
    for (let i = 1; i <= 5; i++) {
        const circle = document.getElementById(`step-${i}`);
        const conn   = i > 1 ? document.getElementById(`conn-${i - 1}-${i}`) : null;
        if (!circle) continue;
        circle.classList.remove('active', 'done');
        if (conn) conn.classList.remove('done');
        if (i < activeStep) {
            circle.classList.add('done');
            if (conn) conn.classList.add('done');
        } else if (i === activeStep) {
            circle.classList.add('active');
        }
    }
}

// ─── Init ─────────────────────────────────────────────────────────────────────
function init() {
    dom = {
        views: {
            upload:  document.getElementById('upload-view'),
            loading: document.getElementById('loading-view'),
            define:  document.getElementById('define-symbols-view'),
            order:   document.getElementById('order-view'),
            sync:    document.getElementById('sync-view'),
            result:  document.getElementById('result-view'),
        },
        upload: {
            dropZone:       document.getElementById('unified-drop-zone'),
            input:          document.getElementById('unified-file-input'),
            btnBrowse:      document.querySelector('.browse-btn'),
            btnGenerate:    document.getElementById('generate-button'),
            btnCreateBoard: document.getElementById('btn-create-board'),
            statusSongboard: document.getElementById('status-songboard'),
            statusVocal:     document.getElementById('status-vocal'),
            statusBacking:   document.getElementById('status-backing'),
            cardSongboard:   document.getElementById('card-songboard'),
            cardVocal:       document.getElementById('card-vocal'),
            cardBacking:     document.getElementById('card-backing'),
            titleInput:      document.getElementById('input-song-title')
        },
        define: {
            canvasContainer:  document.getElementById('define-canvas-container'),
            canvas:           document.getElementById('define-canvas') as HTMLCanvasElement,
            ctx:              (document.getElementById('define-canvas') as HTMLCanvasElement)?.getContext('2d'),
            btnPrev:          document.getElementById('btn-prev-page'),
            btnNext:          document.getElementById('btn-next-page'),
            labelPage:        document.getElementById('page-indicator'),
            btnClear:         document.getElementById('btn-clear-page'),
            btnAuto:          document.getElementById('btn-autocomplete-grid'),
            btnSelectColor:   document.getElementById('btn-select-matching-color'),
            btnGoOrder:       document.getElementById('btn-goto-order'),
            btnZoomIn:        document.getElementById('btn-zoom-in'),
            btnZoomOut:       document.getElementById('btn-zoom-out'),
            btnDelete:        document.getElementById('btn-delete-symbol'),
            inputSensitivity: document.getElementById('grid-sensitivity'),
            labelSensitivity: document.getElementById('grid-sensitivity-val'),
            btnPanUp:         document.getElementById('btn-pan-up'),
            btnPanDown:       document.getElementById('btn-pan-down'),
            karaokeTools:     document.getElementById('karaoke-tools'),
            boardTools:       document.getElementById('board-tools'),
            btnAddTile:       document.getElementById('btn-add-tile'),
            btnDownloadPdf:   document.getElementById('btn-download-pdf'),
            btnDownloadZip:   document.getElementById('btn-download-zip'),
            // AI Creator
            aiPrompt:         document.getElementById('ai-prompt'),
            btnAiGenerate:    document.getElementById('btn-ai-generate'),
            btnAiEdit:        document.getElementById('btn-ai-edit'),
            btnUploadSymbol:  document.getElementById('btn-upload-symbol'),
            inputUploadSymbol: document.getElementById('input-upload-symbol'),
            btnPixelScan:     document.getElementById('btn-pixel-scan'),
            aiLoading:        document.getElementById('ai-loading'),
            aiMultiToggle:    document.getElementById('ai-multi-toggle')
        },
        order: {
            canvasContainer:  document.getElementById('order-canvas-container'),
            canvas:           document.getElementById('order-canvas') as HTMLCanvasElement,
            ctx:              (document.getElementById('order-canvas') as HTMLCanvasElement)?.getContext('2d'),
            btnPrev:          document.getElementById('btn-order-prev-page'),
            btnNext:          document.getElementById('btn-order-next-page'),
            labelPage:        document.getElementById('order-page-indicator'),
            btnAuto:          document.getElementById('btn-auto-order'),
            btnUndo:          document.getElementById('btn-order-undo'),
            btnReset:         document.getElementById('btn-reset-order'),
            btnBack:          document.getElementById('btn-back-to-define'),
            btnFinish:        document.getElementById('btn-finish-order'),
            btnPanUp:         document.getElementById('btn-order-pan-up'),
            btnPanDown:       document.getElementById('btn-order-pan-down'),
            seqBar:           document.getElementById('order-sequence-bar'),
            seqLabel:         document.getElementById('order-seq-label'),
            audio:            document.getElementById('order-audio-player') as HTMLAudioElement
        },
        sync: {
            containerFineTuning: document.getElementById('sync-fine-tuning'),
            visualCue:           document.getElementById('sync-visual-cue'),
            timelineContainer:   document.getElementById('sync-timeline-container'),
            timelineCanvas:      document.getElementById('sync-timeline-canvas') as HTMLCanvasElement,
            btnRecord:           document.getElementById('record-tap-button'),
            audio:               document.getElementById('sync-audio-player') as HTMLAudioElement,
            labelProgress:       document.getElementById('sync-progress-text'),
            btnReset:            document.getElementById('reset-sync-button'),
            btnBack:             document.getElementById('back-to-order-from-sync'),
            btnFinish:           document.getElementById('btn-finish-sync'),
            btnZoomIn:           document.getElementById('btn-sync-zoom-in'),
            btnZoomOut:          document.getElementById('btn-sync-zoom-out'),
            btnAutoSync:         document.getElementById('btn-auto-sync'),
            imgCurrent:          document.getElementById('sync-img-current') as HTMLImageElement,
            imgNext:             document.getElementById('sync-img-next')    as HTMLImageElement,
            navStrip:            document.getElementById('symbol-nav-strip'),
            btnTlPrev:           document.getElementById('btn-tl-prev'),
            btnTlNext:           document.getElementById('btn-tl-next'),
            btnNudgeLBack:       document.getElementById('btn-tl-nudge-l-back'),
            btnNudgeSBack:       document.getElementById('btn-tl-nudge-s-back'),
            btnNudgeSFwd:        document.getElementById('btn-tl-nudge-s-fwd'),
            btnNudgeLFwd:        document.getElementById('btn-tl-nudge-l-fwd'),
            labelTlSelected:     document.getElementById('tl-selected-info'),
            containerProp:       document.getElementById('sync-symbol-properties'),
            inputDirection:      document.getElementById('input-sync-direction')
        },
        result: {
            canvas:           document.getElementById('preview-canvas') as HTMLCanvasElement,
            btnPlay:          document.getElementById('btn-play-preview'),
            btnPause:         document.getElementById('btn-pause-preview'),
            btnRewind:        document.getElementById('btn-rewind-preview'),
            btnDownloadFull:  document.getElementById('download-full-mix'),
            btnDownloadBacking: document.getElementById('download-backing'),
            btnBack:          document.getElementById('back-to-sync-from-result'),
            btnReset:         document.getElementById('reset-button'),
            latencySlider:    document.getElementById('latency-slider'),
            latencyVal:       document.getElementById('latency-val'),
            styleBg:          document.getElementById('style-bg-color'),
            styleActiveScale: document.getElementById('style-active-scale'),
            styleNextCount:   document.getElementById('style-next-count'),
            styleNextScale:   document.getElementById('style-next-scale'),
            styleNextOpacity: document.getElementById('style-next-opacity'),
            styleSpacing:     document.getElementById('style-spacing')
        },
        rendering: {
            overlay:      document.getElementById('rendering-overlay'),
            progressText: document.getElementById('rendering-progress-text')
        },
        loadingMessage: document.getElementById('loading-message'),
        errorBox:       document.getElementById('error-box')
    };

    setupEventListeners();
}

// ─── Event Listeners ──────────────────────────────────────────────────────────
function setupEventListeners() {
    // Upload View
    dom.upload.dropZone.addEventListener('click', (e: Event) => {
        if (e.target !== dom.upload.input) dom.upload.input.click();
    });
    dom.upload.dropZone.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); dom.upload.input.click(); }
    });
    dom.upload.btnBrowse.addEventListener('click', (e: Event) => {
        e.stopPropagation();
        dom.upload.input.click();
    });
    dom.upload.input.addEventListener('change', (e: Event) => handleFiles((e.target as HTMLInputElement).files));
    dom.upload.dropZone.addEventListener('dragover',  (e: DragEvent) => { e.preventDefault(); dom.upload.dropZone.classList.add('drag-over'); });
    dom.upload.dropZone.addEventListener('dragleave', (e: DragEvent) => { e.preventDefault(); dom.upload.dropZone.classList.remove('drag-over'); });
    dom.upload.dropZone.addEventListener('drop', (e: DragEvent) => {
        e.preventDefault();
        dom.upload.dropZone.classList.remove('drag-over');
        handleFiles(e.dataTransfer?.files);
    });
    dom.upload.titleInput.addEventListener('input', (e: Event) => {
        appState.songTitle = (e.target as HTMLInputElement).value;
    });
    dom.upload.btnGenerate.addEventListener('click', startProject);
    dom.upload.btnCreateBoard.addEventListener('click', startBoardMode);

    // Audio card swap logic
    const handleAudioCardClick = (type: 'vocal' | 'backing') => {
        const cardType  = type === 'vocal' ? dom.upload.cardVocal   : dom.upload.cardBacking;
        const cardOther = type === 'vocal' ? dom.upload.cardBacking  : dom.upload.cardVocal;

        if (cardType.classList.contains('selected')) {
            cardType.classList.remove('selected');
        } else if (cardOther.classList.contains('selected')) {
            // Swap
            const temp = appState.files.audioVocal;
            appState.files.audioVocal   = appState.files.audioBacking;
            appState.files.audioBacking = temp;

            dom.upload.statusVocal.textContent   = appState.files.audioVocal   ? appState.files.audioVocal.name   : 'No audio loaded';
            dom.upload.statusBacking.textContent = appState.files.audioBacking ? appState.files.audioBacking.name : 'No audio loaded';
            dom.upload.cardVocal.classList.toggle('filled',   !!appState.files.audioVocal);
            dom.upload.cardBacking.classList.toggle('filled', !!appState.files.audioBacking);
            cardOther.classList.remove('selected');
            showToast('Audio tracks swapped ↔', 'success');
        } else {
            cardType.classList.add('selected');
        }
    };
    dom.upload.cardVocal.addEventListener('click',   () => handleAudioCardClick('vocal'));
    dom.upload.cardBacking.addEventListener('click', () => handleAudioCardClick('backing'));

    // Define View
    dom.define.btnPrev.addEventListener('click', () => changePage(-1));
    dom.define.btnNext.addEventListener('click', () => changePage(1));
    dom.define.btnAuto.addEventListener('click', runAiGridDetection);
    dom.define.btnPixelScan.addEventListener('click', () => { runGridDetection(); showToast('Pixel scan complete'); });
    dom.define.btnClear.addEventListener('click', clearCurrentPageSymbols);
    dom.define.btnGoOrder.addEventListener('click', () => switchView('order-view'));
    dom.define.btnSelectColor.addEventListener('click', selectSimilarColors);
    dom.define.btnZoomIn.addEventListener('click',  () => changeZoom(0.1));
    dom.define.btnZoomOut.addEventListener('click', () => changeZoom(-0.1));
    dom.define.btnDelete.addEventListener('click', deleteSelectedSymbols);
    dom.define.inputSensitivity.addEventListener('input', (e: Event) => {
        const val = parseInt((e.target as HTMLInputElement).value);
        appState.gridConfig.contentThreshold = val;
        dom.define.labelSensitivity.textContent =
            val > 245 ? 'Very High' : val > 230 ? 'High' : val > 200 ? 'Medium' : 'Low';
        runGridDetection();
    });
    dom.define.btnPanUp.addEventListener('click',   () => dom.define.canvasContainer.scrollBy({ top: -100, behavior: 'smooth' }));
    dom.define.btnPanDown.addEventListener('click', () => dom.define.canvasContainer.scrollBy({ top:  100, behavior: 'smooth' }));

    // Board mode
    dom.define.btnAddTile.addEventListener('click',     addEmptyTile);
    dom.define.btnDownloadPdf.addEventListener('click', downloadBoardPdf);
    dom.define.btnDownloadZip.addEventListener('click', downloadBoardImages);

    // AI Creator
    dom.define.btnAiGenerate.addEventListener('click', generateAiSymbol);
    dom.define.btnAiEdit.addEventListener('click',     editAiSymbol);
    dom.define.btnUploadSymbol.addEventListener('click', () => dom.define.inputUploadSymbol.click());
    dom.define.inputUploadSymbol.addEventListener('change', (e: Event) =>
        handleSymbolUpload((e.target as HTMLInputElement).files));

    // AI Chips
    const chipsContainer = document.getElementById('ai-prompt-chips');
    if (chipsContainer) {
        chipsContainer.querySelectorAll('.chip').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const text = (e.target as HTMLElement).textContent?.trim() || '';
                (dom.define.aiPrompt as HTMLTextAreaElement).value = text;
                (dom.define.aiPrompt as HTMLTextAreaElement).focus();
            });
        });
    }

    // Order View
    dom.order.btnPrev.addEventListener('click',   () => { changePage(-1); setupOrderView(); });
    dom.order.btnNext.addEventListener('click',   () => { changePage(1);  setupOrderView(); });
    dom.order.btnAuto.addEventListener('click',   autoOrderPage);
    dom.order.btnUndo.addEventListener('click',   undoLastOrderSymbol);
    dom.order.btnReset.addEventListener('click',  resetOrderPage);
    dom.order.btnBack.addEventListener('click',   () => switchView('define-symbols-view'));
    dom.order.btnFinish.addEventListener('click', finishOrderingSymbols);
    dom.order.btnPanUp.addEventListener('click',   () => dom.order.canvasContainer.scrollBy({ top: -100, behavior: 'smooth' }));
    dom.order.btnPanDown.addEventListener('click', () => dom.order.canvasContainer.scrollBy({ top:  100, behavior: 'smooth' }));

    // Sync View
    dom.sync.btnRecord.addEventListener('click', handleSyncTapAction);
    dom.sync.btnReset.addEventListener('click',  resetSync);
    dom.sync.btnBack.addEventListener('click',   () => switchView('order-view'));
    dom.sync.btnFinish.addEventListener('click', () => switchView('result-view'));
    dom.sync.btnZoomIn.addEventListener('click',  () => { appState.interaction.timelineZoom += 20; drawSyncTimeline(); });
    dom.sync.btnZoomOut.addEventListener('click', () => { appState.interaction.timelineZoom = Math.max(20, appState.interaction.timelineZoom - 20); drawSyncTimeline(); });
    dom.sync.btnAutoSync.addEventListener('click', autoSyncFromAudio);

    dom.sync.btnTlPrev.addEventListener('click', () => selectTimelineTile(-1));
    dom.sync.btnTlNext.addEventListener('click', () => selectTimelineTile(1));
    dom.sync.btnNudgeLBack.addEventListener('click', () => nudgeSelectedTile(-0.5));
    dom.sync.btnNudgeSBack.addEventListener('click', () => nudgeSelectedTile(-0.01));
    dom.sync.btnNudgeSFwd.addEventListener('click',  () => nudgeSelectedTile(0.01));
    dom.sync.btnNudgeLFwd.addEventListener('click',  () => nudgeSelectedTile(0.5));

    dom.sync.inputDirection.addEventListener('input', (e: Event) => {
        const idx = appState.interaction.selectedSyncIndex;
        if (idx !== -1 && appState.symbols[idx]) {
            appState.symbols[idx].direction = (e.target as HTMLInputElement).value;
        }
    });

    // Result View
    dom.result.btnBack.addEventListener('click',   () => switchView('sync-view'));
    dom.result.btnReset.addEventListener('click',  () => window.location.reload());
    dom.result.btnPlay.addEventListener('click',   playPreview);
    dom.result.btnPause.addEventListener('click',  pausePreview);
    dom.result.btnRewind.addEventListener('click', rewindPreview);
    dom.result.btnDownloadFull.addEventListener('click',    () => renderVideo('full'));
    dom.result.btnDownloadBacking.addEventListener('click', () => renderVideo('backing'));

    dom.result.latencySlider.addEventListener('input', (e: Event) => {
        const val = parseInt((e.target as HTMLInputElement).value);
        appState.interaction.latencyOffset = val / 1000;
        dom.result.latencyVal.textContent = (val / 1000).toFixed(2);
        if (!appState.preview.isPlaying) drawPreviewFrame(dom.sync.audio.currentTime);
    });

    const updateStyle = () => {
        appState.styleConfig.backgroundColor = dom.result.styleBg.value;
        appState.styleConfig.activeScale      = parseFloat(dom.result.styleActiveScale.value);
        appState.styleConfig.nextCount        = parseInt(dom.result.styleNextCount.value);
        appState.styleConfig.nextScale        = parseFloat(dom.result.styleNextScale.value);
        appState.styleConfig.nextOpacity      = parseFloat(dom.result.styleNextOpacity.value);
        appState.styleConfig.spacing          = parseInt(dom.result.styleSpacing.value);
        if (!appState.preview.isPlaying) drawPreviewFrame(dom.sync.audio.currentTime);
    };
    dom.result.styleBg.addEventListener('input',           updateStyle);
    dom.result.styleActiveScale.addEventListener('input',  updateStyle);
    dom.result.styleNextCount.addEventListener('input',    updateStyle);
    dom.result.styleNextScale.addEventListener('input',    updateStyle);
    dom.result.styleNextOpacity.addEventListener('input',  updateStyle);
    dom.result.styleSpacing.addEventListener('input',      updateStyle);

    setupCanvasInteractions();

    // Global keyboard shortcuts
    window.addEventListener('keydown', (e) => {
        if (appState.currentView === 'define-symbols-view' && (e.key === 'Delete' || e.key === 'Backspace')) {
            if ((e.target as HTMLElement).tagName !== 'INPUT' && (e.target as HTMLElement).tagName !== 'TEXTAREA') {
                deleteSelectedSymbols();
            }
        }
        if (appState.currentView === 'sync-view' && (e.key === ' ' || e.key === 'Enter')) {
            if ((e.target as HTMLElement).tagName !== 'INPUT' && (e.target as HTMLElement).tagName !== 'TEXTAREA') {
                e.preventDefault();
                handleSyncTapAction();
            }
        }
        if (appState.currentView === 'sync-view' && appState.interaction.containerFineTuning !== null) {
            if (e.key === 'ArrowLeft')  selectTimelineTile(-1);
            if (e.key === 'ArrowRight') selectTimelineTile(1);
        }
    });
}

// ─── Pointer Utility ──────────────────────────────────────────────────────────
function getPointerPos(e: MouseEvent | TouchEvent, canvas: HTMLCanvasElement) {
    const rect = canvas.getBoundingClientRect();
    let clientX: number, clientY: number;
    if ((e as TouchEvent).touches?.length > 0) {
        clientX = (e as TouchEvent).touches[0].clientX;
        clientY = (e as TouchEvent).touches[0].clientY;
    } else {
        clientX = (e as MouseEvent).clientX;
        clientY = (e as MouseEvent).clientY;
    }
    return { x: clientX - rect.left, y: clientY - rect.top };
}

// ─── Canvas Interactions ──────────────────────────────────────────────────────
function setupCanvasInteractions() {
    dom.define.canvas.addEventListener('mousedown',  handleDefineCanvasDown);
    dom.define.canvas.addEventListener('mousemove',  handleDefineCanvasMove);
    dom.define.canvas.addEventListener('touchstart', handleDefineCanvasDown, { passive: false });
    dom.define.canvas.addEventListener('touchmove',  handleDefineCanvasMove, { passive: false });
    dom.define.canvas.addEventListener('touchend',   handleDefineCanvasUp);
    window.addEventListener('mouseup', handleDefineCanvasUp);

    dom.order.canvas.addEventListener('mousedown',  handleOrderCanvasClick);
    dom.order.canvas.addEventListener('touchstart', handleOrderCanvasClick, { passive: false });
    dom.order.canvas.addEventListener('touchmove', (e: TouchEvent) => {
        if (e.touches.length === 2) { if (e.cancelable) e.preventDefault(); handlePinchZoom(e); }
    }, { passive: false });

    dom.sync.timelineCanvas.addEventListener('mousedown',  handleTimelineMouseDown);
    dom.sync.timelineCanvas.addEventListener('touchstart', handleTimelineMouseDown, { passive: false });
    window.addEventListener('mousemove',  handleTimelineMouseMove);
    window.addEventListener('touchmove',  handleTimelineMouseMove, { passive: false });
    window.addEventListener('mouseup',   handleTimelineMouseUp);
    window.addEventListener('touchend',  handleTimelineMouseUp);
}

function handlePinchZoom(e: TouchEvent) {
    if (e.touches.length !== 2) return;
    const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
    );
    if (appState.interaction.lastTouchDistance > 0) {
        const delta = dist - appState.interaction.lastTouchDistance;
        if (Math.abs(delta) > 5) {
            changeZoom(delta > 0 ? 0.05 : -0.05);
            appState.interaction.lastTouchDistance = dist;
        }
    } else {
        appState.interaction.lastTouchDistance = dist;
    }
}

// ─── File Handling ────────────────────────────────────────────────────────────
async function handleFiles(fileList: FileList | null | undefined) {
    if (!fileList) return;
    const files = Array.from(fileList);
    dom.errorBox.style.display = 'none';

    let added: string[] = [];

    for (const file of files) {
        const type = file.type;
        const name = file.name.toLowerCase();

        if (type.startsWith('audio/') || name.endsWith('.mp3') || name.endsWith('.wav') || name.endsWith('.ogg')) {
            const isBacking = name.includes('backing') || name.includes('inst') || name.includes('karaoke');
            const isVocal   = name.includes('vocal')   || name.includes('full') || name.includes('mix') || name.includes('demo');

            if (isBacking && !appState.files.audioBacking) {
                appState.files.audioBacking = file;
                dom.upload.statusBacking.textContent = file.name;
                dom.upload.cardBacking.classList.add('filled');
                added.push('Backing: ' + file.name);
            } else if (isVocal && !appState.files.audioVocal) {
                appState.files.audioVocal = file;
                dom.upload.statusVocal.textContent = file.name;
                dom.upload.cardVocal.classList.add('filled');
                added.push('Vocal: ' + file.name);
            } else if (!appState.files.audioVocal) {
                appState.files.audioVocal = file;
                dom.upload.statusVocal.textContent = file.name;
                dom.upload.cardVocal.classList.add('filled');
                added.push('Vocal: ' + file.name);
            } else if (!appState.files.audioBacking) {
                appState.files.audioBacking = file;
                dom.upload.statusBacking.textContent = file.name;
                dom.upload.cardBacking.classList.add('filled');
                added.push('Backing: ' + file.name);
            }
        } else if (type === 'application/pdf' || name.endsWith('.pdf')) {
            appState.files.pdf = file;
            dom.upload.statusSongboard.textContent = file.name;
            dom.upload.cardSongboard.classList.add('filled');
            added.push('PDF: ' + file.name);
        } else if (type.startsWith('image/')) {
            appState.files.images.push(file);
            const count = appState.files.images.length;
            dom.upload.statusSongboard.textContent = count === 1 ? file.name : `${count} images loaded`;
            dom.upload.cardSongboard.classList.add('filled');
        }
    }

    if (added.length > 0) showToast(`Loaded: ${added.slice(0, 2).join(', ')}${added.length > 2 ? '…' : ''}`, 'success');
    checkReadyToStart();
}

function checkReadyToStart() {
    const hasVisuals = appState.files.pdf || appState.files.images.length > 0;
    const hasAudio   = !!appState.files.audioVocal || !!appState.files.audioBacking;
    dom.upload.btnGenerate.disabled = !(hasVisuals && hasAudio);
}

// ─── Board Mode ───────────────────────────────────────────────────────────────
function startBoardMode() {
    appState.mode = 'board';
    appState.pages = [];
    const width = 794, height = 1123;
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (ctx) { ctx.fillStyle = 'white'; ctx.fillRect(0, 0, width, height); }
    const img = new Image();
    img.src = canvas.toDataURL();
    img.onload = () => {
        appState.pages.push({ image: img, width, height, symbols: [], sequence: [] });
        switchView('define-symbols-view');
        setTimeout(() => { resizeCanvas(); drawCanvas(); }, 100);
    };
}

function addEmptyTile() {
    const page = appState.pages[appState.currentPageIndex];
    if (!page) return;
    const size = 150;
    const x = Math.max(0, (page.width / 2) - (size / 2));
    const y = Math.max(0, (page.height / 2) - (size / 2));
    page.symbols.push({ x, y, width: size, height: size, customImage: null });
    appState.interaction.selectedIndices.clear();
    appState.interaction.selectedIndices.add(page.symbols.length - 1);
    drawCanvas(); updateToolbarUI();
    showToast('Empty tile added — upload or generate an image for it');
}

async function downloadBoardPdf() {
    const page = appState.pages[appState.currentPageIndex];
    if (!page) return;
    const canvas = document.createElement('canvas');
    canvas.width = page.width; canvas.height = page.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(page.image, 0, 0);
    page.symbols.forEach((sym: any) => {
        if (sym.customImage) {
            ctx.drawImage(sym.customImage, sym.x, sym.y, sym.width, sym.height);
        } else {
            ctx.strokeStyle = '#ccc'; ctx.lineWidth = 2;
            ctx.strokeRect(sym.x, sym.y, sym.width, sym.height);
        }
    });
    const imgData = canvas.toDataURL('image/jpeg', 0.95);
    const { jsPDF } = (window as any).jspdf;
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'px', format: [page.width, page.height] });
    pdf.addImage(imgData, 'JPEG', 0, 0, page.width, page.height);
    pdf.save('symbol-board.pdf');
    showToast('PDF downloaded', 'success');
}

async function downloadBoardImages() {
    const page = appState.pages[appState.currentPageIndex];
    if (!page || page.symbols.length === 0) { showToast('No symbols to download', 'warning'); return; }
    const JSZip  = (window as any).JSZip;
    const saveAs = (window as any).saveAs;
    const zip = new JSZip();
    page.symbols.forEach((sym: any, i: number) => {
        const c = document.createElement('canvas');
        c.width = sym.width; c.height = sym.height;
        const ctx = c.getContext('2d');
        if (ctx) {
            if (sym.customImage) ctx.drawImage(sym.customImage, 0, 0, sym.width, sym.height);
            else ctx.drawImage(page.image, sym.x, sym.y, sym.width, sym.height, 0, 0, sym.width, sym.height);
            zip.file(`symbol_${i + 1}.png`, c.toDataURL('image/png').split(',')[1], { base64: true });
        }
    });
    const content = await zip.generateAsync({ type: 'blob' });
    saveAs(content, 'symbol_images.zip');
    showToast('ZIP downloaded', 'success');
}

// ─── Start Project ────────────────────────────────────────────────────────────
async function startProject() {
    appState.mode = 'karaoke';
    switchView('loading-view');
    try {
        appState.pages = [];
        if (appState.files.pdf) await processPdf(appState.files.pdf);
        else if (appState.files.images.length > 0) {
            appState.files.images.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
            for (const file of appState.files.images) await processImageFile(file);
        }
        const syncFile = appState.files.audioVocal || appState.files.audioBacking;
        if (syncFile) {
            appState.audioUrl = URL.createObjectURL(syncFile);
            dom.sync.audio.src = appState.audioUrl;
            dom.loadingMessage.textContent = 'Decoding audio waveform…';
            const ctx = new AudioContext();
            const buffer = await syncFile.arrayBuffer();
            appState.audioBuffer = await ctx.decodeAudioData(buffer);
            ctx.close();
        }
        switchView('define-symbols-view');
        setTimeout(() => { resizeCanvas(); runGridDetection(); }, 120);
    } catch (e: any) {
        console.error(e);
        dom.errorBox.textContent = 'Error: ' + e.message;
        dom.errorBox.style.display = 'block';
        switchView('upload-view');
        showToast('Failed to load files: ' + e.message, 'error');
    }
}

async function processImageFile(file: File) {
    return new Promise<void>((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            appState.pages.push({ image: img, width: img.naturalWidth, height: img.naturalHeight, symbols: [], sequence: [] });
            resolve();
        };
        img.onerror = reject;
        img.src = URL.createObjectURL(file);
    });
}

async function processPdf(file: File) {
    const arrayBuffer = await file.arrayBuffer();
    const pdfjsLib = (window as any).pdfjsLib;
    if (!pdfjsLib) throw new Error('PDF.js library not loaded.');
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    for (let i = 1; i <= pdf.numPages; i++) {
        const page     = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 2.0 });
        const canvas   = document.createElement('canvas');
        const context  = canvas.getContext('2d');
        canvas.height  = viewport.height;
        canvas.width   = viewport.width;
        await page.render({ canvasContext: context, viewport }).promise;
        const img = new Image();
        img.src = canvas.toDataURL('image/png');
        await new Promise(r => img.onload = r);
        appState.pages.push({ image: img, width: canvas.width, height: canvas.height, symbols: [], sequence: [] });
        dom.loadingMessage.textContent = `Processing page ${i} of ${pdf.numPages}…`;
    }
}

// ─── View Management ──────────────────────────────────────────────────────────
function switchView(viewId: string) {
    Object.values(dom.views).forEach((el: any) => (el.style.display = 'none'));
    const key = viewId === 'upload-view'         ? 'upload'
              : viewId === 'loading-view'         ? 'loading'
              : viewId === 'define-symbols-view'  ? 'define'
              : viewId === 'order-view'            ? 'order'
              : viewId === 'sync-view'             ? 'sync'
              : 'result';
    dom.views[key].style.display = 'block';
    appState.currentView = viewId;

    // Step progress
    const step = VIEW_STEP_MAP[viewId];
    if (step) updateStepProgress(step);

    // Mode-specific UI
    if (viewId === 'define-symbols-view') {
        const isBoard = appState.mode === 'board';
        if (dom.define.karaokeTools) dom.define.karaokeTools.style.display = isBoard ? 'none' : 'block';
        if (dom.define.boardTools)   dom.define.boardTools.style.display   = isBoard ? 'block' : 'none';
        dom.define.btnGoOrder.style.display = isBoard ? 'none' : 'block';
        setTimeout(resizeCanvas, 50);
    }
    if (viewId === 'order-view') {
        setTimeout(setupOrderView, 50);
    } else {
        // Pause order audio when leaving that view
        if (dom.order?.audio && !dom.order.audio.paused) dom.order.audio.pause();
    }
    if (viewId === 'sync-view')   setupSyncView();
    if (viewId === 'result-view') setupResultView();
}

// ─── AI Generation ────────────────────────────────────────────────────────────
function getCurrentPageStyleReference(): string {
    const page = appState.pages[appState.currentPageIndex];
    if (!page) return '';
    const canvas = document.createElement('canvas');
    const size = Math.min(page.width, 1024);
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    ctx.drawImage(page.image, 0, 0, size, size, 0, 0, size, size);
    return canvas.toDataURL('image/png').split(',')[1];
}

async function generateAiSymbol() {
    const promptText = (dom.define.aiPrompt as HTMLTextAreaElement).value.trim();
    if (!promptText) { showToast('Please enter a prompt first', 'warning'); return; }
    const isMulti = (dom.define.aiMultiToggle as HTMLInputElement).checked;

    const win = window as any;
    if (win.aistudio && !await win.aistudio.hasSelectedApiKey()) {
        try { await win.aistudio.openSelectKey(); }
        catch { showToast('API key selection cancelled', 'warning'); return; }
    }

    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    setAiLoading(true);
    try {
        const page = appState.pages[appState.currentPageIndex];
        const styleRefBase64 = getCurrentPageStyleReference();
        const strictPrompt = `
Create a communication symbol for: "${promptText}".
CRITICAL STYLE INSTRUCTIONS:
- Match the visual style of the provided reference image EXACTLY.
- Thick black outlines, flat colour palette, simple 2D iconographic vector-art style.
- Pure white background. No shading, gradients, realism, or complexity.
- Must look like a standard Widgit/AAC communication symbol.`;

        const parts: any[] = [{ text: strictPrompt }];
        if (styleRefBase64) parts.unshift({ inlineData: { mimeType: 'image/png', data: styleRefBase64 } });

        const count = isMulti ? 3 : 1;
        const promises = Array.from({ length: count }, () =>
            ai.models.generateContent({
                model: 'gemini-2.0-flash-preview-image-generation',
                contents: { parts },
                config: { responseModalities: ['TEXT', 'IMAGE'] }
            })
        );

        const responses = await Promise.all(promises);
        let createdCount = 0;
        appState.interaction.selectedIndices.clear();

        for (let i = 0; i < responses.length; i++) {
            const response = responses[i];
            let imgBase64: string | null = null;
            if (response.candidates?.[0]?.content?.parts) {
                for (const part of response.candidates[0].content.parts) {
                    if (part.inlineData) imgBase64 = part.inlineData.data;
                }
            }
            if (imgBase64) {
                const img = new Image();
                await new Promise<void>((resolve) => {
                    img.onload = () => {
                        const size = 200;
                        const offsetX = (i * 220) - ((count - 1) * 110);
                        const x = Math.max(0, (page.width / 2) - (size / 2) + offsetX);
                        const y = Math.max(0, (page.height / 2) - (size / 2));
                        page.symbols.push({ x, y, width: size, height: size, customImage: img });
                        appState.interaction.selectedIndices.add(page.symbols.length - 1);
                        createdCount++;
                        resolve();
                    };
                    img.src = `data:image/png;base64,${imgBase64}`;
                });
            }
        }

        if (createdCount > 0) {
            updateToolbarUI(); drawCanvas();
            dom.define.canvasContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
            showToast(`Generated ${createdCount} symbol${createdCount > 1 ? 's' : ''} ✨`, 'success');
        } else {
            showToast('No images returned — try a different prompt', 'warning');
        }
    } catch (e: any) {
        console.error(e);
        showToast('Generation failed: ' + (e.message || 'Unknown error'), 'error');
    } finally {
        setAiLoading(false);
    }
}

async function editAiSymbol() {
    const promptText = (dom.define.aiPrompt as HTMLTextAreaElement).value.trim();
    if (!promptText) { showToast('Please enter an edit prompt', 'warning'); return; }
    if (appState.interaction.selectedIndices.size !== 1) {
        showToast('Select exactly one tile to edit', 'warning'); return;
    }

    const win = window as any;
    if (win.aistudio && !await win.aistudio.hasSelectedApiKey()) {
        try { await win.aistudio.openSelectKey(); }
        catch { showToast('API key selection cancelled', 'warning'); return; }
    }

    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    setAiLoading(true);
    try {
        const page = appState.pages[appState.currentPageIndex];
        const idx  = appState.interaction.selectedIndices.values().next().value;
        const sym  = page.symbols[idx];

        const canvas = document.createElement('canvas');
        canvas.width = sym.width; canvas.height = sym.height;
        const ctx = canvas.getContext('2d');
        if (sym.customImage) ctx!.drawImage(sym.customImage, 0, 0, sym.width, sym.height);
        else ctx!.drawImage(page.image, sym.x, sym.y, sym.width, sym.height, 0, 0, sym.width, sym.height);
        const base64Data = canvas.toDataURL('image/png').split(',')[1];

        const strictPrompt = `
Edit this symbol to: "${promptText}".
CRITICAL STYLE INSTRUCTIONS:
- PRESERVE the exact visual style — thick black outlines, flat colours, simple vector look.
- Do not change the art style or add realism. Keep white background.`;

        const parts: any[] = [
            { inlineData: { mimeType: 'image/png', data: base64Data } },
            { text: strictPrompt }
        ];

        const response = await ai.models.generateContent({
            model: 'gemini-2.0-flash-preview-image-generation',
            contents: { parts },
            config: { responseModalities: ['TEXT', 'IMAGE'] }
        });

        let imgBase64: string | null = null;
        for (const part of response.candidates![0].content.parts) {
            if (part.inlineData) imgBase64 = part.inlineData.data;
        }
        if (imgBase64) {
            const img = new Image();
            img.onload = () => { sym.customImage = img; drawCanvas(); };
            img.src = `data:image/png;base64,${imgBase64}`;
            showToast('Symbol updated ✨', 'success');
        } else {
            showToast('No image returned from edit', 'warning');
        }
    } catch (e: any) {
        console.error(e);
        showToast('Edit failed: ' + (e.message || 'Unknown error'), 'error');
    } finally {
        setAiLoading(false);
    }
}

async function handleSymbolUpload(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const file = fileList[0];
    const page = appState.pages[appState.currentPageIndex];
    if (!page) return;
    const img = new Image();
    img.onload = () => {
        if (appState.interaction.selectedIndices.size === 1) {
            const idx = appState.interaction.selectedIndices.values().next().value;
            page.symbols[idx].customImage = img;
            showToast('Symbol image replaced');
        } else {
            const size = 200;
            const x = Math.max(0, (page.width / 2) - (size / 2));
            const y = Math.max(0, (page.height / 2) - (size / 2));
            page.symbols.push({ x, y, width: size, height: size, customImage: img });
            appState.interaction.selectedIndices.clear();
            appState.interaction.selectedIndices.add(page.symbols.length - 1);
            showToast('Symbol image added');
        }
        drawCanvas(); updateToolbarUI();
        dom.define.inputUploadSymbol.value = '';
    };
    img.src = URL.createObjectURL(file);
}

function setAiLoading(loading: boolean) {
    dom.define.aiLoading.style.display      = loading ? 'flex' : 'none';
    dom.define.btnAiGenerate.disabled       = loading;
    dom.define.btnAiEdit.disabled           = loading;
}

// ─── Define Symbols ───────────────────────────────────────────────────────────
function changeZoom(delta: number) {
    appState.interaction.zoomLevel = Math.max(0.3, Math.min(4.0, appState.interaction.zoomLevel + delta));
    resizeCanvas(); drawCanvas();
}

function changePage(delta: number) {
    const newIndex = appState.currentPageIndex + delta;
    if (newIndex >= 0 && newIndex < appState.pages.length) {
        appState.currentPageIndex = newIndex;
        appState.interaction.selectedIndices.clear();
        updateToolbarUI();
        const label = `Page ${newIndex + 1} / ${appState.pages.length}`;
        dom.define.labelPage.textContent = label;
        dom.order.labelPage.textContent  = label;
        resizeCanvas(); drawCanvas();
    }
}

function clearCurrentPageSymbols() {
    const page = appState.pages[appState.currentPageIndex];
    if (page) {
        page.symbols = [];
        page.sequence = [];
        appState.interaction.selectedIndices.clear();
        appState.interaction.isDragging = false;
        updateToolbarUI(); drawCanvas();
        showToast('Page cleared');
    }
}

function deleteSelectedSymbols() {
    const page = appState.pages[appState.currentPageIndex];
    if (!page || appState.interaction.selectedIndices.size === 0) return;
    const count = appState.interaction.selectedIndices.size;
    const indicesToDelete = Array.from(appState.interaction.selectedIndices).sort((a, b) => b - a);
    indicesToDelete.forEach(index => {
        page.symbols.splice(index, 1);
        page.sequence = page.sequence.filter(i => i !== index).map(i => i > index ? i - 1 : i);
    });
    appState.interaction.selectedIndices.clear();
    appState.interaction.isDragging = false;
    updateToolbarUI(); drawCanvas();
    showToast(`Deleted ${count} symbol${count > 1 ? 's' : ''}`);
}

function selectSimilarColors() {
    const page = appState.pages[appState.currentPageIndex];
    if (appState.interaction.selectedIndices.size === 0) {
        showToast('Select a tile first to find colour matches', 'warning'); return;
    }
    const firstIdx  = appState.interaction.selectedIndices.values().next().value;
    const targetSym = page.symbols[firstIdx];
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = page.width; tempCanvas.height = page.height;
    const ctx = tempCanvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(page.image, 0, 0);
    const fullData = ctx.getImageData(0, 0, page.width, page.height).data;

    const getColor = (s: any) => {
        const cx = Math.floor(s.x + s.width / 2);
        const cy = Math.floor(s.y + s.height / 2);
        const idx = (cy * page.width + cx) * 4;
        return [fullData[idx], fullData[idx + 1], fullData[idx + 2]];
    };
    const target = getColor(targetSym);
    let matchCount = 0;
    page.symbols.forEach((sym, idx) => {
        const c = getColor(sym);
        const dist = Math.sqrt((c[0]-target[0])**2 + (c[1]-target[1])**2 + (c[2]-target[2])**2);
        if (dist < 50) { appState.interaction.selectedIndices.add(idx); matchCount++; }
    });
    updateToolbarUI(); drawCanvas();
    showToast(`Selected ${appState.interaction.selectedIndices.size} matching tiles`);
}

function updateToolbarUI() {
    const count = appState.interaction.selectedIndices.size;
    dom.define.btnDelete.textContent = count > 0 ? `🗑 Delete (${count})` : '🗑 Delete';
}

function resizeCanvas() {
    const page = appState.pages[appState.currentPageIndex];
    if (!page) return;
    dom.define.canvas.width  = page.width  * appState.interaction.zoomLevel;
    dom.define.canvas.height = page.height * appState.interaction.zoomLevel;
    drawCanvas();
}

function drawCanvas() {
    const ctx  = dom.define.ctx;
    const page = appState.pages[appState.currentPageIndex];
    if (!page || !ctx) return;
    ctx.save();
    ctx.scale(appState.interaction.zoomLevel, appState.interaction.zoomLevel);
    ctx.clearRect(0, 0, page.width, page.height);
    ctx.drawImage(page.image, 0, 0);
    ctx.lineWidth = 3 / appState.interaction.zoomLevel;

    page.symbols.forEach((s: any, idx: number) => {
        if (s.customImage) ctx.drawImage(s.customImage, s.x, s.y, s.width, s.height);
        const selected = appState.interaction.selectedIndices.has(idx);
        ctx.strokeStyle = selected ? '#00e5ff' : '#1a73e8';
        ctx.fillStyle   = selected ? 'rgba(0,229,255,0.18)' : 'rgba(26,115,232,0.08)';
        ctx.beginPath(); ctx.rect(s.x, s.y, s.width, s.height);
        ctx.fill(); ctx.stroke();
        // corner handles on selected
        if (selected) {
            ctx.fillStyle = '#00e5ff';
            const hs = 5 / appState.interaction.zoomLevel;
            [[s.x,s.y],[s.x+s.width,s.y],[s.x,s.y+s.height],[s.x+s.width,s.y+s.height]].forEach(([hx,hy]) => {
                ctx.fillRect(hx - hs/2, hy - hs/2, hs, hs);
            });
        }
    });
    ctx.restore();

    // Marquee selection box
    if (appState.interaction.dragAction === 'marquee' && appState.interaction.isDragging) {
        const { marqueeStart: ms, marqueeCurrent: mc } = appState.interaction;
        const z = appState.interaction.zoomLevel;
        const x = Math.min(ms.x, mc.x) * z, y = Math.min(ms.y, mc.y) * z;
        const w = Math.abs(mc.x - ms.x) * z,  h = Math.abs(mc.y - ms.y) * z;
        ctx.save();
        ctx.strokeStyle = '#1a73e8';
        ctx.fillStyle   = 'rgba(26,115,232,0.06)';
        ctx.setLineDash([5, 4]);
        ctx.strokeRect(x, y, w, h);
        ctx.fillRect(x, y, w, h);
        ctx.restore();
    }
}

function runGridDetection() {
    const page = appState.pages[appState.currentPageIndex];
    if (!page) return;
    page.symbols  = [];
    page.sequence = [];

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = page.width; tempCanvas.height = page.height;
    const ctx = tempCanvas.getContext('2d')!;
    ctx.drawImage(page.image, 0, 0);
    const data      = ctx.getImageData(0, 0, page.width, page.height).data;
    const w = page.width, h = page.height;
    const threshold = appState.gridConfig.contentThreshold;

    const isDark = (idx: number) =>
        data[idx] < threshold || data[idx + 1] < threshold || data[idx + 2] < threshold;

    let rows: {s:number,e:number}[] = [], inRow = false, startY = 0;
    for (let y = 0; y < h; y++) {
        let count = 0;
        for (let x = 0; x < w; x += 4) if (isDark((y * w + x) * 4)) count++;
        if (count > w * 0.004) { if (!inRow) { inRow = true; startY = y; } }
        else { if (inRow) { inRow = false; if (y - startY > appState.gridConfig.minSymbolHeight) rows.push({ s: startY, e: y }); } }
    }
    if (inRow) rows.push({ s: startY, e: h });

    // Merge rows that are very close (< 15px gap)
    const mergedRows: {s:number,e:number}[] = [];
    for (const r of rows) {
        if (mergedRows.length > 0 && r.s - mergedRows[mergedRows.length - 1].e < 15) {
            mergedRows[mergedRows.length - 1].e = r.e;
        } else {
            mergedRows.push({ ...r });
        }
    }

    mergedRows.forEach(r => {
        let inCol = false, startX = 0;
        for (let x = 0; x < w; x++) {
            let count = 0;
            for (let y = r.s; y < r.e; y += 4) if (isDark((y * w + x) * 4)) count++;
            const active = count > (r.e - r.s) * 0.008;
            if (active) { if (!inCol) { inCol = true; startX = x; } }
            else {
                if (inCol) {
                    inCol = false;
                    if (x - startX > appState.gridConfig.minSymbolWidth)
                        page.symbols.push({ x: startX, y: r.s, width: x - startX, height: r.e - r.s });
                }
            }
        }
        if (inCol && w - startX > appState.gridConfig.minSymbolWidth)
            page.symbols.push({ x: startX, y: r.s, width: w - startX, height: r.e - r.s });
    });

    drawCanvas();
}

// ─── AI Grid Detection ────────────────────────────────────────────────────────
async function runAiGridDetection() {
    const page = appState.pages[appState.currentPageIndex];
    if (!page) return;

    const win = window as any;
    if (win.aistudio && !await win.aistudio.hasSelectedApiKey()) {
        try { await win.aistudio.openSelectKey(); }
        catch { showToast('API key needed — falling back to pixel scan', 'warning'); runGridDetection(); return; }
    }

    setDetectionLoading(true);
    try {
        // Downscale to max 1024px for speed while preserving aspect ratio
        const maxDim = 1024;
        const scale  = Math.min(1, maxDim / Math.max(page.width, page.height));
        const cw     = Math.round(page.width * scale);
        const ch     = Math.round(page.height * scale);
        const tmpCvs = document.createElement('canvas');
        tmpCvs.width = cw; tmpCvs.height = ch;
        tmpCvs.getContext('2d')!.drawImage(page.image, 0, 0, cw, ch);
        const base64 = tmpCvs.toDataURL('image/jpeg', 0.85).split(',')[1];

        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const prompt = `This is an AAC (Augmentative and Alternative Communication) symbol chart / communication board.
Identify every individual symbol cell — each distinct picture/icon box — in this image.
Return ONLY a valid JSON array, no markdown fences, no explanation:
[{"x":10,"y":20,"w":80,"h":80},...]
Each object: x,y = top-left corner; w,h = width and height in pixels.
Image dimensions are ${cw} × ${ch} pixels. Include every symbol box. Ignore plain text outside boxes.`;

        const response = await ai.models.generateContent({
            model: 'gemini-2.0-flash',
            contents: { parts: [
                { inlineData: { mimeType: 'image/jpeg', data: base64 } },
                { text: prompt }
            ]}
        });

        const raw  = response.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const json = raw.match(/\[[\s\S]*?\]/)?.[0];
        if (!json) throw new Error('No JSON array in response');

        const boxes = JSON.parse(json) as { x: number; y: number; w: number; h: number }[];
        if (!Array.isArray(boxes) || boxes.length === 0) throw new Error('Empty symbol list');

        const upscale = 1 / scale;
        page.symbols  = [];
        page.sequence = [];
        for (const b of boxes) {
            if ((b.w ?? 0) < 10 || (b.h ?? 0) < 10) continue;
            page.symbols.push({
                x:      Math.round(b.x * upscale),
                y:      Math.round(b.y * upscale),
                width:  Math.round(b.w * upscale),
                height: Math.round(b.h * upscale)
            });
        }

        // Auto-order left→right, top→bottom
        const indices = page.symbols.map((_, i) => i);
        indices.sort((a, b) => {
            const sA = page.symbols[a], sB = page.symbols[b];
            return Math.abs(sA.y - sB.y) > 40 ? sA.y - sB.y : sA.x - sB.x;
        });
        page.sequence = indices;

        drawCanvas();
        showToast(`AI detected ${page.symbols.length} symbols — auto-ordered ✨`, 'success');
    } catch (e: any) {
        console.error('AI detection failed:', e);
        showToast('AI detection failed — falling back to pixel scan', 'warning');
        runGridDetection();
    } finally {
        setDetectionLoading(false);
    }
}

function setDetectionLoading(loading: boolean) {
    const btn = dom.define.btnAuto;
    btn.disabled     = loading;
    btn.textContent  = loading ? '⏳ Detecting…' : '✨ AI Detect Grid';
    if (dom.define.btnPixelScan) dom.define.btnPixelScan.disabled = loading;
}

// ─── Audio Beat / Onset Detection ────────────────────────────────────────────
function autoSyncFromAudio() {
    const buffer = appState.audioBuffer;
    const n      = appState.symbols.length;
    if (!buffer || n === 0) { showToast('Load audio and complete ordering first', 'warning'); return; }

    const data       = buffer.getChannelData(0);
    const sampleRate = buffer.sampleRate;
    const winSize    = Math.floor(sampleRate * 0.05); // 50 ms windows

    // RMS energy per window
    const energies: number[] = [];
    for (let i = 0; i < data.length; i += winSize) {
        let sum = 0;
        const end = Math.min(i + winSize, data.length);
        for (let j = i; j < end; j++) sum += data[j] * data[j];
        energies.push(Math.sqrt(sum / (end - i)));
    }

    // Noise floor = 20th percentile energy
    const sorted     = [...energies].sort((a, b) => a - b);
    const noiseFloor = sorted[Math.floor(sorted.length * 0.2)] || 0.001;
    const threshold  = noiseFloor * 6;

    // Onset = transition from below-threshold to above-threshold
    const onsets: number[] = [];
    let wasActive = false;
    for (let i = 0; i < energies.length; i++) {
        const isActive = energies[i] > threshold;
        if (isActive && !wasActive) {
            const t = (i * winSize) / sampleRate;
            // Debounce: min 0.25 s between onsets
            if (onsets.length === 0 || t - onsets[onsets.length - 1] > 0.25) onsets.push(t);
        }
        wasActive = isActive;
    }

    if (onsets.length < 1) {
        showToast('No clear audio onsets found — try recording manually', 'warning'); return;
    }

    // Distribute symbols across detected onsets (cycle if more symbols than onsets)
    appState.symbols.forEach((sym, i) => {
        const oIdx       = Math.min(i, onsets.length - 1);
        const oNext      = Math.min(i + 1, onsets.length - 1);
        sym.startTime    = onsets[oIdx];
        sym.endTime      = i < n - 1 ? onsets[oNext] : buffer.duration;
    });

    // Show fine-tuning panel
    dom.sync.visualCue.style.display          = 'none';
    dom.sync.containerFineTuning.style.display = 'block';
    appState.interaction.selectedSyncIndex     = 0;
    selectTimelineTile(0);
    drawSyncTimeline();
    showToast(`Auto-synced ${n} symbols to ${onsets.length} audio onsets ✨`, 'success');
}

function handleDefineCanvasDown(e: MouseEvent | TouchEvent) {
    if (e.type === 'touchstart') {
        if ((e as TouchEvent).touches.length === 2) { appState.interaction.lastTouchDistance = 0; return; }
    }
    const pos   = getPointerPos(e, dom.define.canvas);
    const scale = appState.interaction.zoomLevel;
    const x = pos.x / scale, y = pos.y / scale;
    const page = appState.pages[appState.currentPageIndex];
    const hitIndex = page.symbols.findIndex((s: any) =>
        x >= s.x && x <= s.x + s.width && y >= s.y && y <= s.y + s.height);

    if (hitIndex !== -1) {
        if (e.type === 'touchstart' && (e as TouchEvent).cancelable) e.preventDefault();
        if ((e as MouseEvent).shiftKey) {
            if (appState.interaction.selectedIndices.has(hitIndex)) appState.interaction.selectedIndices.delete(hitIndex);
            else appState.interaction.selectedIndices.add(hitIndex);
        } else {
            if (!appState.interaction.selectedIndices.has(hitIndex)) {
                appState.interaction.selectedIndices.clear();
                appState.interaction.selectedIndices.add(hitIndex);
            }
        }
        appState.interaction.dragAction = 'move';
        appState.interaction.dragStart  = { x, y };
    } else {
        if (e.type === 'touchstart') {
            appState.interaction.dragAction = 'none';
        } else {
            if (!(e as MouseEvent).shiftKey) appState.interaction.selectedIndices.clear();
            appState.interaction.dragAction      = 'marquee';
            appState.interaction.marqueeStart    = { x, y };
            appState.interaction.marqueeCurrent  = { x, y };
            appState.interaction.initialSelection = new Set(appState.interaction.selectedIndices);
        }
    }
    appState.interaction.isDragging = true;
    drawCanvas(); updateToolbarUI();
}

function handleDefineCanvasMove(e: MouseEvent | TouchEvent) {
    if (e.type === 'touchmove') {
        if ((e as TouchEvent).touches.length === 2) {
            if ((e as TouchEvent).cancelable) e.preventDefault();
            handlePinchZoom(e as TouchEvent); return;
        }
        if (appState.interaction.dragAction !== 'none' && (e as TouchEvent).cancelable) e.preventDefault();
    }
    if (!appState.interaction.isDragging || appState.interaction.dragAction === 'none') return;

    const pos   = getPointerPos(e, dom.define.canvas);
    const scale = appState.interaction.zoomLevel;
    const x = pos.x / scale, y = pos.y / scale;
    const page = appState.pages[appState.currentPageIndex];

    if (appState.interaction.dragAction === 'move') {
        const dx = x - appState.interaction.dragStart.x;
        const dy = y - appState.interaction.dragStart.y;
        appState.interaction.selectedIndices.forEach(idx => {
            page.symbols[idx].x += dx; page.symbols[idx].y += dy;
        });
        appState.interaction.dragStart = { x, y };
    } else if (appState.interaction.dragAction === 'marquee') {
        appState.interaction.marqueeCurrent = { x, y };
        const s  = appState.interaction.marqueeStart;
        const mx = Math.min(s.x, x), my = Math.min(s.y, y);
        const mw = Math.abs(x - s.x),  mh = Math.abs(y - s.y);
        appState.interaction.selectedIndices = new Set(appState.interaction.initialSelection);
        page.symbols.forEach((sym: any, i: number) => {
            if (mx < sym.x + sym.width && mx + mw > sym.x && my < sym.y + sym.height && my + mh > sym.y)
                appState.interaction.selectedIndices.add(i);
        });
        updateToolbarUI();
    }
    drawCanvas();
}

function handleDefineCanvasUp() {
    appState.interaction.isDragging = false;
    appState.interaction.dragAction = 'none';
    appState.interaction.lastTouchDistance = 0;
    drawCanvas();
}

// ─── Order View ───────────────────────────────────────────────────────────────
function setupOrderView() {
    const page = appState.pages[appState.currentPageIndex];
    if (!page) return;
    const containerW = dom.order.canvasContainer.clientWidth;
    const scale = containerW / page.width;
    dom.order.canvas.width  = page.width  * scale;
    dom.order.canvas.height = page.height * scale;
    drawOrderCanvas();
    updateOrderSeqBar();
    // Wire audio player so user can listen while setting order
    if (appState.audioUrl && dom.order.audio && !dom.order.audio.src) {
        dom.order.audio.src = appState.audioUrl;
    }
}

function drawOrderCanvas() {
    const ctx    = dom.order.ctx;
    const page   = appState.pages[appState.currentPageIndex];
    const canvas = dom.order.canvas;
    const scale  = canvas.width / page.width;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(page.image, 0, 0, canvas.width, canvas.height);

    // Sequence path
    if (page.sequence.length > 1) {
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(234,67,53,0.55)';
        ctx.lineWidth   = 2.5;
        ctx.setLineDash([8, 4]);
        const first = page.symbols[page.sequence[0]];
        ctx.moveTo((first.x + first.width / 2) * scale, (first.y + first.height / 2) * scale);
        for (let i = 1; i < page.sequence.length; i++) {
            const sym = page.symbols[page.sequence[i]];
            ctx.lineTo((sym.x + sym.width / 2) * scale, (sym.y + sym.height / 2) * scale);
        }
        ctx.stroke();
        ctx.setLineDash([]);
    }

    page.symbols.forEach((sym, idx) => {
        const x = sym.x * scale, y = sym.y * scale, w = sym.width * scale, h = sym.height * scale;
        if (sym.customImage) ctx.drawImage(sym.customImage, x, y, w, h);

        // Count how many times this tile is used in the sequence
        const useCount = page.sequence.filter(s => s === idx).length;
        // First position of this tile in the sequence (for path rendering)
        const firstSeqPos = page.sequence.indexOf(idx);

        if (useCount > 0) {
            ctx.fillStyle   = 'rgba(52,168,83,0.25)';
            ctx.strokeStyle = '#34a853';
            ctx.lineWidth   = 2.5;
        } else {
            ctx.fillStyle   = 'rgba(255,255,255,0.22)';
            ctx.strokeStyle = '#9aa0a6';
            ctx.lineWidth   = 1;
        }
        ctx.fillRect(x, y, w, h);
        ctx.strokeRect(x, y, w, h);

        if (useCount > 0) {
            // Badge: show use count (×N) in top-right corner
            const bx = x + w - 14, by = y + 14;
            ctx.fillStyle = useCount > 1 ? '#e37400' : '#34a853';
            ctx.beginPath(); ctx.arc(bx, by, 13, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = 'white';
            ctx.font = `bold ${w < 60 ? 9 : 11}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(useCount > 1 ? `×${useCount}` : (firstSeqPos + 1).toString(), bx, by);
            ctx.textBaseline = 'alphabetic';
        }
    });
}

function handleOrderCanvasClick(e: MouseEvent | TouchEvent) {
    if (e.type === 'touchstart') {
        if ((e as TouchEvent).touches.length === 2) return;
        if ((e as TouchEvent).cancelable) e.preventDefault();
    }
    const pos   = getPointerPos(e, dom.order.canvas);
    const page  = appState.pages[appState.currentPageIndex];
    const scale = dom.order.canvas.width / page.width;
    const x = pos.x / scale, y = pos.y / scale;
    const hitIdx = page.symbols.findIndex((s: any) =>
        x >= s.x && x <= s.x + s.width && y >= s.y && y <= s.y + s.height);
    if (hitIdx !== -1) {
        // Always append — same symbol can appear multiple times
        page.sequence.push(hitIdx);
        drawOrderCanvas();
        updateOrderSeqBar();
    }
}

function undoLastOrderSymbol() {
    const page = appState.pages[appState.currentPageIndex];
    if (!page || page.sequence.length === 0) return;
    page.sequence.pop();
    drawOrderCanvas();
    updateOrderSeqBar();
    showToast('Removed last symbol from sequence');
}

function updateOrderSeqBar() {
    const page = appState.pages[appState.currentPageIndex];
    const bar  = dom.order.seqBar;
    const lbl  = dom.order.seqLabel;
    if (!bar || !page) return;

    if (page.sequence.length === 0) {
        lbl.style.display = 'inline';
        lbl.textContent   = 'Tap symbols below in reading order — same tile can be added multiple times';
        // Clear any chips
        Array.from(bar.children).forEach((el: any) => { if (el !== lbl) el.remove(); });
        return;
    }
    lbl.style.display = 'none';
    // Remove old chips
    Array.from(bar.children).forEach((el: any) => { if (el !== lbl) el.remove(); });

    page.sequence.forEach((symIdx, pos) => {
        const chip = document.createElement('span');
        chip.style.cssText = `
            display:inline-flex; align-items:center; gap:3px;
            background:var(--primary-light); border:1px solid #d2e3fc;
            border-radius:var(--radius-full); padding:3px 8px;
            font-size:0.76rem; color:#174ea6; font-weight:700; cursor:pointer;
        `;
        chip.title = 'Click to remove this entry';
        chip.textContent = `${pos + 1}`;

        // Tiny symbol thumbnail
        const sym = page.symbols[symIdx];
        if (sym) {
            const thumb = document.createElement('canvas');
            thumb.width = 18; thumb.height = 18;
            thumb.style.cssText = 'border-radius:3px; vertical-align:middle;';
            const tCtx = thumb.getContext('2d')!;
            if (sym.customImage) tCtx.drawImage(sym.customImage, 0, 0, 18, 18);
            else tCtx.drawImage(page.image, sym.x, sym.y, sym.width, sym.height, 0, 0, 18, 18);
            chip.prepend(thumb);
        }

        chip.addEventListener('click', () => {
            page.sequence.splice(pos, 1);
            drawOrderCanvas();
            updateOrderSeqBar();
        });
        bar.appendChild(chip);
    });
}

function autoOrderPage() {
    const page    = appState.pages[appState.currentPageIndex];
    const indices = page.symbols.map((_, i) => i);
    indices.sort((a, b) => {
        const sA = page.symbols[a], sB = page.symbols[b];
        const yDiff = Math.abs(sA.y - sB.y);
        return yDiff > 40 ? sA.y - sB.y : sA.x - sB.x;
    });
    page.sequence = indices;
    drawOrderCanvas();
    updateOrderSeqBar();
    showToast(`Auto-ordered ${indices.length} symbols (left→right, top→bottom)`);
}

function resetOrderPage() {
    appState.pages[appState.currentPageIndex].sequence = [];
    drawOrderCanvas();
    updateOrderSeqBar();
    showToast('Sequence cleared');
}

function finishOrderingSymbols() {
    appState.symbols = [];
    appState.pages.forEach((page, pIdx) => {
        const order = page.sequence.length > 0 ? page.sequence : page.symbols.map((_, i) => i);
        order.forEach(symIdx => {
            const sym    = page.symbols[symIdx];
            const canvas = document.createElement('canvas');
            canvas.width = sym.width; canvas.height = sym.height;
            const ctx = canvas.getContext('2d')!;
            if (sym.customImage) ctx.drawImage(sym.customImage, 0, 0, sym.width, sym.height);
            else ctx.drawImage(page.image, sym.x, sym.y, sym.width, sym.height, 0, 0, sym.width, sym.height);
            appState.symbols.push({
                globalIndex: appState.symbols.length,
                pageIndex:   pIdx,
                imageSrc:    canvas.toDataURL(),
                startTime:   0,
                endTime:     0,
                direction:   '',
                ...sym
            });
        });
    });

    if (appState.symbols.length === 0) {
        showToast('No symbols in sequence — tap symbols in order first', 'warning'); return;
    }
    showToast(`${appState.symbols.length} symbols ready to sync`, 'success');
    setupSyncView();
    switchView('sync-view');
}

// ─── Sync Logic ───────────────────────────────────────────────────────────────
function setupSyncView() {
    appState.currentSyncIndex    = -1;
    appState.isRecordingSync     = false;
    appState.interaction.selectedSyncIndex = -1;
    appState.interaction.syncScrollX       = 0;

    dom.sync.visualCue.style.display          = 'flex';
    dom.sync.containerFineTuning.style.display = 'none';

    updateSyncButtonUI();
    renderSymbolNavStrip();
    updateTimelineToolsUI();
    drawSyncTimeline();

    if (appState.preview.animationId) cancelAnimationFrame(appState.preview.animationId);

    const animate = () => {
        if (appState.currentView === 'sync-view') {
            const t = dom.sync.audio.currentTime;
            if (!appState.interaction.isDragging && (appState.isRecordingSync || !dom.sync.audio.paused)) {
                const zoom = appState.interaction.timelineZoom;
                const vpW  = dom.sync.timelineContainer.clientWidth;
                const vpSecs = vpW / zoom;
                if (t > appState.interaction.syncScrollX + vpSecs * 0.78)
                    appState.interaction.syncScrollX = t - vpSecs * 0.22;
            }
            drawSyncTimeline();
            appState.preview.animationId = requestAnimationFrame(animate);
        }
    };
    appState.preview.animationId = requestAnimationFrame(animate);
}

function renderSymbolNavStrip() {
    const container = dom.sync.navStrip;
    container.innerHTML = '';
    appState.symbols.forEach((sym, idx) => {
        const div = document.createElement('div');
        div.className = 'nav-symbol-item';
        div.id = `nav-sym-${idx}`;
        const img   = document.createElement('img');
        img.src     = sym.imageSrc;
        img.alt     = `Symbol ${idx + 1}`;
        const badge = document.createElement('div');
        badge.className   = 'number-badge';
        badge.textContent = (idx + 1).toString();
        div.appendChild(img);
        div.appendChild(badge);
        div.addEventListener('click', () => {
            appState.interaction.selectedSyncIndex = idx;
            selectTimelineTile(0);
        });
        container.appendChild(div);
    });
}

function updateNavStripHighlight() {
    const idx   = appState.interaction.selectedSyncIndex;
    const items = dom.sync.navStrip.querySelectorAll('.nav-symbol-item');
    items.forEach((item: HTMLElement, i: number) => {
        if (i === idx) {
            item.classList.add('active');
            item.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        } else {
            item.classList.remove('active');
        }
    });
}

function drawSyncTimeline() {
    const canvas = dom.sync.timelineCanvas;
    const ctx    = canvas.getContext('2d');
    const zoom   = appState.interaction.timelineZoom;
    const buffer = appState.audioBuffer;
    if (!buffer || !ctx) return;

    const vpW = dom.sync.timelineContainer.clientWidth;
    const vpH = dom.sync.timelineContainer.clientHeight;
    if (canvas.width !== vpW || canvas.height !== vpH) { canvas.width = vpW; canvas.height = vpH; }

    ctx.clearRect(0, 0, vpW, vpH);
    ctx.fillStyle = '#16161a';
    ctx.fillRect(0, 0, vpW, vpH);

    const startTime = appState.interaction.syncScrollX;
    const endTime   = startTime + vpW / zoom;

    // Grid lines (time markers)
    const secStep = zoom >= 80 ? 1 : zoom >= 40 ? 2 : 5;
    const firstSec = Math.ceil(startTime / secStep) * secStep;
    ctx.strokeStyle = '#2a2a30';
    ctx.lineWidth   = 1;
    ctx.fillStyle   = '#555';
    ctx.font        = '10px monospace';
    for (let t = firstSec; t < endTime; t += secStep) {
        const px = (t - startTime) * zoom;
        ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, vpH); ctx.stroke();
        ctx.fillText(t.toFixed(0) + 's', px + 3, vpH - 4);
    }

    // Waveform
    const data  = buffer.getChannelData(0);
    const amp   = vpH * 0.28;
    const midY  = vpH / 2;
    ctx.strokeStyle = '#3d8b5e';
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    for (let x = 0; x < vpW; x += 2) {
        const timeAtPixel = startTime + x / zoom;
        const sIdx = Math.floor(timeAtPixel * buffer.sampleRate);
        if (sIdx >= 0 && sIdx < data.length) {
            const v = data[sIdx];
            ctx.moveTo(x, midY - v * amp);
            ctx.lineTo(x, midY + v * amp);
        }
    }
    ctx.stroke();

    // Symbol range bars
    const barY = 20, barH = vpH - 40;
    appState.symbols.forEach((sym, i) => {
        let start = sym.startTime;
        let end   = sym.endTime || (i < appState.symbols.length - 1 ? appState.symbols[i + 1].startTime : buffer.duration);
        if (end <= start) end = start + 0.1;
        if (end < startTime || start > endTime) return;

        const sx    = (start - startTime) * zoom;
        const width = (end - start) * zoom;
        const isSelected = i === appState.interaction.selectedSyncIndex;
        const isPast     = i <  appState.currentSyncIndex;
        const isCurrent  = i === appState.currentSyncIndex;

        ctx.fillStyle = isPast   ? 'rgba(52,168,83,0.45)'
                      : isCurrent ? 'rgba(234,67,53,0.5)'
                      : isSelected ? 'rgba(26,115,232,0.4)'
                      : 'rgba(255,255,255,0.08)';
        ctx.fillRect(sx, barY, Math.max(2, width), barH);

        ctx.strokeStyle = isSelected ? '#FFD700' : isPast ? '#34a853' : '#555';
        ctx.lineWidth   = isSelected ? 2.5 : 1;
        ctx.strokeRect(sx, barY, Math.max(2, width), barH);

        // Number label
        if (width > 18) {
            ctx.fillStyle = isSelected ? '#FFD700' : '#ccc';
            ctx.font      = `bold ${Math.min(12, width * 0.35)}px sans-serif`;
            ctx.fillText((i + 1).toString(), sx + 4, barY + 15);
        }

        // Thumbnail in wide bars
        if (width > 50 && appState.preview.loadedImages.has(i)) {
            const img  = appState.preview.loadedImages.get(i)!;
            const th   = Math.min(barH - 20, 50);
            const tw   = th;
            const tx   = sx + (width - tw) / 2;
            const ty   = barY + (barH - th) / 2;
            ctx.save();
            ctx.globalAlpha = 0.7;
            ctx.drawImage(img, tx, ty, tw, th);
            ctx.restore();
        }
    });

    // Playhead
    const currentTime = dom.sync.audio.currentTime;
    if (currentTime >= startTime && currentTime <= endTime) {
        const px = (currentTime - startTime) * zoom;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth   = 2;
        ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, vpH); ctx.stroke();
        // Triangle head
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.moveTo(px - 5, 0); ctx.lineTo(px + 5, 0); ctx.lineTo(px, 8); ctx.closePath(); ctx.fill();
    }
}

function handleSyncTapAction() {
    if (!appState.isRecordingSync) {
        appState.isRecordingSync  = true;
        appState.currentSyncIndex = -1;
        dom.sync.visualCue.style.display          = 'flex';
        dom.sync.containerFineTuning.style.display = 'none';
        dom.sync.audio.currentTime = 0;
        dom.sync.audio.play();
        appState.symbols.forEach(s => { s.startTime = 0; s.endTime = 0; });
        updateSyncButtonUI();
    } else {
        const time         = dom.sync.audio.currentTime;
        const adjustedTime = Math.max(0, time - 0.15); // reaction-time compensation
        const idx          = appState.currentSyncIndex;

        if (idx === -1) {
            if (appState.symbols.length > 0) {
                appState.symbols[0].startTime = adjustedTime;
                appState.currentSyncIndex     = 0;
            }
        } else if (idx < appState.symbols.length) {
            appState.symbols[idx].endTime = adjustedTime;
            if (idx + 1 < appState.symbols.length)
                appState.symbols[idx + 1].startTime = adjustedTime;
            appState.currentSyncIndex++;
            if (appState.currentSyncIndex >= appState.symbols.length) finishSync();
        }
        updateSyncButtonUI();
    }
}

function updateSyncButtonUI() {
    const btn        = dom.sync.btnRecord;
    const currentIdx = appState.currentSyncIndex;

    if (currentIdx >= 0 && appState.symbols[currentIdx]) {
        dom.sync.labelProgress.textContent = `Symbol ${currentIdx + 1} / ${appState.symbols.length}`;
        dom.sync.imgCurrent.src   = appState.symbols[currentIdx].imageSrc;
        dom.sync.imgCurrent.style.opacity = '1';
    } else {
        dom.sync.labelProgress.textContent = currentIdx === -1 ? 'INTRO — wait…' : 'Complete!';
        dom.sync.imgCurrent.style.opacity  = '0';
    }

    const nextIdx = currentIdx + 1;
    if (appState.symbols[nextIdx]) {
        dom.sync.imgNext.src   = appState.symbols[nextIdx].imageSrc;
        dom.sync.imgNext.style.opacity = '1';
    } else {
        dom.sync.imgNext.style.opacity = '0.2';
    }

    if (appState.isRecordingSync) {
        btn.textContent = currentIdx === -1 ? 'TAP — Start First Symbol ▶' : 'TAP — Next Symbol ▶';
        btn.classList.add('recording');
    } else {
        btn.textContent = (appState.symbols.length > 0 && appState.symbols[0].startTime > 0)
            ? '↺ Re-record Sync'
            : '▶ Start Recording';
        btn.classList.remove('recording');
    }
}

function finishSync() {
    appState.isRecordingSync = false;
    dom.sync.audio.pause();
    dom.sync.visualCue.style.display          = 'none';
    dom.sync.containerFineTuning.style.display = 'block';
    updateSyncButtonUI();
    renderSymbolNavStrip();
    appState.interaction.selectedSyncIndex = 0;
    selectTimelineTile(0);
    showToast('Sync recorded — fine-tune on the timeline or proceed to Preview', 'success');
}

function resetSync() {
    appState.isRecordingSync  = false;
    appState.currentSyncIndex = -1;
    appState.interaction.selectedSyncIndex = -1;
    dom.sync.audio.pause(); dom.sync.audio.currentTime = 0;
    appState.symbols.forEach(s => { s.startTime = 0; s.endTime = 0; });
    dom.sync.visualCue.style.display          = 'flex';
    dom.sync.containerFineTuning.style.display = 'none';
    updateSyncButtonUI();
    showToast('Sync reset — ready to re-record');
}

function selectTimelineTile(delta: number) {
    const len = appState.symbols.length;
    if (len === 0) return;
    let newIdx = appState.interaction.selectedSyncIndex + delta;
    if (newIdx < 0) newIdx = 0;
    if (newIdx >= len) newIdx = len - 1;
    appState.interaction.selectedSyncIndex = newIdx;

    const sym  = appState.symbols[newIdx];
    const zoom = appState.interaction.timelineZoom;
    const vpW  = dom.sync.timelineContainer.clientWidth;
    appState.interaction.syncScrollX = Math.max(0, sym.startTime - (vpW / zoom) / 2);

    updateTimelineToolsUI();
    updateNavStripHighlight();
    drawSyncTimeline();
}

function nudgeSelectedTile(dt: number) {
    const idx = appState.interaction.selectedSyncIndex;
    if (idx === -1) return;
    const sym = appState.symbols[idx];
    let newStart = sym.startTime + dt;
    if (newStart < 0) newStart = 0;
    if (idx > 0 && newStart <= appState.symbols[idx - 1].startTime)
        newStart = appState.symbols[idx - 1].startTime + 0.01;
    sym.startTime = newStart;
    if (idx > 0) appState.symbols[idx - 1].endTime = newStart;
    updateTimelineToolsUI();
    drawSyncTimeline();
}

function updateTimelineToolsUI() {
    const idx       = appState.interaction.selectedSyncIndex;
    const container = dom.sync.containerProp;
    const input     = dom.sync.inputDirection;
    if (idx === -1) {
        dom.sync.labelTlSelected.textContent = 'Select a Tile';
        [dom.sync.btnNudgeLBack, dom.sync.btnNudgeSBack,
         dom.sync.btnNudgeSFwd,  dom.sync.btnNudgeLFwd].forEach(b => b.disabled = true);
        container.style.display = 'none';
    } else {
        const sym = appState.symbols[idx];
        dom.sync.labelTlSelected.textContent = `Tile ${idx + 1} @ ${sym.startTime.toFixed(2)}s`;
        [dom.sync.btnNudgeLBack, dom.sync.btnNudgeSBack,
         dom.sync.btnNudgeSFwd,  dom.sync.btnNudgeLFwd].forEach(b => b.disabled = false);
        container.style.display = 'block';
        input.value = sym.direction || '';
    }
    updateNavStripHighlight();
}

// Timeline drag
function handleTimelineMouseDown(e: MouseEvent | TouchEvent) {
    if (e.type === 'touchstart' && (e as TouchEvent).cancelable) e.preventDefault();
    const pos  = getPointerPos(e, dom.sync.timelineCanvas);
    const x    = pos.x;
    const zoom = appState.interaction.timelineZoom;
    const time = appState.interaction.syncScrollX + x / zoom;

    let closestIdx = -1;
    appState.symbols.forEach((sym, i) => {
        if (Math.abs(sym.startTime - time) < 0.2) closestIdx = i;
        else if (time > sym.startTime && time < sym.endTime) closestIdx = i;
    });

    if (closestIdx !== -1) {
        appState.interaction.timelineDragIndex  = closestIdx;
        appState.interaction.selectedSyncIndex  = closestIdx;
        appState.interaction.isDragging         = true;
        updateTimelineToolsUI();
    } else {
        appState.interaction.dragAction  = 'pan-timeline';
        appState.interaction.dragStart   = { x: pos.x, y: 0 };
        appState.interaction.isDragging  = true;
    }
    drawSyncTimeline();
}

function handleTimelineMouseMove(e: MouseEvent | TouchEvent) {
    if (e.type === 'touchmove' && (e as TouchEvent).cancelable) e.preventDefault();
    if (!appState.interaction.isDragging) return;

    const pos  = getPointerPos(e, dom.sync.timelineCanvas);
    const zoom = appState.interaction.timelineZoom;

    if (appState.interaction.dragAction === 'pan-timeline') {
        const dx = pos.x - appState.interaction.dragStart.x;
        appState.interaction.syncScrollX = Math.max(0, appState.interaction.syncScrollX - dx / zoom);
        appState.interaction.dragStart.x = pos.x;
    } else if (appState.interaction.timelineDragIndex !== -1) {
        const time = Math.max(0, appState.interaction.syncScrollX + pos.x / zoom);
        const idx  = appState.interaction.timelineDragIndex;
        appState.symbols[idx].startTime = time;
        if (idx > 0) appState.symbols[idx - 1].endTime = time;
        if (idx < appState.symbols.length - 1 && time > appState.symbols[idx + 1].startTime)
            appState.symbols[idx + 1].startTime = time + 0.01;
        updateTimelineToolsUI();
    }
    drawSyncTimeline();
}

function handleTimelineMouseUp() {
    appState.interaction.isDragging        = false;
    appState.interaction.timelineDragIndex = -1;
    appState.interaction.dragAction        = 'none';
}

// ─── Preview / Result ─────────────────────────────────────────────────────────
async function setupResultView() {
    dom.result.canvas.width = 640; dom.result.canvas.height = 360;
    appState.preview.loadedImages.clear();
    const promises = appState.symbols.map((sym, idx) => new Promise<void>(resolve => {
        const img = new Image();
        img.onload  = () => { appState.preview.loadedImages.set(idx, img); resolve(); };
        img.onerror = () => resolve();
        img.src = sym.imageSrc;
    }));
    await Promise.all(promises);
    drawPreviewFrame(0);
    showToast(`${appState.symbols.length} symbols loaded — press ▶ to preview`, 'success');
}

function playPreview() {
    if (appState.preview.isPlaying) return;
    appState.preview.isPlaying = true;
    dom.sync.audio.play();
    appState.preview.animationId = requestAnimationFrame(animatePreviewFrame);
}
function pausePreview() {
    appState.preview.isPlaying = false;
    dom.sync.audio.pause();
    cancelAnimationFrame(appState.preview.animationId);
}
function rewindPreview() {
    pausePreview();
    dom.sync.audio.currentTime = 0;
    drawPreviewFrame(0);
}
function animatePreviewFrame() {
    if (!appState.preview.isPlaying) return;
    drawPreviewFrame(dom.sync.audio.currentTime);
    appState.preview.animationId = requestAnimationFrame(animatePreviewFrame);
}

function drawPreviewFrame(rawTime: number) {
    const ctx = dom.result.canvas.getContext('2d')!;
    const w = dom.result.canvas.width, h = dom.result.canvas.height;
    const cfg  = appState.styleConfig;
    const time = Math.max(0, rawTime + appState.interaction.latencyOffset);

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = cfg.backgroundColor;
    ctx.fillRect(0, 0, w, h);

    const firstStart = appState.symbols.length > 0 ? appState.symbols[0].startTime : 0;

    // Title card
    if (appState.songTitle && time < firstStart) {
        ctx.save();
        const timeUntilStart = firstStart - time;
        const opacity = timeUntilStart < 1.0 ? timeUntilStart : 1;
        ctx.globalAlpha = Math.max(0, opacity);
        ctx.fillStyle = '#222';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = 'bold 36px sans-serif';
        ctx.fillText(appState.songTitle, w / 2, h / 2 - 22);
        ctx.font = '20px sans-serif';
        ctx.fillStyle = '#666';
        ctx.fillText('Get Ready…', w / 2, h / 2 + 28);
        ctx.restore();
    }

    let activeIndex = appState.symbols.findIndex(s => time >= s.startTime && time < (s.endTime || 99999));
    if (activeIndex === -1 && appState.symbols.length > 0 && time >= appState.symbols[appState.symbols.length - 1].startTime)
        activeIndex = appState.symbols.length - 1;

    const drawSym = (idx: number, cx: number, scale: number, opacity: number) => {
        if (!appState.preview.loadedImages.has(idx)) return;
        const img = appState.preview.loadedImages.get(idx)!;
        const size = 220 * scale;
        ctx.save();
        ctx.globalAlpha = opacity;
        ctx.shadowColor = 'rgba(0,0,0,0.18)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 4;
        const ratio = Math.min(size / img.width, size / img.height);
        const dw = img.width * ratio, dh = img.height * ratio;
        ctx.drawImage(img, cx - dw / 2, h / 2 - dh / 2, dw, dh);
        ctx.restore();
    };

    const cx = w / 2;
    if (activeIndex !== -1 || time < firstStart) {
        const start = activeIndex === -1 ? 0 : activeIndex;
        let introFade = 1.0;
        if (time < firstStart) {
            const t2s = firstStart - time;
            introFade = t2s > 1.0 ? 0 : 1.0 - t2s;
        }

        // Draw upcoming symbols (farthest first so they layer correctly)
        for (let i = cfg.nextCount; i >= 1; i--) {
            if (start + i < appState.symbols.length) {
                const s = cfg.nextScale * Math.pow(0.88, i - 1);
                const o = cfg.nextOpacity * Math.pow(0.75, i - 1) * introFade;
                drawSym(start + i, cx + i * cfg.spacing, s, o);
            }
        }

        if (activeIndex !== -1) {
            drawSym(activeIndex, cx, cfg.activeScale, 1.0);
            const sym = appState.symbols[activeIndex];
            if (sym.direction) {
                ctx.save();
                ctx.font      = 'italic 20px Georgia, serif';
                ctx.fillStyle = '#444';
                ctx.textAlign = 'center';
                ctx.fillText(sym.direction, cx, h - 28);
                ctx.restore();
            }
        } else if (introFade > 0 && appState.symbols.length > 0) {
            drawSym(0, cx, cfg.activeScale, introFade);
        }

        if (activeIndex > 0) drawSym(activeIndex - 1, cx - 240, cfg.prevScale, cfg.prevOpacity);
    }
}

// ─── Video Rendering ──────────────────────────────────────────────────────────
async function renderVideo(mode: 'full' | 'backing') {
    if (!appState.files.audioVocal && !appState.files.audioBacking) {
        showToast('No audio file loaded', 'error'); return;
    }
    dom.rendering.overlay.style.display = 'flex';
    dom.rendering.progressText.textContent = 'Initialising…';
    pausePreview();
    dom.sync.audio.currentTime = 0;

    const audioCtx = new AudioContext();
    const dest     = audioCtx.createMediaStreamDestination();
    let dur = 0;

    if (appState.files.audioVocal && mode === 'full') {
        const b = await appState.files.audioVocal.arrayBuffer().then(ab => audioCtx.decodeAudioData(ab));
        const s = audioCtx.createBufferSource(); s.buffer = b; s.connect(dest); s.start(0);
        dur = Math.max(dur, b.duration);
    }
    if (appState.files.audioBacking) {
        const b = await appState.files.audioBacking.arrayBuffer().then(ab => audioCtx.decodeAudioData(ab));
        const s = audioCtx.createBufferSource(); s.buffer = b; s.connect(dest); s.start(0);
        dur = Math.max(dur, b.duration);
    }

    const canvasStream = dom.result.canvas.captureStream(30);
    const combined     = new MediaStream([...canvasStream.getVideoTracks(), ...dest.stream.getAudioTracks()]);

    let recorder: MediaRecorder;
    try {
        let mime = 'video/webm';
        if (MediaRecorder.isTypeSupported('video/mp4'))             mime = 'video/mp4';
        else if (MediaRecorder.isTypeSupported('video/webm; codecs=vp9')) mime = 'video/webm; codecs=vp9';
        recorder = new MediaRecorder(combined, { mimeType: mime, videoBitsPerSecond: 2_500_000 });
    } catch {
        showToast('Video recording not supported in this browser', 'error');
        dom.rendering.overlay.style.display = 'none';
        return;
    }

    const chunks: BlobPart[] = [];
    recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.onstop = () => {
        const type = recorder.mimeType || 'video/webm';
        const ext  = type.includes('mp4') ? 'mp4' : 'webm';
        const blob = new Blob(chunks, { type });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href = url;
        a.download = mode === 'backing' ? `karaoke_backing.${ext}` : `karaoke_full.${ext}`;
        a.click();
        dom.rendering.overlay.style.display = 'none';
        audioCtx.close();
        showToast('Video downloaded!', 'success');
    };

    recorder.start();
    const startT = audioCtx.currentTime;
    function renderLoop() {
        const t = audioCtx.currentTime - startT;
        if (t >= dur) { recorder.stop(); return; }
        drawPreviewFrame(t);
        dom.rendering.progressText.textContent = Math.round((t / dur) * 100) + '%';
        requestAnimationFrame(renderLoop);
    }
    renderLoop();
}

window.addEventListener('load', init);
export default {};
