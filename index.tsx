import { GoogleGenAI } from "@google/genai";

// Application State
const appState = {
    currentView: 'upload-view', // upload-view, loading-view, define-symbols-view, order-view, sync-view, result-view
    songTitle: '', // New: Store song title
    files: {
        images: [] as File[],
        audioVocal: null as File | null,
        audioBacking: null as File | null,
        pdf: null as File | null
    },
    // pages now includes 'sequence' array for order
    pages: [] as { image: HTMLImageElement, width: number, height: number, symbols: any[], sequence: number[] }[],
    currentPageIndex: 0,
    symbols: [] as any[], // Flat list for Sync/Result
    isRecordingSync: false,
    currentSyncIndex: 0, // Used during recording
    syncData: [] as { symbolIndex: number, time: number }[],
    audioBuffer: null as AudioBuffer | null, // Decoded audio for waveform
    stats: {
        avgDuration: 0
    },
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
        timelineZoom: 100, // pixels per second (higher default for detail)
        timelineDragIndex: -1,
        selectedSyncIndex: -1, // Currently selected tile in timeline for editing
        syncScrollX: 0, // TIME (seconds) at left edge of timeline view
        lastTouchDistance: 0, // For pinch zoom
        latencyOffset: 0.0 // Global playback offset
    },
    preview: {
        isPlaying: false,
        animationId: 0,
        startTime: 0,
        loadedImages: new Map<number, HTMLImageElement>()
    }
};

// DOM Elements
let dom = {} as any;

function init() {
    // Map DOM elements
    dom = {
        views: {
            upload: document.getElementById('upload-view'),
            loading: document.getElementById('loading-view'),
            define: document.getElementById('define-symbols-view'),
            order: document.getElementById('order-view'),
            sync: document.getElementById('sync-view'),
            result: document.getElementById('result-view'),
        },
        upload: {
            dropZone: document.getElementById('unified-drop-zone'),
            input: document.getElementById('unified-file-input'),
            btnBrowse: document.querySelector('.browse-btn'),
            btnGenerate: document.getElementById('generate-button'),
            statusSongboard: document.getElementById('status-songboard'),
            statusVocal: document.getElementById('status-vocal'),
            statusBacking: document.getElementById('status-backing'),
            cardSongboard: document.getElementById('card-songboard'),
            cardVocal: document.getElementById('card-vocal'),
            cardBacking: document.getElementById('card-backing'),
            titleInput: document.getElementById('input-song-title')
        },
        define: {
            canvasContainer: document.getElementById('define-canvas-container'),
            canvas: document.getElementById('define-canvas') as HTMLCanvasElement,
            ctx: (document.getElementById('define-canvas') as HTMLCanvasElement)?.getContext('2d'),
            btnPrev: document.getElementById('btn-prev-page'),
            btnNext: document.getElementById('btn-next-page'),
            labelPage: document.getElementById('page-indicator'),
            btnClear: document.getElementById('btn-clear-page'),
            btnAuto: document.getElementById('btn-autocomplete-grid'),
            btnSelectColor: document.getElementById('btn-select-matching-color'),
            btnGoOrder: document.getElementById('btn-goto-order'),
            btnZoomIn: document.getElementById('btn-zoom-in'),
            btnZoomOut: document.getElementById('btn-zoom-out'),
            btnDelete: document.getElementById('btn-delete-symbol'),
            inputSensitivity: document.getElementById('grid-sensitivity'),
            labelSensitivity: document.getElementById('grid-sensitivity-val'),
            btnPanUp: document.getElementById('btn-pan-up'),
            btnPanDown: document.getElementById('btn-pan-down')
        },
        order: {
            canvasContainer: document.getElementById('order-canvas-container'),
            canvas: document.getElementById('order-canvas') as HTMLCanvasElement,
            ctx: (document.getElementById('order-canvas') as HTMLCanvasElement)?.getContext('2d'),
            btnPrev: document.getElementById('btn-order-prev-page'),
            btnNext: document.getElementById('btn-order-next-page'),
            labelPage: document.getElementById('order-page-indicator'),
            btnAuto: document.getElementById('btn-auto-order'),
            btnReset: document.getElementById('btn-reset-order'),
            btnBack: document.getElementById('btn-back-to-define'),
            btnFinish: document.getElementById('btn-finish-order'),
            btnPanUp: document.getElementById('btn-order-pan-up'),
            btnPanDown: document.getElementById('btn-order-pan-down')
        },
        sync: {
            containerFineTuning: document.getElementById('sync-fine-tuning'),
            visualCue: document.getElementById('sync-visual-cue'),
            timelineContainer: document.getElementById('sync-timeline-container'),
            timelineCanvas: document.getElementById('sync-timeline-canvas') as HTMLCanvasElement,
            btnRecord: document.getElementById('record-tap-button'),
            audio: document.getElementById('sync-audio-player') as HTMLAudioElement,
            labelProgress: document.getElementById('sync-progress-text'),
            btnReset: document.getElementById('reset-sync-button'),
            btnBack: document.getElementById('back-to-order-from-sync'),
            btnFinish: document.getElementById('btn-finish-sync'),
            btnZoomIn: document.getElementById('btn-sync-zoom-in'),
            btnZoomOut: document.getElementById('btn-sync-zoom-out'),
            imgCurrent: document.getElementById('sync-img-current') as HTMLImageElement,
            imgNext: document.getElementById('sync-img-next') as HTMLImageElement,
            // Symbol Nav Strip
            navStrip: document.getElementById('symbol-nav-strip'),
            // Timeline Tools
            btnTlPrev: document.getElementById('btn-tl-prev'),
            btnTlNext: document.getElementById('btn-tl-next'),
            btnNudgeLBack: document.getElementById('btn-tl-nudge-l-back'),
            btnNudgeSBack: document.getElementById('btn-tl-nudge-s-back'),
            btnNudgeSFwd: document.getElementById('btn-tl-nudge-s-fwd'),
            btnNudgeLFwd: document.getElementById('btn-tl-nudge-l-fwd'),
            labelTlSelected: document.getElementById('tl-selected-info'),
            // Direction Input
            containerProp: document.getElementById('sync-symbol-properties'),
            inputDirection: document.getElementById('input-sync-direction')
        },
        result: {
            canvas: document.getElementById('preview-canvas') as HTMLCanvasElement,
            btnPlay: document.getElementById('btn-play-preview'),
            btnPause: document.getElementById('btn-pause-preview'),
            btnRewind: document.getElementById('btn-rewind-preview'),
            btnDownloadFull: document.getElementById('download-full-mix'),
            btnDownloadBacking: document.getElementById('download-backing'),
            btnBack: document.getElementById('back-to-sync-from-result'),
            btnReset: document.getElementById('reset-button'),
            // Latency Slider (Moved to Result View)
            latencySlider: document.getElementById('latency-slider'),
            latencyVal: document.getElementById('latency-val'),
            // Style Controls
            styleBg: document.getElementById('style-bg-color'),
            styleActiveScale: document.getElementById('style-active-scale'),
            styleNextCount: document.getElementById('style-next-count'),
            styleNextScale: document.getElementById('style-next-scale'),
            styleNextOpacity: document.getElementById('style-next-opacity'),
            styleSpacing: document.getElementById('style-spacing')
        },
        rendering: {
            overlay: document.getElementById('rendering-overlay'),
            progressText: document.getElementById('rendering-progress-text')
        },
        loadingMessage: document.getElementById('loading-message'),
        errorBox: document.getElementById('error-box')
    };

    setupEventListeners();
}

function setupEventListeners() {
    // --- Upload View ---
    dom.upload.dropZone.addEventListener('click', (e: Event) => {
        if (e.target !== dom.upload.input) dom.upload.input.click();
    });
    dom.upload.btnBrowse.addEventListener('click', (e: Event) => {
        e.stopPropagation();
        dom.upload.input.click();
    });
    dom.upload.input.addEventListener('change', (e: Event) => handleFiles((e.target as HTMLInputElement).files));
    dom.upload.dropZone.addEventListener('dragover', (e: DragEvent) => { e.preventDefault(); dom.upload.dropZone.classList.add('drag-over'); });
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
    
    // Assignment swapping logic
    const handleAudioCardClick = (type: 'vocal' | 'backing') => {
        const other = type === 'vocal' ? 'backing' : 'vocal';
        const cardType = type === 'vocal' ? dom.upload.cardVocal : dom.upload.cardBacking;
        const cardOther = type === 'vocal' ? dom.upload.cardBacking : dom.upload.cardVocal;
        
        if (cardType.classList.contains('selected')) {
            cardType.classList.remove('selected'); // Deselect
        } else {
            // Select this one
            if (cardOther.classList.contains('selected')) {
                // Swap!
                const temp = appState.files.audioVocal;
                appState.files.audioVocal = appState.files.audioBacking;
                appState.files.audioBacking = temp;
                
                // Update UI
                dom.upload.statusVocal.textContent = appState.files.audioVocal ? appState.files.audioVocal.name : "No audio loaded";
                dom.upload.statusBacking.textContent = appState.files.audioBacking ? appState.files.audioBacking.name : "No audio loaded";
                
                dom.upload.cardVocal.classList.toggle('filled', !!appState.files.audioVocal);
                dom.upload.cardBacking.classList.toggle('filled', !!appState.files.audioBacking);
                
                cardOther.classList.remove('selected');
            } else {
                cardType.classList.add('selected');
            }
        }
    };
    dom.upload.cardVocal.addEventListener('click', () => handleAudioCardClick('vocal'));
    dom.upload.cardBacking.addEventListener('click', () => handleAudioCardClick('backing'));


    // --- Define View ---
    dom.define.btnPrev.addEventListener('click', () => changePage(-1));
    dom.define.btnNext.addEventListener('click', () => changePage(1));
    dom.define.btnAuto.addEventListener('click', runGridDetection);
    dom.define.btnClear.addEventListener('click', clearCurrentPageSymbols);
    dom.define.btnGoOrder.addEventListener('click', () => switchView('order-view'));
    dom.define.btnSelectColor.addEventListener('click', selectSimilarColors);
    dom.define.btnZoomIn.addEventListener('click', () => changeZoom(0.1));
    dom.define.btnZoomOut.addEventListener('click', () => changeZoom(-0.1));
    dom.define.btnDelete.addEventListener('click', deleteSelectedSymbols);
    dom.define.inputSensitivity.addEventListener('input', (e: Event) => {
        const val = parseInt((e.target as HTMLInputElement).value);
        appState.gridConfig.contentThreshold = val;
        dom.define.labelSensitivity.textContent = val > 240 ? "High" : val > 200 ? "Medium" : "Low";
        runGridDetection(); // Auto re-detect on slider change
    });
    dom.define.btnPanUp.addEventListener('click', () => dom.define.canvasContainer.scrollBy({top: -100, behavior: 'smooth'}));
    dom.define.btnPanDown.addEventListener('click', () => dom.define.canvasContainer.scrollBy({top: 100, behavior: 'smooth'}));

    // --- Order View ---
    dom.order.btnPrev.addEventListener('click', () => { changePage(-1); setupOrderView(); });
    dom.order.btnNext.addEventListener('click', () => { changePage(1); setupOrderView(); });
    dom.order.btnAuto.addEventListener('click', autoOrderPage);
    dom.order.btnReset.addEventListener('click', resetOrderPage);
    dom.order.btnBack.addEventListener('click', () => switchView('define-symbols-view'));
    dom.order.btnFinish.addEventListener('click', finishOrderingSymbols);
    dom.order.btnPanUp.addEventListener('click', () => dom.order.canvasContainer.scrollBy({top: -100, behavior: 'smooth'}));
    dom.order.btnPanDown.addEventListener('click', () => dom.order.canvasContainer.scrollBy({top: 100, behavior: 'smooth'}));


    // --- Sync View (Waveform) ---
    dom.sync.btnRecord.addEventListener('click', handleSyncTapAction); 
    dom.sync.btnReset.addEventListener('click', resetSync);
    dom.sync.btnBack.addEventListener('click', () => switchView('order-view'));
    dom.sync.btnFinish.addEventListener('click', () => switchView('result-view'));
    dom.sync.btnZoomIn.addEventListener('click', () => { appState.interaction.timelineZoom += 20; drawSyncTimeline(); });
    dom.sync.btnZoomOut.addEventListener('click', () => { appState.interaction.timelineZoom = Math.max(20, appState.interaction.timelineZoom - 20); drawSyncTimeline(); });
    
    // Timeline Tools
    dom.sync.btnTlPrev.addEventListener('click', () => selectTimelineTile(-1));
    dom.sync.btnTlNext.addEventListener('click', () => selectTimelineTile(1));
    
    // Nudge Buttons (New)
    dom.sync.btnNudgeLBack.addEventListener('click', () => nudgeSelectedTile(-0.5));
    dom.sync.btnNudgeSBack.addEventListener('click', () => nudgeSelectedTile(-0.01));
    dom.sync.btnNudgeSFwd.addEventListener('click', () => nudgeSelectedTile(0.01));
    dom.sync.btnNudgeLFwd.addEventListener('click', () => nudgeSelectedTile(0.5));

    // Direction Input Listener
    dom.sync.inputDirection.addEventListener('input', (e: Event) => {
        const idx = appState.interaction.selectedSyncIndex;
        if (idx !== -1 && appState.symbols[idx]) {
            appState.symbols[idx].direction = (e.target as HTMLInputElement).value;
        }
    });


    // --- Result View ---
    dom.result.btnBack.addEventListener('click', () => switchView('sync-view'));
    dom.result.btnReset.addEventListener('click', () => window.location.reload());
    dom.result.btnPlay.addEventListener('click', playPreview);
    dom.result.btnPause.addEventListener('click', pausePreview);
    dom.result.btnRewind.addEventListener('click', rewindPreview);
    dom.result.btnDownloadFull.addEventListener('click', () => renderVideo('full'));
    dom.result.btnDownloadBacking.addEventListener('click', () => renderVideo('backing'));
    // Latency Slider (Global Correction)
    dom.result.latencySlider.addEventListener('input', (e: Event) => {
        const val = parseInt((e.target as HTMLInputElement).value);
        appState.interaction.latencyOffset = val / 1000;
        dom.result.latencyVal.textContent = (val / 1000).toFixed(2);
        if (!appState.preview.isPlaying) drawPreviewFrame(dom.sync.audio.currentTime);
    });

    // Style Inputs
    const updateStyle = () => {
        appState.styleConfig.backgroundColor = dom.result.styleBg.value;
        appState.styleConfig.activeScale = parseFloat(dom.result.styleActiveScale.value);
        appState.styleConfig.nextCount = parseInt(dom.result.styleNextCount.value);
        appState.styleConfig.nextScale = parseFloat(dom.result.styleNextScale.value);
        appState.styleConfig.nextOpacity = parseFloat(dom.result.styleNextOpacity.value);
        appState.styleConfig.spacing = parseInt(dom.result.styleSpacing.value);
        if (!appState.preview.isPlaying) drawPreviewFrame(dom.sync.audio.currentTime);
    };
    dom.result.styleBg.addEventListener('input', updateStyle);
    dom.result.styleActiveScale.addEventListener('input', updateStyle);
    dom.result.styleNextCount.addEventListener('input', updateStyle);
    dom.result.styleNextScale.addEventListener('input', updateStyle);
    dom.result.styleNextOpacity.addEventListener('input', updateStyle);
    dom.result.styleSpacing.addEventListener('input', updateStyle);

    // Canvas Events
    setupCanvasInteractions();
    
    // Global Keyboard
    window.addEventListener('keydown', (e) => {
        if (appState.currentView === 'define-symbols-view' && (e.key === 'Delete' || e.key === 'Backspace')) deleteSelectedSymbols();
        if (appState.currentView === 'sync-view' && (e.key === ' ' || e.key === 'Enter')) {
             e.preventDefault();
             handleSyncTapAction();
        }
    });
}

// Helper for unified touch/mouse coordinates
function getPointerPos(e: MouseEvent | TouchEvent, canvas: HTMLCanvasElement) {
    const rect = canvas.getBoundingClientRect();
    let clientX, clientY;
    
    if ((e as TouchEvent).touches && (e as TouchEvent).touches.length > 0) {
        clientX = (e as TouchEvent).touches[0].clientX;
        clientY = (e as TouchEvent).touches[0].clientY;
    } else {
        clientX = (e as MouseEvent).clientX;
        clientY = (e as MouseEvent).clientY;
    }
    
    return {
        x: clientX - rect.left,
        y: clientY - rect.top
    };
}

function setupCanvasInteractions() {
    // Define View Canvas
    dom.define.canvas.addEventListener('mousedown', handleDefineCanvasDown);
    dom.define.canvas.addEventListener('mousemove', handleDefineCanvasMove);
    dom.define.canvas.addEventListener('touchstart', handleDefineCanvasDown, { passive: false });
    dom.define.canvas.addEventListener('touchmove', handleDefineCanvasMove, { passive: false });
    dom.define.canvas.addEventListener('touchend', handleDefineCanvasUp);
    
    window.addEventListener('mouseup', handleDefineCanvasUp);

    // Order View Canvas
    dom.order.canvas.addEventListener('mousedown', handleOrderCanvasClick);
    dom.order.canvas.addEventListener('touchstart', handleOrderCanvasClick, { passive: false });
    // Add touchmove listener to order canvas for pinch zoom support
    dom.order.canvas.addEventListener('touchmove', (e: TouchEvent) => {
        if (e.touches.length === 2) {
            e.preventDefault();
            handlePinchZoom(e);
        }
    }, { passive: false });


    // Sync Timeline Canvas (The new main editor)
    dom.sync.timelineCanvas.addEventListener('mousedown', handleTimelineMouseDown);
    dom.sync.timelineCanvas.addEventListener('touchstart', handleTimelineMouseDown, { passive: false });
    
    // Window for smooth dragging
    window.addEventListener('mousemove', handleTimelineMouseMove);
    window.addEventListener('touchmove', handleTimelineMouseMove, { passive: false });
    window.addEventListener('mouseup', handleTimelineMouseUp);
    window.addEventListener('touchend', handleTimelineMouseUp);
}

// Pinch Zoom Logic
function handlePinchZoom(e: TouchEvent) {
    if (e.touches.length !== 2) return;
    
    const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
    );
    
    if (appState.interaction.lastTouchDistance > 0) {
        const delta = dist - appState.interaction.lastTouchDistance;
        if (Math.abs(delta) > 5) {
             const zoomDelta = delta > 0 ? 0.05 : -0.05;
             changeZoom(zoomDelta);
             appState.interaction.lastTouchDistance = dist;
        }
    } else {
        appState.interaction.lastTouchDistance = dist;
    }
}


// --- File Handling ---
async function handleFiles(fileList: FileList | null | undefined) {
    if (!fileList) return;
    const files = Array.from(fileList);
    dom.errorBox.style.display = 'none';

    for (const file of files) {
        const type = file.type;
        const name = file.name.toLowerCase();
        if (type.startsWith('audio/') || name.endsWith('.mp3') || name.endsWith('.wav')) {
            // Check for keywords
            const isBacking = name.includes('backing') || name.includes('inst') || name.includes('karaoke');
            const isVocal = name.includes('vocal') || name.includes('full') || name.includes('mix') || name.includes('demo');

            if (isBacking && !appState.files.audioBacking) {
                appState.files.audioBacking = file;
                dom.upload.statusBacking.textContent = file.name;
                dom.upload.cardBacking.classList.add('filled');
            } else if (isVocal && !appState.files.audioVocal) {
                appState.files.audioVocal = file;
                dom.upload.statusVocal.textContent = file.name;
                dom.upload.cardVocal.classList.add('filled');
            } else {
                // Fallback
                 if (!appState.files.audioVocal) {
                    appState.files.audioVocal = file;
                    dom.upload.statusVocal.textContent = file.name;
                    dom.upload.cardVocal.classList.add('filled');
                } else if (!appState.files.audioBacking) {
                    appState.files.audioBacking = file;
                    dom.upload.statusBacking.textContent = file.name;
                    dom.upload.cardBacking.classList.add('filled');
                }
            }

        } else if (type === 'application/pdf' || name.endsWith('.pdf')) {
            appState.files.pdf = file;
            dom.upload.statusSongboard.textContent = file.name;
            dom.upload.cardSongboard.classList.add('filled');
        } else if (type.startsWith('image/')) {
            appState.files.images.push(file);
            dom.upload.statusSongboard.textContent = `${appState.files.images.length} images loaded`;
            dom.upload.cardSongboard.classList.add('filled');
        }
    }
    checkReadyToStart();
}

function checkReadyToStart() {
    const hasVisuals = appState.files.pdf || appState.files.images.length > 0;
    const hasAudio = !!appState.files.audioVocal || !!appState.files.audioBacking;
    dom.upload.btnGenerate.disabled = !(hasVisuals && hasAudio);
}

async function startProject() {
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
            dom.sync.audio.src = URL.createObjectURL(syncFile);
            // Decode audio for waveform
            const ctx = new AudioContext();
            const buffer = await syncFile.arrayBuffer();
            appState.audioBuffer = await ctx.decodeAudioData(buffer);
            ctx.close();
        }

        switchView('define-symbols-view');
        setTimeout(() => { resizeCanvas(); drawCanvas(); }, 100);
    } catch (e) {
        console.error(e);
        dom.errorBox.textContent = "Error: " + e.message;
        dom.errorBox.style.display = 'block';
        switchView('upload-view');
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
    if (!pdfjsLib) throw new Error("PDF.js library is not loaded.");
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    
    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 2.0 });
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        await page.render({ canvasContext: context, viewport: viewport }).promise;
        const img = new Image();
        img.src = canvas.toDataURL('image/png');
        await new Promise(r => img.onload = r);
        appState.pages.push({ image: img, width: canvas.width, height: canvas.height, symbols: [], sequence: [] });
        dom.loadingMessage.textContent = `Processed page ${i} of ${pdf.numPages}`;
    }
}

// --- View Management ---
function switchView(viewId: string) {
    Object.values(dom.views).forEach((el: HTMLElement) => el.style.display = 'none');
    dom.views[viewId === 'upload-view' ? 'upload' : 
              viewId === 'loading-view' ? 'loading' :
              viewId === 'define-symbols-view' ? 'define' :
              viewId === 'order-view' ? 'order' :
              viewId === 'sync-view' ? 'sync' : 'result'].style.display = 'block';
    appState.currentView = viewId;
    
    if (viewId === 'define-symbols-view') setTimeout(resizeCanvas, 50);
    if (viewId === 'order-view') setTimeout(setupOrderView, 50);
    if (viewId === 'sync-view') setupSyncView();
    if (viewId === 'result-view') setupResultView();
}

// --- Define Symbols Logic ---
function changeZoom(delta: number) {
    appState.interaction.zoomLevel = Math.max(0.5, Math.min(3.0, appState.interaction.zoomLevel + delta));
    resizeCanvas(); drawCanvas();
}
function changePage(delta: number) {
    const newIndex = appState.currentPageIndex + delta;
    if (newIndex >= 0 && newIndex < appState.pages.length) {
        appState.currentPageIndex = newIndex;
        appState.interaction.selectedIndices.clear();
        updateToolbarUI();
        dom.define.labelPage.textContent = `Page ${newIndex + 1} / ${appState.pages.length}`;
        dom.order.labelPage.textContent = `Page ${newIndex + 1} / ${appState.pages.length}`;
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
        updateToolbarUI();
        drawCanvas();
    }
}
function deleteSelectedSymbols() {
    const page = appState.pages[appState.currentPageIndex];
    if (!page || appState.interaction.selectedIndices.size === 0) return;
    const indicesToDelete = Array.from(appState.interaction.selectedIndices).sort((a, b) => b - a);
    indicesToDelete.forEach(index => {
        page.symbols.splice(index, 1);
        // Also remove from sequence if present
        page.sequence = page.sequence.filter(i => i !== index).map(i => i > index ? i - 1 : i);
    });
    appState.interaction.selectedIndices.clear();
    appState.interaction.isDragging = false;
    updateToolbarUI();
    drawCanvas();
}
function selectSimilarColors() {
    const page = appState.pages[appState.currentPageIndex];
    if (appState.interaction.selectedIndices.size === 0) {
        alert("Select a tile first to find matches.");
        return;
    }
    // Get color of first selected
    const firstIdx = appState.interaction.selectedIndices.values().next().value;
    const targetSym = page.symbols[firstIdx];
    
    // Optimized: Create canvas once for the whole page
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = page.width;
    tempCanvas.height = page.height;
    const ctx = tempCanvas.getContext('2d');
    if (!ctx) return;
    
    ctx.drawImage(page.image, 0, 0);
    const fullImageData = ctx.getImageData(0, 0, page.width, page.height).data;
    
    // Helper to get color from full image data
    const getColorFromData = (s: any) => {
        const cx = Math.floor(s.x + s.width / 2);
        const cy = Math.floor(s.y + s.height / 2);
        const index = (cy * page.width + cx) * 4;
        return [fullImageData[index], fullImageData[index+1], fullImageData[index+2]];
    };

    const targetColor = getColorFromData(targetSym);

    page.symbols.forEach((sym, idx) => {
        const c = getColorFromData(sym);
        // Simple distance
        const dist = Math.sqrt(Math.pow(c[0]-targetColor[0], 2) + Math.pow(c[1]-targetColor[1], 2) + Math.pow(c[2]-targetColor[2], 2));
        if (dist < 50) appState.interaction.selectedIndices.add(idx);
    });
    updateToolbarUI();
    drawCanvas();
}
function updateToolbarUI() {
    const count = appState.interaction.selectedIndices.size;
    dom.define.btnDelete.textContent = count > 0 ? `Delete Selected (${count})` : "Delete Selected";
}
function resizeCanvas() {
    const page = appState.pages[appState.currentPageIndex];
    if (!page) return;
    dom.define.canvas.width = page.width * appState.interaction.zoomLevel;
    dom.define.canvas.height = page.height * appState.interaction.zoomLevel;
    drawCanvas();
}
function drawCanvas() {
    const ctx = dom.define.ctx;
    const page = appState.pages[appState.currentPageIndex];
    if (!page || !ctx) return;
    ctx.save();
    ctx.scale(appState.interaction.zoomLevel, appState.interaction.zoomLevel);
    ctx.clearRect(0, 0, page.width, page.height);
    ctx.drawImage(page.image, 0, 0);
    
    ctx.lineWidth = 4 / appState.interaction.zoomLevel;
    page.symbols.forEach((s: any, idx: number) => {
        if (appState.interaction.selectedIndices.has(idx)) {
            ctx.strokeStyle = '#00ffff'; ctx.fillStyle = 'rgba(0, 255, 255, 0.2)';
        } else {
            ctx.strokeStyle = '#2b7de9'; ctx.fillStyle = 'rgba(43, 125, 233, 0.1)';
        }
        ctx.beginPath(); ctx.rect(s.x, s.y, s.width, s.height);
        ctx.fill(); ctx.stroke();
    });
    ctx.restore();
    // Marquee
    if (appState.interaction.dragAction === 'marquee' && appState.interaction.isDragging) {
         const {marqueeStart: s, marqueeCurrent: c} = appState.interaction;
         const x = Math.min(s.x, c.x) * appState.interaction.zoomLevel;
         const y = Math.min(s.y, c.y) * appState.interaction.zoomLevel;
         const w = Math.abs(c.x - s.x) * appState.interaction.zoomLevel;
         const h = Math.abs(c.y - s.y) * appState.interaction.zoomLevel;
         ctx.save(); ctx.strokeStyle = '#1a73e8'; ctx.setLineDash([5, 5]); ctx.strokeRect(x, y, w, h); ctx.restore();
    }
}
function runGridDetection() {
    const page = appState.pages[appState.currentPageIndex];
    if (!page) return;
    page.symbols = []; // Clear previous
    page.sequence = [];

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = page.width; tempCanvas.height = page.height;
    const ctx = tempCanvas.getContext('2d');
    ctx.drawImage(page.image, 0, 0);
    const data = ctx.getImageData(0, 0, page.width, page.height).data;
    const w = page.width; const h = page.height;
    const threshold = appState.gridConfig.contentThreshold;

    // Simplified Grid Logic
    let rows = [], inRow = false, startY = 0;
    for (let y = 0; y < h; y++) {
        let count = 0;
        for (let x=0; x<w; x+=5) if (data[(y*w+x)*4] < threshold) count++;
        if (count > w*0.005) { if(!inRow) { inRow=true; startY=y; } }
        else { if(inRow) { inRow=false; if(y-startY > 20) rows.push({s:startY, e:y}); } }
    }
    if(inRow) rows.push({s:startY, e:h});

    rows.forEach(r => {
        let inCol = false, startX = 0;
        for (let x=0; x<w; x++) {
            let count=0;
            for (let y=r.s; y<r.e; y+=5) if (data[(y*w+x)*4] < threshold) count++;
            if (count > (r.e-r.s)*0.01) { if(!inCol) { inCol=true; startX=x; } }
            else { if(inCol) { inCol=false; if(x-startX > 20) page.symbols.push({x:startX, y:r.s, width:x-startX, height:r.e-r.s}); } }
        }
        if(inCol && w-startX>20) page.symbols.push({x:startX, y:r.s, width:w-startX, height:r.e-r.s});
    });
    drawCanvas();
}
function handleDefineCanvasDown(e: MouseEvent | TouchEvent) {
    if (e.type === 'touchstart') {
        if ((e as TouchEvent).touches.length === 2) {
            appState.interaction.lastTouchDistance = 0;
            return;
        }
        e.preventDefault();
    }

    const pos = getPointerPos(e, dom.define.canvas);
    const scale = appState.interaction.zoomLevel;
    const x = pos.x / scale;
    const y = pos.y / scale;
    
    const page = appState.pages[appState.currentPageIndex];
    let hitIndex = page.symbols.findIndex((s: any) => x >= s.x && x <= s.x + s.width && y >= s.y && y <= s.y + s.height);

    if (hitIndex !== -1) {
        if (e.shiftKey) {
            if (appState.interaction.selectedIndices.has(hitIndex)) appState.interaction.selectedIndices.delete(hitIndex);
            else appState.interaction.selectedIndices.add(hitIndex);
        } else {
            if (!appState.interaction.selectedIndices.has(hitIndex)) {
                appState.interaction.selectedIndices.clear();
                appState.interaction.selectedIndices.add(hitIndex);
            }
        }
        appState.interaction.dragAction = 'move';
        appState.interaction.dragStart = {x, y};
    } else {
        if (!e.shiftKey) appState.interaction.selectedIndices.clear();
        appState.interaction.dragAction = 'marquee';
        appState.interaction.marqueeStart = {x, y};
        appState.interaction.marqueeCurrent = {x, y};
        appState.interaction.initialSelection = new Set(appState.interaction.selectedIndices);
    }
    appState.interaction.isDragging = true;
    drawCanvas(); updateToolbarUI();
}
function handleDefineCanvasMove(e: MouseEvent | TouchEvent) {
    if (e.type === 'touchmove') {
        if ((e as TouchEvent).touches.length === 2) {
             e.preventDefault();
             handlePinchZoom(e as TouchEvent);
             return;
        }
        e.preventDefault();
    }
    if (!appState.interaction.isDragging) return;
    
    const pos = getPointerPos(e, dom.define.canvas);
    const scale = appState.interaction.zoomLevel;
    const x = pos.x / scale;
    const y = pos.y / scale;
    const page = appState.pages[appState.currentPageIndex];

    if (appState.interaction.dragAction === 'move') {
        const dx = x - appState.interaction.dragStart.x;
        const dy = y - appState.interaction.dragStart.y;
        appState.interaction.selectedIndices.forEach(idx => {
            page.symbols[idx].x += dx; page.symbols[idx].y += dy;
        });
        appState.interaction.dragStart = {x, y};
    } else if (appState.interaction.dragAction === 'marquee') {
        appState.interaction.marqueeCurrent = {x, y};
        const s = appState.interaction.marqueeStart;
        const mx = Math.min(s.x, x), my = Math.min(s.y, y), mw = Math.abs(x-s.x), mh = Math.abs(y-s.y);
        appState.interaction.selectedIndices = new Set(appState.interaction.initialSelection);
        page.symbols.forEach((sym: any, i: number) => {
            if (mx < sym.x + sym.width && mx + mw > sym.x && my < sym.y + sym.height && my + mh > sym.y) {
                appState.interaction.selectedIndices.add(i);
            }
        });
        updateToolbarUI();
    }
    drawCanvas();
}
function handleDefineCanvasUp() {
    appState.interaction.isDragging = false;
    appState.interaction.dragAction = 'none';
    drawCanvas();
}

// --- Order View Logic ---
function setupOrderView() {
    const page = appState.pages[appState.currentPageIndex];
    if (!page) return;
    // Fit to width mostly
    const containerW = dom.order.canvasContainer.clientWidth;
    const scale = containerW / page.width;
    dom.order.canvas.width = page.width * scale;
    dom.order.canvas.height = page.height * scale;
    drawOrderCanvas();
}
function drawOrderCanvas() {
    const ctx = dom.order.ctx;
    const page = appState.pages[appState.currentPageIndex];
    const canvas = dom.order.canvas;
    const scale = canvas.width / page.width;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(page.image, 0, 0, canvas.width, canvas.height);

    // Draw lines connecting sequence
    if (page.sequence.length > 1) {
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(234, 67, 53, 0.6)';
        ctx.lineWidth = 3;
        const startSym = page.symbols[page.sequence[0]];
        ctx.moveTo((startSym.x + startSym.width/2) * scale, (startSym.y + startSym.height/2) * scale);
        
        for (let i = 1; i < page.sequence.length; i++) {
            const sym = page.symbols[page.sequence[i]];
            ctx.lineTo((sym.x + sym.width/2) * scale, (sym.y + sym.height/2) * scale);
        }
        ctx.stroke();
    }

    page.symbols.forEach((sym, idx) => {
        const x = sym.x * scale, y = sym.y * scale, w = sym.width * scale, h = sym.height * scale;
        const seqIdx = page.sequence.indexOf(idx);
        
        ctx.strokeStyle = '#999';
        if (seqIdx !== -1) {
            ctx.fillStyle = 'rgba(52, 168, 83, 0.3)';
            ctx.strokeStyle = '#34a853';
            ctx.lineWidth = 3;
        } else {
             ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
             ctx.lineWidth = 1;
        }
        
        ctx.fillRect(x, y, w, h);
        ctx.strokeRect(x, y, w, h);

        if (seqIdx !== -1) {
            // Draw Badge
            ctx.fillStyle = '#34a853';
            ctx.beginPath();
            ctx.arc(x + w - 15, y + 15, 12, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = 'white';
            ctx.font = 'bold 12px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText((seqIdx + 1).toString(), x + w - 15, y + 19);
        }
    });
}
function handleOrderCanvasClick(e: MouseEvent | TouchEvent) {
    if (e.type === 'touchstart') {
        if ((e as TouchEvent).touches.length === 2) return; // Allow pinch gesture logic
        e.preventDefault();
    }
    
    const pos = getPointerPos(e, dom.order.canvas);
    const page = appState.pages[appState.currentPageIndex];
    const scale = dom.order.canvas.width / page.width;
    const x = pos.x / scale;
    const y = pos.y / scale;

    const hitIdx = page.symbols.findIndex((s: any) => x >= s.x && x <= s.x + s.width && y >= s.y && y <= s.y + s.height);
    if (hitIdx !== -1) {
        const currentSeqIdx = page.sequence.indexOf(hitIdx);
        if (currentSeqIdx !== -1) {
            // Remove if already there
            page.sequence.splice(currentSeqIdx, 1);
        } else {
            // Add to end
            page.sequence.push(hitIdx);
        }
        drawOrderCanvas();
    }
}
function autoOrderPage() {
    const page = appState.pages[appState.currentPageIndex];
    const indices = page.symbols.map((_, i) => i);
    // Sort by Y, then X
    indices.sort((a, b) => {
        const sA = page.symbols[a], sB = page.symbols[b];
        const yDiff = Math.abs(sA.y - sB.y);
        return yDiff > 50 ? sA.y - sB.y : sA.x - sB.x;
    });
    page.sequence = indices;
    drawOrderCanvas();
}
function resetOrderPage() {
    appState.pages[appState.currentPageIndex].sequence = [];
    drawOrderCanvas();
}
function finishOrderingSymbols() {
    appState.symbols = [];
    appState.pages.forEach((page, pIdx) => {
        // Use defined sequence, or fallback to auto if empty
        let order = page.sequence.length > 0 ? page.sequence : page.symbols.map((_, i) => i);
        
        order.forEach(symIdx => {
            const sym = page.symbols[symIdx];
            const canvas = document.createElement('canvas');
            canvas.width = sym.width; canvas.height = sym.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(page.image, sym.x, sym.y, sym.width, sym.height, 0, 0, sym.width, sym.height);
            
            appState.symbols.push({
                globalIndex: appState.symbols.length,
                pageIndex: pIdx,
                imageSrc: canvas.toDataURL(),
                startTime: 0,
                endTime: 0,
                direction: '', // Initialize direction
                ...sym
            });
        });
    });

    if (appState.symbols.length === 0) {
        alert("No symbols selected! Please select symbols in order.");
        return;
    }
    setupSyncView();
    switchView('sync-view');
}

// --- Sync Logic (New Waveform Editor) ---
function setupSyncView() {
    appState.currentSyncIndex = -1; // -1 means Waiting for First Tap (Intro Mode)
    appState.isRecordingSync = false;
    appState.interaction.selectedSyncIndex = -1;
    appState.interaction.syncScrollX = 0; // Reset scroll
    
    // Initial State: Recording Mode
    // Show Visual Cue
    dom.sync.visualCue.style.display = 'flex';
    // Hide Fine Tuning Tools
    dom.sync.containerFineTuning.style.display = 'none';
    
    updateSyncButtonUI();
    renderSymbolNavStrip(); // Prepare, but hidden
    updateTimelineToolsUI();
    
    // Draw initial empty timeline (hidden)
    drawSyncTimeline();
    
    // If playing, update frame
    if (appState.preview.animationId) cancelAnimationFrame(appState.preview.animationId);
    
    const animate = () => {
        if(appState.currentView === 'sync-view') {
            const t = dom.sync.audio.currentTime;
            
            // Auto-scroll logic for Viewport
            if (!appState.interaction.isDragging && (appState.isRecordingSync || !dom.sync.audio.paused)) {
                 const zoom = appState.interaction.timelineZoom;
                 const viewportW = dom.sync.timelineContainer.clientWidth;
                 const widthInSecs = viewportW / zoom;
                 
                 // Keep playhead in middle 50%
                 if (t > appState.interaction.syncScrollX + widthInSecs * 0.8) {
                     appState.interaction.syncScrollX = t - widthInSecs * 0.2;
                 }
            }
            drawSyncTimeline();
            appState.preview.animationId = requestAnimationFrame(animate);
        }
    };
    appState.preview.animationId = requestAnimationFrame(animate);
}

// NEW: Render the Symbol Navigation Strip
function renderSymbolNavStrip() {
    const container = dom.sync.navStrip;
    container.innerHTML = ''; // Clear

    appState.symbols.forEach((sym, idx) => {
        const div = document.createElement('div');
        div.className = 'nav-symbol-item';
        div.id = `nav-sym-${idx}`;
        
        const img = document.createElement('img');
        img.src = sym.imageSrc;
        
        const badge = document.createElement('div');
        badge.className = 'number-badge';
        badge.textContent = (idx + 1).toString();
        
        div.appendChild(img);
        div.appendChild(badge);
        
        div.addEventListener('click', () => {
             // Jump to this symbol
             appState.interaction.selectedSyncIndex = idx;
             selectTimelineTile(0); // This helper centers the view on the selection
        });
        
        container.appendChild(div);
    });
}

// NEW: Update Highlight in Strip
function updateNavStripHighlight() {
    const idx = appState.interaction.selectedSyncIndex;
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
    const ctx = canvas.getContext('2d');
    const zoom = appState.interaction.timelineZoom;
    const buffer = appState.audioBuffer;
    
    if(!buffer || !ctx) return;
    
    // Viewport Size
    const viewportW = dom.sync.timelineContainer.clientWidth;
    const viewportH = dom.sync.timelineContainer.clientHeight;
    
    // Ensure canvas matches visual size
    if (canvas.width !== viewportW || canvas.height !== viewportH) {
        canvas.width = viewportW;
        canvas.height = viewportH;
    }
    
    ctx.clearRect(0, 0, viewportW, viewportH);
    ctx.fillStyle = '#1a1a1e';
    ctx.fillRect(0,0,viewportW, viewportH);
    
    // Determine Time Range to Draw
    const startTime = appState.interaction.syncScrollX;
    const endTime = startTime + (viewportW / zoom);
    
    // Draw Waveform for visible range
    ctx.strokeStyle = '#555';
    ctx.beginPath();
    const data = buffer.getChannelData(0);
    const amp = viewportH / 3;
    const midY = viewportH / 2;
    
    // Map pixels to audio samples
    // optimization: step > 1 if high zoom
    const pixelsPerSample = zoom / buffer.sampleRate;
    
    // Draw loop: iterate pixels x from 0 to viewportW
    for(let x=0; x<viewportW; x+=2) {
        const timeAtPixel = startTime + (x / zoom);
        const sIdx = Math.floor(timeAtPixel * buffer.sampleRate);
        
        if (sIdx >= 0 && sIdx < data.length) {
            const v = data[sIdx];
            ctx.moveTo(x, midY - v*amp);
            ctx.lineTo(x, midY + v*amp);
        }
    }
    ctx.stroke();
    
    // Draw Range Bars (Symbols)
    const barY = 30;
    const barH = viewportH - 60;
    
    appState.symbols.forEach((sym, i) => {
        let start = sym.startTime;
        let end = sym.endTime;
        
        // If end not set, default to next start
        if (!end) end = (i < appState.symbols.length-1) ? appState.symbols[i+1].startTime : buffer.duration;
        if (end <= start) end = start + 0.1;
        
        // Culling: check if visible
        if (end < startTime || start > endTime) return;
        
        const sx = (start - startTime) * zoom;
        const width = (end - start) * zoom;
        
        // Color coding
        if (i < appState.currentSyncIndex) ctx.fillStyle = 'rgba(52, 168, 83, 0.6)'; // Past: Green
        else if (i === appState.currentSyncIndex) ctx.fillStyle = 'rgba(234, 67, 53, 0.6)'; // Current: Red
        else ctx.fillStyle = 'rgba(255, 255, 255, 0.1)'; // Future: Gray
        
        ctx.fillRect(sx, barY, Math.max(2, width), barH);
        
        // Border & Handle
        if (i === appState.interaction.selectedSyncIndex) {
            ctx.strokeStyle = '#FFD700';
            ctx.lineWidth = 3;
        } else {
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 1;
        }
        ctx.strokeRect(sx, barY, Math.max(2, width), barH);
        
        // Text Label
        if (width > 20) {
            ctx.fillStyle = '#fff';
            ctx.font = '12px sans-serif';
            ctx.fillText((i+1).toString(), sx + 5, barY + 20);
        }
    });
    
    // Playhead
    const currentTime = dom.sync.audio.currentTime;
    if (currentTime >= startTime && currentTime <= endTime) {
        const px = (currentTime - startTime) * zoom;
        ctx.strokeStyle = '#fff'; 
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, viewportH); ctx.stroke();
    }
}

function handleSyncTapAction() {
    if (!appState.isRecordingSync) {
        // Start Recording
        appState.isRecordingSync = true;
        appState.currentSyncIndex = -1; // Wait for first tap (Intro mode)
        
        // UI: Recording Mode Active
        dom.sync.visualCue.style.display = 'flex';
        dom.sync.containerFineTuning.style.display = 'none';
        
        dom.sync.audio.currentTime = 0;
        dom.sync.audio.play();
        
        // Reset timings to 0 (will be overwritten)
        appState.symbols.forEach(s => { s.startTime = 0; s.endTime = 0; });
        updateSyncButtonUI();
    } else {
        // Tap to Advance
        const time = dom.sync.audio.currentTime;
        // Reaction Time compensation (recording only)
        const reactionComp = -0.15; 
        const adjustedTime = Math.max(0, time + reactionComp);
        
        const idx = appState.currentSyncIndex;
        
        if (idx === -1) {
            // First Tap: End Intro, Start Symbol 0
            if (appState.symbols.length > 0) {
                 appState.symbols[0].startTime = adjustedTime;
                 appState.currentSyncIndex = 0;
            }
        } else if (idx < appState.symbols.length) {
            // End current, start next
            appState.symbols[idx].endTime = adjustedTime;
            if (idx + 1 < appState.symbols.length) {
                appState.symbols[idx + 1].startTime = adjustedTime;
            }
            appState.currentSyncIndex++;
            
            if (appState.currentSyncIndex >= appState.symbols.length) {
                finishSync();
            }
        }
        updateSyncButtonUI();
    }
}

function updateSyncButtonUI() {
    const btn = dom.sync.btnRecord;
    
    // Update visual preview cue
    const currentIdx = appState.currentSyncIndex;
    if (currentIdx >= 0 && appState.symbols[currentIdx]) {
        dom.sync.labelProgress.textContent = `Symbol ${currentIdx + 1} / ${appState.symbols.length}`;
        dom.sync.imgCurrent.src = appState.symbols[currentIdx].imageSrc;
        dom.sync.imgCurrent.style.opacity = "1";
    } else {
        // Intro or End
        dom.sync.labelProgress.textContent = currentIdx === -1 ? "INTRO (Wait...)" : "Finished";
        dom.sync.imgCurrent.style.opacity = "0";
    }
    
    // Show Next
    const nextIdx = currentIdx + 1;
    if (appState.symbols[nextIdx]) {
        dom.sync.imgNext.src = appState.symbols[nextIdx].imageSrc;
        dom.sync.imgNext.style.opacity = "1";
    } else {
        dom.sync.imgNext.style.opacity = "0.2"; 
    }

    if (appState.isRecordingSync) {
        if (currentIdx === -1) {
            btn.textContent = "TAP TO START FIRST SYMBOL ➡";
        } else {
            btn.textContent = "TAP TO PLACE NEXT ➡";
        }
        btn.classList.add('recording');
    } else {
        // Not recording
        // If we have data (post-sync), show "Re-record"
        if (appState.symbols.length > 0 && appState.symbols[0].startTime > 0) {
             btn.textContent = "RE-RECORD SYNC ↺";
        } else {
             btn.textContent = "START RECORDING (TAP) ▶";
        }
        btn.classList.remove('recording');
    }
}

function finishSync() {
    appState.isRecordingSync = false;
    dom.sync.audio.pause();
    
    // Transition to Edit Mode
    dom.sync.visualCue.style.display = 'none';
    dom.sync.containerFineTuning.style.display = 'block';
    
    updateSyncButtonUI();
    renderSymbolNavStrip(); // Refresh strip
    // Select first symbol to start editing
    appState.interaction.selectedSyncIndex = 0;
    selectTimelineTile(0);
}
function resetSync() {
    appState.isRecordingSync = false;
    appState.currentSyncIndex = -1;
    appState.interaction.selectedSyncIndex = -1;
    dom.sync.audio.pause(); dom.sync.audio.currentTime = 0;
    // Reset all times
    appState.symbols.forEach(s => { s.startTime = 0; s.endTime = 0; });
    
    // Reset UI to Record Mode
    dom.sync.visualCue.style.display = 'flex';
    dom.sync.containerFineTuning.style.display = 'none';
    
    updateSyncButtonUI();
}

// Timeline Navigation Functions
function selectTimelineTile(delta: number) {
    const len = appState.symbols.length;
    if (len === 0) return;
    
    let newIdx = appState.interaction.selectedSyncIndex + delta;
    if (newIdx < 0) newIdx = 0;
    if (newIdx >= len) newIdx = len - 1;
    
    appState.interaction.selectedSyncIndex = newIdx;
    
    // Auto-scroll to tile
    const sym = appState.symbols[newIdx];
    // Center it in Viewport
    const zoom = appState.interaction.timelineZoom;
    const viewportW = dom.sync.timelineContainer.clientWidth;
    const widthInSecs = viewportW / zoom;
    appState.interaction.syncScrollX = Math.max(0, sym.startTime - widthInSecs / 2);
    
    updateTimelineToolsUI();
    updateNavStripHighlight(); // Update the strip logic
    drawSyncTimeline();
}

function nudgeSelectedTile(dt: number) {
    const idx = appState.interaction.selectedSyncIndex;
    if (idx === -1) return;
    
    const sym = appState.symbols[idx];
    let newStart = sym.startTime + dt;
    if (newStart < 0) newStart = 0;
    
    // Check previous end
    if (idx > 0) {
        if (newStart <= appState.symbols[idx-1].startTime) newStart = appState.symbols[idx-1].startTime + 0.01;
    }
    
    sym.startTime = newStart;
    // Update prev end
    if (idx > 0) appState.symbols[idx-1].endTime = newStart;
    
    updateTimelineToolsUI();
    drawSyncTimeline();
}

function updateTimelineToolsUI() {
    const idx = appState.interaction.selectedSyncIndex;
    const container = dom.sync.containerProp;
    const input = dom.sync.inputDirection;
    
    if (idx === -1) {
        dom.sync.labelTlSelected.textContent = "Select a Tile";
        dom.sync.btnNudgeLBack.disabled = true;
        dom.sync.btnNudgeSBack.disabled = true;
        dom.sync.btnNudgeSFwd.disabled = true;
        dom.sync.btnNudgeLFwd.disabled = true;
        container.style.display = 'none';
    } else {
        const sym = appState.symbols[idx];
        const t = sym.startTime.toFixed(2);
        dom.sync.labelTlSelected.textContent = `Tile ${idx+1} @ ${t}s`;
        dom.sync.btnNudgeLBack.disabled = false;
        dom.sync.btnNudgeSBack.disabled = false;
        dom.sync.btnNudgeSFwd.disabled = false;
        dom.sync.btnNudgeLFwd.disabled = false;
        
        // Show Direction Input
        container.style.display = 'block';
        input.value = sym.direction || '';
    }
    updateNavStripHighlight(); // Sync strip highlight
}

// Timeline Drag Logic
function handleTimelineMouseDown(e: MouseEvent | TouchEvent) {
    if (e.type === 'touchstart') e.preventDefault();
    const pos = getPointerPos(e, dom.sync.timelineCanvas);
    const x = pos.x;
    
    const zoom = appState.interaction.timelineZoom;
    const time = appState.interaction.syncScrollX + (x / zoom);
    
    // Find closest symbol start line
    let closestIdx = -1;

    appState.symbols.forEach((sym, i) => {
        // Start handle check (tolerance 0.2s)
        if (Math.abs(sym.startTime - time) < 0.2) {
             closestIdx = i;
        } else if (time > sym.startTime && time < sym.endTime) {
             // Clicked inside
             closestIdx = i;
        }
    });

    if (closestIdx !== -1) {
        appState.interaction.timelineDragIndex = closestIdx;
        appState.interaction.selectedSyncIndex = closestIdx;
        appState.interaction.isDragging = true;
        updateTimelineToolsUI();
    } else {
        // Drag Background to Pan
        appState.interaction.dragAction = 'pan-timeline';
        appState.interaction.dragStart = {x: pos.x, y: 0};
        appState.interaction.isDragging = true;
    }
    drawSyncTimeline();
}

function handleTimelineMouseMove(e: MouseEvent | TouchEvent) {
    if (e.type === 'touchmove') e.preventDefault();
    if (!appState.interaction.isDragging) return;
    
    const pos = getPointerPos(e, dom.sync.timelineCanvas);
    const zoom = appState.interaction.timelineZoom;
    
    if (appState.interaction.dragAction === 'pan-timeline') {
        const dx = pos.x - appState.interaction.dragStart.x;
        const dt = dx / zoom;
        appState.interaction.syncScrollX = Math.max(0, appState.interaction.syncScrollX - dt);
        appState.interaction.dragStart.x = pos.x;
    } else if (appState.interaction.timelineDragIndex !== -1) {
        const x = pos.x;
        const time = Math.max(0, appState.interaction.syncScrollX + (x / zoom));
        const idx = appState.interaction.timelineDragIndex;
        
        // Adjust start time of clicked symbol
        appState.symbols[idx].startTime = time;
        // And end time of previous
        if (idx > 0) appState.symbols[idx-1].endTime = time;
        
        // Don't overlap next
        if (idx < appState.symbols.length - 1 && time > appState.symbols[idx+1].startTime) {
             appState.symbols[idx+1].startTime = time + 0.01;
        }
        updateTimelineToolsUI();
    }
    
    drawSyncTimeline();
}

function handleTimelineMouseUp() {
    appState.interaction.isDragging = false;
    appState.interaction.timelineDragIndex = -1;
    appState.interaction.dragAction = 'none';
}

// --- Preview Logic ---
async function setupResultView() {
    dom.result.canvas.width = 640; dom.result.canvas.height = 360;
    appState.preview.loadedImages.clear();
    const promises = appState.symbols.map((sym, idx) => new Promise<void>((resolve) => {
        const img = new Image();
        img.onload = () => { appState.preview.loadedImages.set(idx, img); resolve(); };
        img.onerror = () => resolve(); img.src = sym.imageSrc;
    }));
    await Promise.all(promises);
    drawPreviewFrame(0);
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
    pausePreview(); dom.sync.audio.currentTime = 0; drawPreviewFrame(0);
}
function animatePreviewFrame() {
    if (!appState.preview.isPlaying) return;
    const t = dom.sync.audio.currentTime;
    drawPreviewFrame(t);
    appState.preview.animationId = requestAnimationFrame(animatePreviewFrame);
}
function drawPreviewFrame(rawTime: number) {
    const ctx = dom.result.canvas.getContext('2d');
    const w = dom.result.canvas.width;
    const h = dom.result.canvas.height;
    const cfg = appState.styleConfig;
    
    // Apply Latency (Global Correction)
    const time = Math.max(0, rawTime + appState.interaction.latencyOffset);

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = cfg.backgroundColor;
    ctx.fillRect(0, 0, w, h);

    // Title Card / Intro Logic
    const firstStart = appState.symbols.length > 0 ? appState.symbols[0].startTime : 0;
    
    if (appState.songTitle && time < firstStart) {
        // Draw Title Card
        ctx.save();
        // Fade out in last 1 second before first symbol
        const timeUntilStart = firstStart - time;
        let opacity = 1;
        if (timeUntilStart < 1.0) opacity = timeUntilStart; 
        
        ctx.globalAlpha = Math.max(0, opacity);
        ctx.fillStyle = '#333';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        // Title
        ctx.font = 'bold 36px sans-serif';
        ctx.fillText(appState.songTitle, w/2, h/2 - 20);
        
        // Subtitle/Hint
        ctx.font = '20px sans-serif';
        ctx.fillStyle = '#666';
        ctx.fillText("Get Ready...", w/2, h/2 + 30);
        
        ctx.restore();
    }

    // Logic to determine active index based on start/end times
    let activeIndex = appState.symbols.findIndex(s => time >= s.startTime && time < (s.endTime || 99999));
    
    // Fallback logic if gaps or pre-start
    if (activeIndex === -1) {
         if (appState.symbols.length > 0 && time < appState.symbols[0].startTime) {
             // Pre-start: activeIndex remains -1
         }
         else if (appState.symbols.length > 0 && time > appState.symbols[appState.symbols.length-1].startTime) activeIndex = appState.symbols.length - 1; // End
    }

    const drawSym = (idx: number, cx: number, scale: number, opacity: number) => {
        if (!appState.preview.loadedImages.has(idx)) return;
        const img = appState.preview.loadedImages.get(idx);
        const baseSize = 220;
        const size = baseSize * scale;
        ctx.save();
        ctx.globalAlpha = opacity;
        ctx.shadowColor = 'rgba(0,0,0,0.2)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 5;
        
        const ratio = Math.min(size/img.width, size/img.height);
        const dw = img.width * ratio, dh = img.height * ratio;
        ctx.drawImage(img, cx - dw/2, (h/2) - dh/2, dw, dh);
        ctx.restore();
    };

    const cx = w/2;
    // Draw Next
    if (activeIndex !== -1 || time < firstStart) {
        const start = activeIndex === -1 ? 0 : activeIndex;
        
        // Only draw next if NOT in deep intro (optional, but requested behavior is standard conveyor)
        // If we want title card to be alone, we can fade these in too.
        // Let's fade them in same rate as title fades out.
        let introFadeIn = 1.0;
        if (time < firstStart) {
            const timeUntilStart = firstStart - time;
            if (timeUntilStart > 1.0) introFadeIn = 0; // Hidden until last second
            else introFadeIn = 1.0 - timeUntilStart; // Fade in
        }

        for (let i = cfg.nextCount; i >= 1; i--) {
            if (start + i < appState.symbols.length) {
                const s = cfg.nextScale * Math.pow(0.9, i-1);
                const o = cfg.nextOpacity * Math.pow(0.8, i-1) * introFadeIn;
                drawSym(start+i, cx + (i * cfg.spacing), s, o);
            }
        }
        
        // Draw Active
        if (activeIndex !== -1) {
            drawSym(activeIndex, cx, cfg.activeScale, 1.0);
            
            // Draw Musical Direction (New)
            const sym = appState.symbols[activeIndex];
            if (sym.direction) {
                ctx.save();
                ctx.font = 'italic 20px Georgia, serif';
                ctx.fillStyle = '#444';
                ctx.textAlign = 'center';
                ctx.fillText(sym.direction, cx, h - 30);
                ctx.restore();
            }

        } else if (introFadeIn > 0 && appState.symbols.length > 0) {
             // Fade in first symbol as title fades out
             drawSym(0, cx, cfg.activeScale, introFadeIn);
        }
        
        // Draw Prev
        if (activeIndex > 0) drawSym(activeIndex-1, cx - 240, cfg.prevScale, cfg.prevOpacity);
    }
}

// --- Video Rendering ---
async function renderVideo(mode: 'full' | 'backing') {
    if (!appState.files.audioVocal && !appState.files.audioBacking) { alert("No audio!"); return; }
    dom.rendering.overlay.style.display = 'flex';
    dom.rendering.progressText.textContent = "Initializing...";
    pausePreview();
    dom.sync.audio.currentTime = 0;

    const audioCtx = new AudioContext();
    const dest = audioCtx.createMediaStreamDestination();
    
    // Setup Audio Sources
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
    const combined = new MediaStream([...canvasStream.getVideoTracks(), ...dest.stream.getAudioTracks()]);
    
    let recorder;
    try {
        // iOS Safari Support Check
        let mime = "video/webm";
        if (MediaRecorder.isTypeSupported("video/mp4")) {
            mime = "video/mp4";
        } else if (MediaRecorder.isTypeSupported("video/webm; codecs=vp9")) {
            mime = "video/webm; codecs=vp9";
        }
        
        recorder = new MediaRecorder(combined, { mimeType: mime, videoBitsPerSecond: 2500000 });
    } catch (e) { alert("Recording not supported or codec missing."); return; }
    
    const chunks: BlobPart[] = [];
    recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.onstop = () => {
        const type = recorder.mimeType || "video/webm";
        const ext = type.includes("mp4") ? "mp4" : "webm";
        const blob = new Blob(chunks, { type: type });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = mode === 'backing' ? `karaoke_backing.${ext}` : `karaoke_full.${ext}`;
        a.click();
        dom.rendering.overlay.style.display = 'none';
        audioCtx.close();
    };

    recorder.start();
    const startT = audioCtx.currentTime;
    function renderLoop() {
        const t = audioCtx.currentTime - startT;
        if (t >= dur) { recorder.stop(); return; }
        // Use t directly (latency offset handles inside drawPreviewFrame logic)
        drawPreviewFrame(t);
        dom.rendering.progressText.textContent = Math.round((t/dur)*100) + "%";
        requestAnimationFrame(renderLoop);
    }
    renderLoop();
}

window.addEventListener('load', init);
export default {};