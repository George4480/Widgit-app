import { GoogleGenAI } from "@google/genai";
import * as pdfjsLib from "pdfjs-dist";
import { jsPDF } from "jspdf";
import JSZip from "jszip";
import { saveAs } from "file-saver";
// @ts-ignore
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.js?url";
import { SymbolTile, ProjectPage, SyncTiming, StyleConfig, GridConfig, AppState, ProjectSaveData, SequenceStep } from "./src/types";

// Set PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

// Undo/Redo Stacks
const undoStack: string[] = [];
const redoStack: string[] = [];

// Object URL Memory Cleaner
const activeObjectUrls = new Set<string>();

function createLocalUrl(file: File | Blob): string {
    const url = URL.createObjectURL(file);
    activeObjectUrls.add(url);
    return url;
}

function revokeAllLocalUrls() {
    activeObjectUrls.forEach(url => URL.revokeObjectURL(url));
    activeObjectUrls.clear();
}

// Application State
const appState: AppState = {
    currentView: 'upload-view', // upload-view, loading-view, define-symbols-view, order-view, sync-view, result-view
    mode: 'karaoke', // 'karaoke' | 'board'
    songTitle: '', // Store song title
    files: {
        images: [] as File[],
        audioVocal: null as File | null,
        audioBacking: null as File | null,
        pdf: null as File | null
    },
    pages: [] as ProjectPage[],
    currentPageIndex: 0,
    globalSequence: [] as SequenceStep[], // Canonical cross-page reading order
    symbols: [] as SymbolTile[], // Flat list for Sync/Result
    isRecordingSync: false,
    currentSyncIndex: 0, // Used during recording
    syncData: [] as SyncTiming[],
    audioBuffer: null as AudioBuffer | null, // Decoded audio for waveform
    stats: {
        avgDuration: 0
    },
    gridConfig: {
        rowBreakThreshold: 50,
        colBreakThreshold: 10,
        minSymbolWidth: 20,
        minSymbolHeight: 20,
        contentThreshold: 245
    },
    styleConfig: {
        backgroundColor: '#f0f8ff',
        activeScale: 1.1,
        nextCount: 2,
        nextScale: 0.7,
        nextOpacity: 0.7,
        spacing: 200,
        prevCount: 1,
        prevScale: 0.7,
        prevOpacity: 0.4,
        roundEnabled: false,
        roundVoices: 2,
        roundGap: 4
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
        timelineZoom: 100, // pixels per second
        timelineDragIndex: -1,
        selectedSyncIndex: -1, // Currently selected tile in timeline
        syncScrollX: 0, // TIME at left edge of timeline
        lastTouchDistance: 0, // For pinch zoom
        latencyOffset: 0.0 // Global playback offset
    },
    preview: {
        isPlaying: false,
        animationId: 0,
        startTime: 0,
        loadedImages: new Map<number, HTMLImageElement>()
    },
    aiModeEnabled: false // Optional AI Mode is disabled by default
};

// DOM Elements
let dom = {} as any;

function init() {
    // Map DOM elements
    dom = {
        global: {
            btnUndo: document.getElementById('btn-global-undo'),
            btnRedo: document.getElementById('btn-global-redo'),
            btnSave: document.getElementById('btn-global-save'),
            btnLoad: document.getElementById('btn-global-load'),
            inputLoad: document.getElementById('input-global-load'),
            btnToggleTheme: document.getElementById('btn-toggle-theme'),
            btnToggleContrast: document.getElementById('btn-toggle-high-contrast'),
            btnToggleMotion: document.getElementById('btn-toggle-reduced-motion'),
            btnHelp: document.getElementById('btn-global-help'),
            helpPanel: document.getElementById('global-help-panel'),
            btnToggleAiMode: document.getElementById('btn-toggle-ai-mode'),
            aiCreatorInputs: document.getElementById('ai-creator-inputs'),
            aiModeToggleContainer: document.getElementById('ai-mode-toggle-container'),
            btnExportManifest: document.getElementById('btn-export-manifest'),
        },
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
            btnCreateBoard: document.getElementById('btn-create-board'),
            btnClearUploads: document.getElementById('btn-clear-uploads'),
            statusSongboard: document.getElementById('status-songboard'),
            statusVocal: document.getElementById('status-vocal'),
            statusBacking: document.getElementById('status-backing'),
            cardSongboard: document.getElementById('card-songboard'),
            cardVocal: document.getElementById('card-vocal'),
            cardBacking: document.getElementById('card-backing'),
            listSongboard: document.getElementById('list-songboard'),
            listVocal: document.getElementById('list-vocal'),
            listBacking: document.getElementById('list-backing'),
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
            btnPanDown: document.getElementById('btn-pan-down'),
            
            // Tools containers
            karaokeTools: document.getElementById('karaoke-tools'),
            boardTools: document.getElementById('board-tools'),
            btnAddTile: document.getElementById('btn-add-tile'),
            btnDownloadPdf: document.getElementById('btn-download-pdf'),
            btnDownloadZip: document.getElementById('btn-download-zip'),
            
            // AI Creator
            aiPrompt: document.getElementById('ai-prompt'),
            btnAiGenerate: document.getElementById('btn-ai-generate'),
            btnAiEdit: document.getElementById('btn-ai-edit'),
            btnUploadSymbol: document.getElementById('btn-upload-symbol'),
            inputUploadSymbol: document.getElementById('input-upload-symbol'),
            aiLoading: document.getElementById('ai-loading'),
            aiMultiToggle: document.getElementById('ai-multi-toggle')
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
            btnPanDown: document.getElementById('btn-order-pan-down'),
            sequenceStrip: document.getElementById('order-sequence-strip'),
            audio: document.getElementById('order-audio-player') as HTMLAudioElement
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
            styleNextScale: document.getElementById('style-next-scale'),
            styleNextOpacity: document.getElementById('style-next-opacity'),
            stylePrevScale: document.getElementById('style-prev-scale'),
            stylePrevOpacity: document.getElementById('style-prev-opacity'),
            styleSpacing: document.getElementById('style-spacing'),
            styleRoundEnabled: document.getElementById('style-round-enabled'),
            styleRoundGap: document.getElementById('style-round-gap'),
            roundSettings: document.getElementById('round-settings')
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
    // --- Workflow Stepper (jump back to completed steps) ---
    document.querySelectorAll('#progress-stepper .stepper-step').forEach(btn => {
        btn.addEventListener('click', () => {
            const target = (btn as HTMLElement).dataset.stepView;
            if (target && !(btn as HTMLButtonElement).disabled) switchView(target);
        });
    });

    // --- Global Controls ---
    if (dom.global) {
        dom.global.btnUndo.addEventListener('click', historyUndo);
        dom.global.btnRedo.addEventListener('click', historyRedo);
        dom.global.btnSave.addEventListener('click', () => confirmExport(saveProjectJson));
        dom.global.btnLoad.addEventListener('click', triggerProjectLoad);
        dom.global.inputLoad.addEventListener('change', handleProjectLoadFile);
        
        // Theme (light/dark) toggle. Class lives on <html> so the pre-paint
        // head script and this handler agree; choice persists in localStorage.
        const isDarkActive = () => {
            const root = document.documentElement;
            if (root.classList.contains('dark-mode')) return true;
            if (root.classList.contains('light-mode')) return false;
            return window.matchMedia('(prefers-color-scheme: dark)').matches;
        };
        const syncThemeButton = () => {
            dom.global.btnToggleTheme.textContent = isDarkActive() ? "☀️ Light" : "🌙 Dark";
        };
        syncThemeButton();
        dom.global.btnToggleTheme.addEventListener('click', () => {
            const goDark = !isDarkActive();
            const root = document.documentElement;
            root.classList.toggle('dark-mode', goDark);
            root.classList.toggle('light-mode', !goDark);
            try { localStorage.setItem('wm-theme', goDark ? 'dark' : 'light'); } catch (e) {}
            syncThemeButton();
        });

        dom.global.btnToggleContrast.addEventListener('click', () => {
            document.body.classList.toggle('high-contrast');
            const active = document.body.classList.contains('high-contrast');
            dom.global.btnToggleContrast.textContent = active ? "☀️ Normal" : "👁️ Contrast";
        });
        
        dom.global.btnToggleMotion.addEventListener('click', () => {
            document.body.classList.toggle('reduced-motion');
            const active = document.body.classList.contains('reduced-motion');
            dom.global.btnToggleMotion.textContent = active ? "🏃‍♂️ Normal" : "🏃‍♂️ Motion";
        });
        
        dom.global.btnHelp.addEventListener('click', () => {
            const panel = dom.global.helpPanel;
            const isHidden = panel.style.display === 'none';
            panel.style.display = isHidden ? 'block' : 'none';
            dom.global.btnHelp.style.backgroundColor = isHidden ? 'var(--primary)' : 'var(--primary-soft)';
            dom.global.btnHelp.style.color = isHidden ? '#fff' : 'var(--primary-text)';
        });

        dom.global.btnToggleAiMode.addEventListener('click', () => {
            appState.aiModeEnabled = !appState.aiModeEnabled;
            const enabled = appState.aiModeEnabled;
            dom.global.aiCreatorInputs.style.display = enabled ? 'block' : 'none';
            dom.global.btnToggleAiMode.textContent = enabled ? "Disable AI Mode" : "Enable AI Mode";
            dom.global.aiModeToggleContainer.style.backgroundColor = enabled ? 'var(--primary-soft)' : 'var(--surface)';
            dom.global.aiModeToggleContainer.style.borderColor = enabled ? 'var(--primary)' : 'var(--border)';
        });

        dom.global.btnExportManifest.addEventListener('click', () => confirmExport(exportProjectManifest));
    }

    // --- Upload View ---
    const triggerUpload = () => {
        // Create a new input on each click to prevent iOS/Safari file invalidation
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.accept = 'audio/*,.mp3,.wav,application/pdf,.pdf,image/*';
        input.style.display = 'none';
        document.body.appendChild(input);
        
        input.addEventListener('change', (e: Event) => {
            handleFiles((e.target as HTMLInputElement).files);
            document.body.removeChild(input); // Cleanup
        });
        input.click();
    };

    dom.upload.dropZone.addEventListener('click', (e: Event) => {
        // Only trigger if we aren't clicking labels or inputs explicitly
        if ((e.target as HTMLElement).tagName !== 'INPUT') {
            triggerUpload();
        }
    });
    dom.upload.btnBrowse.addEventListener('click', (e: Event) => {
        e.stopPropagation();
        triggerUpload();
    });
    // Remove old input listener as we no longer use it
    
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
    dom.upload.btnCreateBoard.addEventListener('click', startBoardMode);
    dom.upload.btnClearUploads.addEventListener('click', () => {
        const f = appState.files;
        const hasFiles = !!f.pdf || f.images.length > 0 || !!f.audioVocal || !!f.audioBacking;
        if (!hasFiles) { resetUploads(); return; }
        showConfirm({
            title: '🗑️ Clear all uploads?',
            message: 'This removes every image, PDF and audio file you\'ve added so far. You\'ll need to upload them again.',
            confirmText: 'Clear uploads',
            onConfirm: resetUploads,
        });
    });
    
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
    dom.define.btnClear.addEventListener('click', () => {
        const page = appState.pages[appState.currentPageIndex];
        if (!page || page.symbols.length === 0) { clearCurrentPageSymbols(); return; }
        showConfirm({
            title: '🗑️ Clear all tiles on this page?',
            message: `This removes all <strong>${page.symbols.length}</strong> tile(s) defined on this page, along with their ordering. This can't be undone.`,
            confirmText: 'Clear tiles',
            onConfirm: clearCurrentPageSymbols,
        });
    });
    dom.define.btnGoOrder.addEventListener('click', () => switchView('order-view'));
    dom.define.btnSelectColor.addEventListener('click', selectSimilarColors);
    dom.define.btnZoomIn.addEventListener('click', () => changeZoom(0.1));
    dom.define.btnZoomOut.addEventListener('click', () => changeZoom(-0.1));
    dom.define.btnDelete.addEventListener('click', deleteSelectedSymbols);
    dom.define.inputSensitivity.addEventListener('input', (e: Event) => {
        const val = parseInt((e.target as HTMLInputElement).value);
        appState.gridConfig.contentThreshold = val;
        dom.define.labelSensitivity.textContent = val > 245 ? "Very High" : val > 230 ? "High" : val > 200 ? "Medium" : "Low";
        runGridDetection(); // Auto re-detect on slider change
    });
    dom.define.btnPanUp.addEventListener('click', () => dom.define.canvasContainer.scrollBy({top: -100, behavior: 'smooth'}));
    dom.define.btnPanDown.addEventListener('click', () => dom.define.canvasContainer.scrollBy({top: 100, behavior: 'smooth'}));
    
    // Board Mode Buttons
    dom.define.btnAddTile.addEventListener('click', addEmptyTile);
    dom.define.btnDownloadPdf.addEventListener('click', downloadBoardPdf);
    dom.define.btnDownloadZip.addEventListener('click', downloadBoardImages);

    // AI Creator Events
    dom.define.btnAiGenerate.addEventListener('click', generateAiSymbol);
    dom.define.btnAiEdit.addEventListener('click', editAiSymbol);
    dom.define.btnUploadSymbol.addEventListener('click', () => dom.define.inputUploadSymbol.click());
    dom.define.inputUploadSymbol.addEventListener('change', (e: Event) => handleSymbolUpload((e.target as HTMLInputElement).files));
    
    // AI Chips
    const chipsContainer = document.getElementById('ai-prompt-chips');
    if (chipsContainer) {
        chipsContainer.querySelectorAll('.chip').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const text = (e.target as HTMLElement).textContent;
                const promptInput = dom.define.aiPrompt as HTMLTextAreaElement;
                promptInput.value = text || '';
                promptInput.focus();
            });
        });
    }


    // --- Order View ---
    dom.order.btnPrev.addEventListener('click', () => { changePage(-1); setupOrderView(); });
    dom.order.btnNext.addEventListener('click', () => { changePage(1); setupOrderView(); });
    dom.order.btnAuto.addEventListener('click', autoOrderPage);
    dom.order.btnReset.addEventListener('click', () => {
        const pageIdx = appState.currentPageIndex;
        const hasStepsHere = appState.globalSequence.some(s => s.page === pageIdx);
        if (!hasStepsHere) { resetOrderPage(); return; }
        showConfirm({
            title: '↩️ Clear this page from the order?',
            message: 'This removes only this page\'s tiles from the reading order. Steps on other pages and the tiles themselves are kept.',
            confirmText: 'Clear this page',
            onConfirm: resetOrderPage,
        });
    });
    dom.order.btnBack.addEventListener('click', () => switchView('define-symbols-view'));
    dom.order.btnFinish.addEventListener('click', () => {
        // If the user already recorded timings and came back to re-order,
        // finishing again rebuilds the tile list and would wipe that work.
        const hasTimings = appState.symbols.some(s => (s.startTime || 0) > 0 || (s.endTime || 0) > 0);
        if (!hasTimings) { finishOrderingSymbols(); return; }
        showConfirm({
            title: '⏱️ Rebuild tiles and discard recorded timings?',
            message: 'You\'ve already recorded timings for this song. Continuing rebuilds the tile list from the current order and clears all recorded timings. Choose Cancel to keep your recording and return with the "Sync" step instead.',
            confirmText: 'Rebuild & discard timings',
            onConfirm: finishOrderingSymbols,
        });
    });
    dom.order.btnPanUp.addEventListener('click', () => dom.order.canvasContainer.scrollBy({top: -100, behavior: 'smooth'}));
    dom.order.btnPanDown.addEventListener('click', () => dom.order.canvasContainer.scrollBy({top: 100, behavior: 'smooth'}));


    // --- Sync View (Waveform) ---
    dom.sync.btnRecord.addEventListener('click', handleSyncTapAction); 
    dom.sync.btnReset.addEventListener('click', () => {
        const hasTimings = appState.symbols.some(s => (s.startTime || 0) > 0 || (s.endTime || 0) > 0);
        if (!hasTimings) { resetSync(); return; }
        showConfirm({
            title: '⏱️ Reset all recorded timings?',
            message: 'This erases every timing you\'ve recorded and fine-tuned for this song and returns you to the start of recording. Your tiles and their order are kept.',
            confirmText: 'Reset recording',
            onConfirm: resetSync,
        });
    });
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
    dom.result.btnReset.addEventListener('click', () => {
        showConfirm({
            title: '🔄 Start a completely new project?',
            message: 'This discards your current song — all tiles, ordering and recorded timings — and reloads the app from scratch. Make sure you\'ve exported or saved anything you want to keep first.',
            confirmText: 'Start over',
            onConfirm: () => window.location.reload(),
        });
    });
    dom.result.btnPlay.addEventListener('click', playPreview);
    dom.result.btnPause.addEventListener('click', pausePreview);
    dom.result.btnRewind.addEventListener('click', rewindPreview);
    dom.result.btnDownloadFull.addEventListener('click', () => confirmExport(() => renderVideo('full')));
    dom.result.btnDownloadBacking.addEventListener('click', () => confirmExport(() => renderVideo('backing')));
    // Latency Slider (Global Correction)
    dom.result.latencySlider.addEventListener('input', (e: Event) => {
        const val = parseInt((e.target as HTMLInputElement).value);
        appState.interaction.latencyOffset = val / 1000;
        dom.result.latencyVal.textContent = (val / 1000).toFixed(2);
        if (!appState.preview.isPlaying) drawPreviewFrame(dom.sync.audio.currentTime);
    });

    // Style Inputs
    const updateStyle = () => {
        formatStyleBadges();
        appState.styleConfig.backgroundColor = dom.result.styleBg.value;
        appState.styleConfig.activeScale = parseFloat(dom.result.styleActiveScale.value);
        appState.styleConfig.nextCount = segGet('nextCount');
        appState.styleConfig.nextScale = parseFloat(dom.result.styleNextScale.value);
        appState.styleConfig.nextOpacity = parseFloat(dom.result.styleNextOpacity.value);
        appState.styleConfig.prevCount = segGet('prevCount');
        appState.styleConfig.prevScale = parseFloat(dom.result.stylePrevScale.value);
        appState.styleConfig.prevOpacity = parseFloat(dom.result.stylePrevOpacity.value);
        appState.styleConfig.spacing = parseInt(dom.result.styleSpacing.value);
        appState.styleConfig.roundEnabled = (dom.result.styleRoundEnabled as HTMLInputElement).checked;
        appState.styleConfig.roundVoices = segGet('roundVoices') || 2;
        appState.styleConfig.roundGap = parseFloat(dom.result.styleRoundGap.value);
        // Enable/disable the round sub-controls to match the toggle.
        const on = appState.styleConfig.roundEnabled;
        (dom.result.styleRoundGap as HTMLInputElement).disabled = !on;
        if (dom.result.roundSettings) {
            dom.result.roundSettings.style.opacity = on ? '1' : '0.5';
            dom.result.roundSettings.setAttribute('aria-disabled', on ? 'false' : 'true');
        }
        if (!appState.preview.isPlaying) drawPreviewFrame(dom.sync.audio.currentTime);
    };

    // Wire the segmented pickers (tap a number to select it).
    document.querySelectorAll('.seg-group').forEach(group => {
        group.addEventListener('click', (e) => {
            const btn = (e.target as HTMLElement).closest('button');
            if (!btn || (group.parentElement?.closest('[aria-disabled="true"]'))) return;
            group.querySelectorAll('button').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            updateStyle();
        });
    });

    dom.result.styleBg.addEventListener('input', updateStyle);
    dom.result.styleActiveScale.addEventListener('input', updateStyle);
    dom.result.styleNextScale.addEventListener('input', updateStyle);
    dom.result.styleNextOpacity.addEventListener('input', updateStyle);
    dom.result.stylePrevScale.addEventListener('input', updateStyle);
    dom.result.stylePrevOpacity.addEventListener('input', updateStyle);
    dom.result.styleSpacing.addEventListener('input', updateStyle);
    dom.result.styleRoundEnabled.addEventListener('change', updateStyle);
    dom.result.styleRoundGap.addEventListener('input', updateStyle);

    // Reflect the current styleConfig onto every control (sliders + segments +
    // badges), so the panel always shows the real values — including on load.
    syncStyleControls();

    // Canvas Events
    setupCanvasInteractions();
    
    // Global Keyboard
    window.addEventListener('keydown', (e) => {
        // Prevent shortcuts if user is typing in a text field
        const activeTag = document.activeElement?.tagName.toLowerCase();
        if (activeTag === 'input' || activeTag === 'textarea') {
            return;
        }

        if (appState.currentView === 'define-symbols-view' && (e.key === 'Delete' || e.key === 'Backspace')) {
            deleteSelectedSymbols();
        }
        if (appState.currentView === 'sync-view') {
            // Space / Enter still taps to record.
            if (e.key === ' ' || e.key === 'Enter') {
                e.preventDefault();
                handleSyncTapAction();
                return;
            }
            // Don't hijack arrows mid-recording (only tapping matters then).
            if (appState.isRecordingSync) return;

            const sel = appState.interaction.selectedSyncIndex;
            // Up / Down: move the selection between tiles.
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                selectTimelineTile(-1);
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                selectTimelineTile(1);
            // Left / Right: nudge the selected tile along the timeline
            // (earlier / later). Shift = coarse (0.5s), otherwise fine (0.01s).
            } else if (e.key === 'ArrowLeft') {
                e.preventDefault();
                if (sel === -1) selectTimelineTile(0);
                else nudgeSelectedTile(e.shiftKey ? -0.5 : -0.01);
            } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                if (sel === -1) selectTimelineTile(0);
                else nudgeSelectedTile(e.shiftKey ? 0.5 : 0.01);
            }
        }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
            e.preventDefault();
            historyUndo();
        }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
            e.preventDefault();
            historyRedo();
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
    
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    return {
        x: (clientX - rect.left) * scaleX,
        y: (clientY - rect.top) * scaleY
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
    dom.order.canvas.addEventListener('click', handleOrderCanvasClick);
    // Add touchmove listener to order canvas for pinch zoom support
    dom.order.canvas.addEventListener('touchmove', (e: TouchEvent) => {
        if (e.touches.length === 2) {
            if (e.cancelable) e.preventDefault();
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

            if (isBacking) {
                appState.files.audioBacking = file;
            } else if (isVocal) {
                appState.files.audioVocal = file;
            } else {
                // Smart fallback slot assignment
                if (!appState.files.audioVocal) {
                    appState.files.audioVocal = file;
                } else if (!appState.files.audioBacking) {
                    appState.files.audioBacking = file;
                } else {
                    // Overwrite vocal as the main track if both full
                    appState.files.audioVocal = file;
                }
            }
        } else if (type === 'application/pdf' || name.endsWith('.pdf')) {
            // Loading a PDF replaces other images since they are different formats
            appState.files.pdf = file;
            appState.files.images = [];
        } else if (type.startsWith('image/')) {
            // Loading images clears a previous PDF to prevent formats mismatch
            appState.files.pdf = null;
            appState.files.images.push(file);
        }
    }
    
    // Naturally sort loaded images so they appear in correct sequence
    if (appState.files.images.length > 0) {
        appState.files.images.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    }

    renderUploadedFilesList();
    checkReadyToStart();
}

function renderUploadedFilesList() {
    // 1. Songboard Pages Card
    const listSongboard = dom.upload.listSongboard;
    if (listSongboard) {
        listSongboard.innerHTML = '';
        if (appState.files.pdf) {
            const item = document.createElement('div');
            item.className = 'card-file-item';
            
            const span = document.createElement('span');
            span.textContent = appState.files.pdf.name;
            span.title = appState.files.pdf.name;
            item.appendChild(span);

            const removeBtn = document.createElement('button');
            removeBtn.className = 'remove-btn';
            removeBtn.textContent = '×';
            removeBtn.title = 'Remove PDF';
            removeBtn.onclick = (e) => {
                e.stopPropagation();
                appState.files.pdf = null;
                renderUploadedFilesList();
                checkReadyToStart();
            };
            item.appendChild(removeBtn);
            listSongboard.appendChild(item);

            dom.upload.statusSongboard.textContent = "PDF Loaded";
            dom.upload.cardSongboard.classList.add('filled');
        } else if (appState.files.images.length > 0) {
            appState.files.images.forEach((file, index) => {
                const item = document.createElement('div');
                item.className = 'card-file-item';
                
                const span = document.createElement('span');
                span.textContent = `${index + 1}. ${file.name}`;
                span.title = file.name;
                item.appendChild(span);

                const removeBtn = document.createElement('button');
                removeBtn.className = 'remove-btn';
                removeBtn.textContent = '×';
                removeBtn.title = `Remove image ${file.name}`;
                removeBtn.onclick = (e) => {
                    e.stopPropagation();
                    appState.files.images.splice(index, 1);
                    renderUploadedFilesList();
                    checkReadyToStart();
                };
                item.appendChild(removeBtn);
                listSongboard.appendChild(item);
            });

            dom.upload.statusSongboard.textContent = `${appState.files.images.length} images loaded`;
            dom.upload.cardSongboard.classList.add('filled');
        } else {
            dom.upload.statusSongboard.textContent = "No images loaded";
            dom.upload.cardSongboard.classList.remove('filled');
        }
    }

    // 2. Vocal Card
    const listVocal = dom.upload.listVocal;
    if (listVocal) {
        listVocal.innerHTML = '';
        if (appState.files.audioVocal) {
            const item = document.createElement('div');
            item.className = 'card-file-item';

            const span = document.createElement('span');
            span.textContent = appState.files.audioVocal.name;
            span.title = appState.files.audioVocal.name;
            item.appendChild(span);

            const removeBtn = document.createElement('button');
            removeBtn.className = 'remove-btn';
            removeBtn.textContent = '×';
            removeBtn.title = 'Remove vocal';
            removeBtn.onclick = (e) => {
                e.stopPropagation();
                appState.files.audioVocal = null;
                renderUploadedFilesList();
                checkReadyToStart();
            };
            item.appendChild(removeBtn);
            listVocal.appendChild(item);

            dom.upload.statusVocal.textContent = appState.files.audioVocal.name;
            dom.upload.cardVocal.classList.add('filled');
        } else {
            dom.upload.statusVocal.textContent = "No audio loaded";
            dom.upload.cardVocal.classList.remove('filled', 'selected');
        }
    }

    // 3. Backing Card
    const listBacking = dom.upload.listBacking;
    if (listBacking) {
        listBacking.innerHTML = '';
        if (appState.files.audioBacking) {
            const item = document.createElement('div');
            item.className = 'card-file-item';

            const span = document.createElement('span');
            span.textContent = appState.files.audioBacking.name;
            span.title = appState.files.audioBacking.name;
            item.appendChild(span);

            const removeBtn = document.createElement('button');
            removeBtn.className = 'remove-btn';
            removeBtn.textContent = '×';
            removeBtn.title = 'Remove backing';
            removeBtn.onclick = (e) => {
                e.stopPropagation();
                appState.files.audioBacking = null;
                renderUploadedFilesList();
                checkReadyToStart();
            };
            item.appendChild(removeBtn);
            listBacking.appendChild(item);

            dom.upload.statusBacking.textContent = appState.files.audioBacking.name;
            dom.upload.cardBacking.classList.add('filled');
        } else {
            dom.upload.statusBacking.textContent = "No audio loaded";
            dom.upload.cardBacking.classList.remove('filled', 'selected');
        }
    }
}

function checkReadyToStart() {
    const hasVisuals = appState.files.pdf || appState.files.images.length > 0;
    const hasAudio = !!appState.files.audioVocal || !!appState.files.audioBacking;
    dom.upload.btnGenerate.disabled = !(hasVisuals && hasAudio);
}

function resetUploads() {
    appState.files.pdf = null;
    appState.files.images = [];
    appState.files.audioVocal = null;
    appState.files.audioBacking = null;
    
    renderUploadedFilesList();
    checkReadyToStart();
}

// --- Board Mode Logic ---
function startBoardMode() {
    appState.mode = 'board';
    appState.pages = [];
    
    // Create a blank A4 canvas (794x1123 px approx @ 96 DPI)
    // We'll scale it down slightly for screen viewing
    const width = 794; 
    const height = 1123;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (ctx) {
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, width, height);
    }
    
    // Create Image from blank canvas
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
    
    page.symbols.push({
        x, y, width: size, height: size,
        customImage: null // Empty placeholder
    });
    
    // Select it
    appState.interaction.selectedIndices.clear();
    appState.interaction.selectedIndices.add(page.symbols.length - 1);
    drawCanvas(); updateToolbarUI();
}

async function downloadBoardPdf() {
    const page = appState.pages[appState.currentPageIndex];
    if (!page) return;
    
    // Render the page with symbols to a canvas
    const canvas = document.createElement('canvas');
    canvas.width = page.width;
    canvas.height = page.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Draw background
    ctx.drawImage(page.image, 0, 0);
    
    // Draw symbols
    page.symbols.forEach((sym: any) => {
        if (sym.customImage) {
            ctx.drawImage(sym.customImage, sym.x, sym.y, sym.width, sym.height);
        } else {
            // Draw placeholder outline if empty
            ctx.strokeStyle = '#ccc';
            ctx.lineWidth = 2;
            ctx.strokeRect(sym.x, sym.y, sym.width, sym.height);
        }
    });

    const imgData = canvas.toDataURL('image/jpeg', 0.95);
    const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'px',
        format: [page.width, page.height]
    });
    
    pdf.addImage(imgData, 'JPEG', 0, 0, page.width, page.height);
    pdf.save("symbol-board.pdf");
}

async function downloadBoardImages() {
    const page = appState.pages[appState.currentPageIndex];
    if (!page || page.symbols.length === 0) {
        alert("No symbols to download.");
        return;
    }

    const zip = new JSZip();
    
    page.symbols.forEach((sym: any, i: number) => {
        const canvas = document.createElement('canvas');
        canvas.width = sym.width;
        canvas.height = sym.height;
        const ctx = canvas.getContext('2d');
        
        if (ctx) {
            if (sym.customImage) {
                ctx.drawImage(sym.customImage, 0, 0, sym.width, sym.height);
            } else {
                // If it's a cropped symbol from the background
                ctx.drawImage(page.image, sym.x, sym.y, sym.width, sym.height, 0, 0, sym.width, sym.height);
            }
            
            const data = canvas.toDataURL('image/png').split(',')[1];
            zip.file(`symbol_${i+1}.png`, data, {base64: true});
        }
    });
    
    const content = await zip.generateAsync({type:"blob"});
    saveAs(content, "symbol_images.zip");
}


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
            const url = createLocalUrl(syncFile);
            dom.sync.audio.src = url;
            if (dom.order.audio) dom.order.audio.src = url;
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
        img.src = createLocalUrl(file);
    });
}

async function processPdf(file: File) {
    const arrayBuffer = await file.arrayBuffer();
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
    // Pause audio when switching
    if (dom.order.audio) dom.order.audio.pause();
    if (dom.sync.audio) dom.sync.audio.pause();

    Object.values(dom.views).forEach((el: HTMLElement) => el.style.display = 'none');
    dom.views[viewId === 'upload-view' ? 'upload' : 
              viewId === 'loading-view' ? 'loading' :
              viewId === 'define-symbols-view' ? 'define' :
              viewId === 'order-view' ? 'order' :
              viewId === 'sync-view' ? 'sync' : 'result'].style.display = 'block';
    appState.currentView = viewId;
    
    // Toggle Mode-Specific UI elements
    if (viewId === 'define-symbols-view') {
        const isBoard = appState.mode === 'board';
        if (dom.define.karaokeTools) dom.define.karaokeTools.style.display = isBoard ? 'none' : 'block';
        if (dom.define.boardTools) dom.define.boardTools.style.display = isBoard ? 'block' : 'none';
        dom.define.btnGoOrder.style.display = isBoard ? 'none' : 'block';
        
        setTimeout(resizeCanvas, 50);
    }

    if (viewId === 'order-view') setTimeout(setupOrderView, 50);
    if (viewId === 'sync-view') setupSyncView();
    if (viewId === 'result-view') setupResultView();

    updateStepper(viewId);
}

// --- Workflow Progress Stepper ---
const STEPPER_VIEWS = ['upload-view', 'define-symbols-view', 'order-view', 'sync-view', 'result-view'];

function updateStepper(viewId: string) {
    const stepper = document.getElementById('progress-stepper');
    if (!stepper) return;

    // Board mode has its own short flow (define view only) — the karaoke
    // pipeline stepper would mislead, so hide it.
    if (appState.mode === 'board') {
        stepper.style.display = 'none';
        return;
    }
    stepper.style.display = 'flex';

    const current = STEPPER_VIEWS.indexOf(viewId);
    if (current === -1) return; // loading view etc: keep previous state

    stepper.querySelectorAll('.stepper-step').forEach((btn: Element, i: number) => {
        const b = btn as HTMLButtonElement;
        b.classList.toggle('active', i === current);
        b.classList.toggle('done', i < current);
        const dot = b.querySelector('.step-dot');
        if (dot) dot.textContent = i < current ? '✓' : String(i + 1);
        // Completed steps are clickable to jump back — except Upload, which
        // has no safe re-entry path (restarting the project wipes work).
        b.disabled = !(i < current && i > 0);
    });
    stepper.querySelectorAll('.stepper-connector').forEach((line: Element, i: number) => {
        (line as HTMLElement).classList.toggle('done', i < current);
    });
}

// --- AI Generation Logic (Nano Banana) ---

// Helper to get a reference image of the current style
function getCurrentPageStyleReference(): string {
    const page = appState.pages[appState.currentPageIndex];
    if (!page) return "";
    
    // Capture a sample of the page (e.g., top-left 1024x1024 or full page scaled down)
    // We want the AI to see the line weight, color palette, and vector style.
    const canvas = document.createElement('canvas');
    const size = Math.min(page.width, 1024); // Limit size for API efficiency
    canvas.width = size;
    canvas.height = size; // Square crop is fine for style ref
    const ctx = canvas.getContext('2d');
    if (!ctx) return "";
    
    // Draw the top portion of the page as reference
    ctx.drawImage(page.image, 0, 0, size, size, 0, 0, size, size);
    
    return canvas.toDataURL('image/png').split(',')[1];
}

async function generateAiSymbol() {
    const promptText = (dom.define.aiPrompt as HTMLTextAreaElement).value.trim();
    if (!promptText) { alert("Please enter a prompt."); return; }
    
    const isMulti = (dom.define.aiMultiToggle as HTMLInputElement).checked;

    // Check for API Key first (Required for gemini-3.1-flash-image-preview)
    const win = window as any;
    if (win.aistudio && !await win.aistudio.hasSelectedApiKey()) {
        try {
            await win.aistudio.openSelectKey();
        } catch (e) {
            alert("API Key selection failed or was cancelled.");
            return;
        }
    }
    
    // Create new AI instance with current key
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    setAiLoading(true);
    try {
        const page = appState.pages[appState.currentPageIndex];
        const styleRefBase64 = getCurrentPageStyleReference();

        // Prompt engineering to enforce style consistency
        const strictPrompt = `
        Create a communication symbol for: "${promptText}".
        
        CRITICAL STYLE INSTRUCTIONS:
        - The generated image MUST match the visual style of the provided reference image EXACTLY.
        - Use the same line weight (thick black outlines).
        - Use the same flat color palette found in the reference.
        - Simple, 2D, iconographic, vector-art style.
        - Pure white background.
        - No shading, no gradients, no realism, no complexity.
        - It must look like a standard Widgit/communication symbol.
        `;

        const parts: any[] = [{ text: strictPrompt }];
        if (styleRefBase64) {
            parts.unshift({ inlineData: { mimeType: 'image/png', data: styleRefBase64 } });
        }

        // Generate Multiple Loop
        const count = isMulti ? 3 : 1;
        const promises = [];
        
        for (let i = 0; i < count; i++) {
             promises.push(ai.models.generateContent({
                model: 'gemini-3.1-flash-image-preview', // High quality model
                contents: { parts: parts },
                config: { 
                    imageConfig: { 
                        aspectRatio: "1:1",
                        imageSize: "1K" // Force high resolution
                    } 
                },
            }));
        }
        
        const responses = await Promise.all(promises);

        let createdCount = 0;
        appState.interaction.selectedIndices.clear();

        for (let i = 0; i < responses.length; i++) {
            const response = responses[i];
            let imgBase64 = null;
            if (response.candidates && response.candidates[0].content.parts) {
                for (const part of response.candidates[0].content.parts) {
                    if (part.inlineData) imgBase64 = part.inlineData.data;
                }
            }

            if (imgBase64) {
                const img = new Image();
                // Fix Image Loading Race Condition: Set onload BEFORE src
                await new Promise<void>((resolve) => {
                    img.onload = () => {
                        // Add new symbol to current page
                        const size = 200;
                        // Stagger positions if multi
                        const offsetX = (i * 220) - ((count-1)*110);
                        const x = Math.max(0, (page.width / 2) - (size / 2) + offsetX);
                        const y = Math.max(0, (page.height / 2) - (size / 2));
                        
                        page.symbols.push({
                            x: x, y: y, width: size, height: size,
                            customImage: img // Store the custom image element
                        });
                        
                        // Select all new ones
                        appState.interaction.selectedIndices.add(page.symbols.length - 1);
                        createdCount++;
                        resolve();
                    };
                    img.src = `data:image/png;base64,${imgBase64}`;
                });
            }
        }

        if (createdCount > 0) {
            updateToolbarUI();
            drawCanvas();
            // Ensure new symbol is visible
            dom.define.canvasContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else {
            alert("No images generated.");
        }

    } catch (e) {
        console.error(e);
        alert("Generation failed: " + e.message);
    } finally {
        setAiLoading(false);
    }
}

async function editAiSymbol() {
    const promptText = (dom.define.aiPrompt as HTMLTextAreaElement).value.trim();
    if (!promptText) { alert("Please enter a prompt."); return; }
    if (appState.interaction.selectedIndices.size !== 1) {
        alert("Please select exactly one tile to edit."); return;
    }
    
    // Check for API Key first (Required for gemini-3.1-flash-image-preview)
    const win = window as any;
    if (win.aistudio && !await win.aistudio.hasSelectedApiKey()) {
        try {
            await win.aistudio.openSelectKey();
        } catch (e) {
            alert("API Key selection failed or was cancelled.");
            return;
        }
    }

    // Create new AI instance with current key
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

    setAiLoading(true);
    try {
        const page = appState.pages[appState.currentPageIndex];
        const idx = appState.interaction.selectedIndices.values().next().value;
        const sym = page.symbols[idx];

        // 1. Get current symbol image as base64
        const canvas = document.createElement('canvas');
        canvas.width = sym.width;
        canvas.height = sym.height;
        const ctx = canvas.getContext('2d');
        
        if (sym.customImage) {
            ctx.drawImage(sym.customImage, 0, 0, sym.width, sym.height);
        } else {
            ctx.drawImage(page.image, sym.x, sym.y, sym.width, sym.height, 0, 0, sym.width, sym.height);
        }
        
        const base64Data = canvas.toDataURL('image/png').split(',')[1];
        
        // 2. Strict Prompt for Editing
        const strictPrompt = `
        Edit this symbol to: "${promptText}".
        
        CRITICAL STYLE INSTRUCTIONS:
        - PRESERVE the exact visual style of the original image and the reference document.
        - Maintain thick black outlines, flat colors, and simple vector look.
        - Do not change the art style. Do not make it realistic.
        - Keep white background.
        `;

        const parts: any[] = [
             { inlineData: { mimeType: 'image/png', data: base64Data } },
             { text: strictPrompt }
        ];

        // 3. Call API
        const response = await ai.models.generateContent({
            model: 'gemini-3.1-flash-image-preview', // High quality model
            contents: { parts: parts },
            config: { 
                imageConfig: { 
                    aspectRatio: "1:1",
                    imageSize: "1K" // Force high resolution
                } 
            },
        });

         // 4. Parse result
        let imgBase64 = null;
        for (const part of response.candidates[0].content.parts) {
            if (part.inlineData) imgBase64 = part.inlineData.data;
        }

        if (imgBase64) {
            const img = new Image();
            // Fix Image Loading Race Condition
            img.onload = () => {
                // Update symbol
                sym.customImage = img;
                drawCanvas();
            };
            img.src = `data:image/png;base64,${imgBase64}`;
        } else {
            alert("No image returned from edit.");
        }

    } catch (e) {
        console.error(e);
        alert("Edit failed: " + e.message);
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
            // Replace selected
            const idx = appState.interaction.selectedIndices.values().next().value;
            page.symbols[idx].customImage = img;
        } else {
            // Add new
            const size = 200;
            const x = Math.max(0, (page.width / 2) - (size / 2));
            const y = Math.max(0, (page.height / 2) - (size / 2));
            
            page.symbols.push({
                x, y, width: size, height: size,
                customImage: img
            });
            
            appState.interaction.selectedIndices.clear();
            appState.interaction.selectedIndices.add(page.symbols.length - 1);
        }
        drawCanvas();
        updateToolbarUI();
        // Reset input
        dom.define.inputUploadSymbol.value = '';
    };
    img.src = createLocalUrl(file);
}

function setAiLoading(loading: boolean) {
    dom.define.aiLoading.style.display = loading ? 'flex' : 'none';
    dom.define.btnAiGenerate.disabled = loading;
    dom.define.btnAiEdit.disabled = loading;
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
        pruneGlobalSequence(appState.currentPageIndex, { clearPage: true });
        invalidatePageThumbs(appState.currentPageIndex);
        appState.interaction.selectedIndices.clear();
        appState.interaction.isDragging = false;
        updateToolbarUI();
        drawCanvas();
    }
}
function deleteSelectedSymbols() {
    const page = appState.pages[appState.currentPageIndex];
    if (!page || appState.interaction.selectedIndices.size === 0) return;
    const indicesToDelete = Array.from(appState.interaction.selectedIndices).sort((a: number, b: number) => b - a);
    indicesToDelete.forEach(index => {
        page.symbols.splice(index, 1);
        // Keep both the legacy per-page order and the cross-page sequence valid.
        page.sequence = page.sequence.filter(i => i !== index).map(i => i > index ? i - 1 : i);
        pruneGlobalSequence(appState.currentPageIndex, { removedSym: index });
    });
    invalidatePageThumbs(appState.currentPageIndex);
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
        // Render Custom AI Image if present
        if (s.customImage) {
            ctx.drawImage(s.customImage, s.x, s.y, s.width, s.height);
        }

        if (appState.interaction.selectedIndices.has(idx)) {
            ctx.strokeStyle = '#00ffff'; ctx.fillStyle = 'rgba(0, 255, 255, 0.2)';
        } else {
            ctx.strokeStyle = '#2b7de9'; ctx.fillStyle = 'rgba(43, 125, 233, 0.1)';
        }
        ctx.beginPath(); ctx.rect(s.x, s.y, s.width, s.height);
        ctx.fill(); ctx.stroke();

        // Draw Resize Handle for selected
        if (appState.interaction.selectedIndices.has(idx)) {
            const handleSize = 10 / appState.interaction.zoomLevel;
            ctx.fillStyle = '#1a73e8';
            ctx.fillRect(s.x + s.width - handleSize/2, s.y + s.height - handleSize/2, handleSize, handleSize);
        }
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
    pruneGlobalSequence(appState.currentPageIndex, { clearPage: true });
    invalidatePageThumbs(appState.currentPageIndex);

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
        for (let x=0; x<w; x+=2) {
            const idx = (y*w+x)*4;
            if (data[idx] < threshold || data[idx+1] < threshold || data[idx+2] < threshold) count++;
        }
        if (count > w*0.002) { if(!inRow) { inRow=true; startY=y; } }
        else { if(inRow) { inRow=false; if(y-startY > 20) rows.push({s:startY, e:y}); } }
    }
    if(inRow) rows.push({s:startY, e:h});

    rows.forEach(r => {
        let inCol = false, startX = 0;
        for (let x=0; x<w; x++) {
            let count=0;
            for (let y=r.s; y<r.e; y+=2) {
                const idx = (y*w+x)*4;
                if (data[idx] < threshold || data[idx+1] < threshold || data[idx+2] < threshold) count++;
            }
            if (count > (r.e-r.s)*0.002) { if(!inCol) { inCol=true; startX=x; } }
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
    }

    const pos = getPointerPos(e, dom.define.canvas);
    const scale = appState.interaction.zoomLevel;
    const x = pos.x / scale;
    const y = pos.y / scale;
    
    const page = appState.pages[appState.currentPageIndex];

    // Check for Resize Handle first
    let resizeIdx = -1;
    const handleSize = 30 / scale; // Generous hit area for mobile
    appState.interaction.selectedIndices.forEach(idx => {
        const s = page.symbols[idx];
        const hX = s.x + s.width - handleSize/2;
        const hY = s.y + s.height - handleSize/2;
        if (x >= hX && x <= hX + handleSize && y >= hY && y <= hY + handleSize) resizeIdx = idx;
    });

    if (resizeIdx !== -1) {
        if (e.cancelable) e.preventDefault();
        appState.interaction.dragAction = 'resize';
        appState.interaction.dragStart = {x, y};
        appState.interaction.isDragging = true;
        return;
    }

    let hitIndex = page.symbols.findIndex((s: any) => x >= s.x && x <= s.x + s.width && y >= s.y && y <= s.y + s.height);

    if (hitIndex !== -1) {
        if (e.type === 'touchstart' && e.cancelable) e.preventDefault();
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
        if (e.type === 'touchstart') {
            appState.interaction.dragAction = 'none';
        } else {
            if (!e.shiftKey) appState.interaction.selectedIndices.clear();
            appState.interaction.dragAction = 'marquee';
            appState.interaction.marqueeStart = {x, y};
            appState.interaction.marqueeCurrent = {x, y};
            appState.interaction.initialSelection = new Set(appState.interaction.selectedIndices);
        }
    }
    appState.interaction.isDragging = true;
    drawCanvas(); updateToolbarUI();
}
function handleDefineCanvasMove(e: MouseEvent | TouchEvent) {
    if (e.type === 'touchmove') {
        if ((e as TouchEvent).touches.length === 2) {
             if (e.cancelable) e.preventDefault();
             handlePinchZoom(e as TouchEvent);
             return;
        }
        if (appState.interaction.dragAction !== 'none' && e.cancelable) {
             e.preventDefault();
        }
    }
    if (!appState.interaction.isDragging || appState.interaction.dragAction === 'none') return;
    
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
    } else if (appState.interaction.dragAction === 'resize') {
        const dx = x - appState.interaction.dragStart.x;
        const dy = y - appState.interaction.dragStart.y;
        appState.interaction.selectedIndices.forEach(idx => {
            const s = page.symbols[idx];
            s.width = Math.max(10, s.width + dx);
            s.height = Math.max(10, s.height + dy);
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
// --- Cross-page sequence helpers ---
// The reading order is one continuous list of {page, sym} steps. This lets a
// song jump between pages and come back (verse p1 -> chorus p2 -> verse p1),
// and lets the same tile repeat anywhere. Legacy per-page page.sequence is
// migrated in on demand so old projects / in-memory state keep working.
function ensureGlobalSequence() {
    if (appState.globalSequence.length > 0) return;
    const anyLegacy = appState.pages.some(p => p.sequence && p.sequence.length > 0);
    if (!anyLegacy) return;
    const seq: SequenceStep[] = [];
    appState.pages.forEach((p, pi) => {
        (p.sequence || []).forEach(si => {
            if (p.symbols[si]) seq.push({ page: pi, sym: si });
        });
    });
    appState.globalSequence = seq;
}

// Global positions (1-based) at which a given tile on a page appears.
function globalPositionsFor(pageIdx: number, symIdx: number): number[] {
    const out: number[] = [];
    appState.globalSequence.forEach((step, i) => {
        if (step.page === pageIdx && step.sym === symIdx) out.push(i + 1);
    });
    return out;
}

// Remove every step that references a page, and (optionally) shift symbol
// indices after a deleted symbol on that page. Used by delete/clear/redetect.
function pruneGlobalSequence(pageIdx: number, opts: { removedSym?: number; clearPage?: boolean } = {}) {
    appState.globalSequence = appState.globalSequence.filter(step => {
        if (step.page !== pageIdx) return true;
        if (opts.clearPage) return false;
        if (opts.removedSym !== undefined && step.sym === opts.removedSym) return false;
        return true;
    }).map(step => {
        if (step.page === pageIdx && opts.removedSym !== undefined && step.sym > opts.removedSym) {
            return { page: step.page, sym: step.sym - 1 };
        }
        return step;
    });
}

function setupOrderView() {
    const page = appState.pages[appState.currentPageIndex];
    if (!page) return;

    ensureGlobalSequence();

    if (dom.order.audio) {
        dom.order.audio.parentElement!.style.display = (appState.files.audioVocal || appState.files.audioBacking) ? 'block' : 'none';
    }

    // Fit to width mostly
    const containerW = dom.order.canvasContainer.clientWidth;
    const scale = containerW / page.width;
    dom.order.canvas.width = page.width * scale;
    dom.order.canvas.height = page.height * scale;
    dom.order.labelPage.textContent = `Page ${appState.currentPageIndex + 1} / ${appState.pages.length}`;
    drawOrderCanvas();
    renderOrderSequenceStrip();
}
function drawOrderCanvas() {
    const ctx = dom.order.ctx;
    const page = appState.pages[appState.currentPageIndex];
    const canvas = dom.order.canvas;
    const scale = canvas.width / page.width;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(page.image, 0, 0, canvas.width, canvas.height);

    const pageIdx = appState.currentPageIndex;
    const seq = appState.globalSequence;
    const center = (si: number) => {
        const s = page.symbols[si];
        return { cx: (s.x + s.width / 2) * scale, cy: (s.y + s.height / 2) * scale };
    };

    // Draw the reading path THROUGH this page. We connect consecutive global
    // steps that both land on this page; where the path arrives from or departs
    // to another page, we mark it so cross-page flow is visible.
    ctx.lineWidth = 3;
    for (let i = 0; i < seq.length; i++) {
        if (seq[i].page !== pageIdx) continue;
        const here = center(seq[i].sym);

        // Connector from the previous step, if it was also on this page.
        if (i > 0 && seq[i - 1].page === pageIdx) {
            const prev = center(seq[i - 1].sym);
            ctx.beginPath();
            ctx.strokeStyle = 'rgba(79, 70, 229, 0.65)';
            ctx.moveTo(prev.cx, prev.cy);
            ctx.lineTo(here.cx, here.cy);
            ctx.stroke();
        } else if (i > 0) {
            // Arrived from another page — draw a small inbound chevron.
            drawPageJumpMarker(ctx, here.cx, here.cy, `from P${seq[i - 1].page + 1}`, true);
        }
        // Departs to another page after this step.
        if (i < seq.length - 1 && seq[i + 1].page !== pageIdx) {
            drawPageJumpMarker(ctx, here.cx, here.cy, `to P${seq[i + 1].page + 1}`, false);
        }
    }

    page.symbols.forEach((sym, idx) => {
        const x = sym.x * scale, y = sym.y * scale, w = sym.width * scale, h = sym.height * scale;
        if (sym.customImage) ctx.drawImage(sym.customImage, x, y, w, h);

        const positions = globalPositionsFor(pageIdx, idx);

        if (positions.length > 0) {
            ctx.fillStyle = 'rgba(79, 70, 229, 0.22)';
            ctx.strokeStyle = '#4f46e5';
            ctx.lineWidth = 3;
        } else {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
            ctx.strokeStyle = '#999';
            ctx.lineWidth = 1;
        }
        ctx.fillRect(x, y, w, h);
        ctx.strokeRect(x, y, w, h);

        if (positions.length > 0) {
            // Badge shows every global position this tile occupies (repeats).
            const label = positions.join(',');
            ctx.font = 'bold 12px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const padW = Math.max(24, ctx.measureText(label).width + 12);
            const bx = x + w - padW / 2 - 3, by = y + 15;
            ctx.fillStyle = '#4f46e5';
            roundRect(ctx, bx - padW / 2, by - 11, padW, 22, 11);
            ctx.fill();
            ctx.fillStyle = 'white';
            ctx.fillText(label, bx, by + 1);
            ctx.textBaseline = 'alphabetic';
        }
    });
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

function drawPageJumpMarker(ctx: CanvasRenderingContext2D, cx: number, cy: number, label: string, inbound: boolean) {
    ctx.save();
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const w = ctx.measureText(label).width + 12;
    const y = inbound ? cy - 22 : cy + 22;
    ctx.fillStyle = inbound ? '#0891b2' : '#d97706';
    roundRect(ctx, cx - w / 2, y - 9, w, 18, 9);
    ctx.fill();
    ctx.fillStyle = 'white';
    ctx.fillText(label, cx, y + 1);
    ctx.restore();
}

// Thumbnail cache keyed by page:sym so re-rendering the strip is cheap even
// with a long, repeat-heavy sequence.
const _thumbCache = new Map<string, string>();
function stepThumb(pageIdx: number, symIdx: number): string {
    const key = `${pageIdx}:${symIdx}`;
    const cached = _thumbCache.get(key);
    if (cached) return cached;
    const page = appState.pages[pageIdx];
    const sym = page?.symbols[symIdx];
    if (!sym) return '';
    const off = document.createElement('canvas');
    off.width = 80; off.height = 80;
    const c = off.getContext('2d');
    if (c) {
        if (sym.customImage) c.drawImage(sym.customImage, 0, 0, 80, 80);
        else c.drawImage(page.image, sym.x, sym.y, sym.width, sym.height, 0, 0, 80, 80);
    }
    const url = off.toDataURL();
    _thumbCache.set(key, url);
    return url;
}
// Symbols on a page changed (deleted/cleared/redetected) — drop its thumbs.
function invalidatePageThumbs(pageIdx: number) {
    Array.from(_thumbCache.keys())
        .filter(k => k.startsWith(`${pageIdx}:`))
        .forEach(k => _thumbCache.delete(k));
}

function moveSequenceStep(from: number, to: number) {
    const seq = appState.globalSequence;
    if (to < 0 || to >= seq.length || from === to) return;
    const [step] = seq.splice(from, 1);
    seq.splice(to, 0, step);
    saveHistoryState();
    drawOrderCanvas();
    renderOrderSequenceStrip();
}

// Renders the ENTIRE cross-page reading order (not just the current page), so
// the flow between pages is visible and editable in one place. Each item is
// tagged with its page, can be nudged left/right or removed, dragged to
// reorder, and clicking it jumps the canvas to that page.
function renderOrderSequenceStrip() {
    const strip = dom.order.sequenceStrip;
    if (!strip) return;
    strip.innerHTML = '';

    if (appState.globalSequence.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'seq-empty';
        empty.textContent = 'Tap tiles on the page above in reading order. Switch pages any time — the order flows across pages and you can revisit a page to repeat tiles.';
        strip.appendChild(empty);
        return;
    }

    appState.globalSequence.forEach((step, seqIdx) => {
        const item = document.createElement('div');
        item.className = 'order-sequence-item';
        item.draggable = true;
        const onCurrentPage = step.page === appState.currentPageIndex;
        if (onCurrentPage) item.classList.add('active');

        const img = document.createElement('img');
        img.src = stepThumb(step.page, step.sym);
        item.appendChild(img);

        const badge = document.createElement('div');
        badge.className = 'number-badge';
        badge.textContent = (seqIdx + 1).toString();
        item.appendChild(badge);

        // Page tag — only meaningful with multiple pages.
        if (appState.pages.length > 1) {
            const tag = document.createElement('div');
            tag.className = 'page-tag';
            tag.textContent = `P${step.page + 1}`;
            item.appendChild(tag);
        }

        const controls = document.createElement('div');
        controls.className = 'seq-controls';
        const mkBtn = (txt: string, title: string, fn: () => void) => {
            const b = document.createElement('button');
            b.className = 'seq-btn';
            b.textContent = txt;
            b.title = title;
            b.onclick = (e) => { e.stopPropagation(); fn(); };
            return b;
        };
        controls.appendChild(mkBtn('‹', 'Move earlier', () => moveSequenceStep(seqIdx, seqIdx - 1)));
        controls.appendChild(mkBtn('×', 'Remove from order', () => {
            appState.globalSequence.splice(seqIdx, 1);
            saveHistoryState();
            drawOrderCanvas();
            renderOrderSequenceStrip();
        }));
        controls.appendChild(mkBtn('›', 'Move later', () => moveSequenceStep(seqIdx, seqIdx + 1)));
        item.appendChild(controls);

        // Click the tile (not its buttons) to jump the canvas to its page.
        item.onclick = () => {
            if (step.page !== appState.currentPageIndex) {
                appState.currentPageIndex = step.page;
                setupOrderView();
            }
        };

        // Drag-to-reorder (desktop pointer).
        item.addEventListener('dragstart', (e) => {
            e.dataTransfer?.setData('text/plain', String(seqIdx));
            item.classList.add('dragging');
        });
        item.addEventListener('dragend', () => item.classList.remove('dragging'));
        item.addEventListener('dragover', (e) => e.preventDefault());
        item.addEventListener('drop', (e) => {
            e.preventDefault();
            const from = parseInt(e.dataTransfer?.getData('text/plain') || '', 10);
            if (!Number.isNaN(from)) moveSequenceStep(from, seqIdx);
        });

        strip.appendChild(item);
    });
}

function handleOrderCanvasClick(e: MouseEvent | TouchEvent) {
    const pos = getPointerPos(e, dom.order.canvas);
    const page = appState.pages[appState.currentPageIndex];
    if (!page) return;

    const scale = dom.order.canvas.width / page.width;
    const x = pos.x / scale;
    const y = pos.y / scale;

    const hitIdx = page.symbols.findIndex((s: any) => x >= s.x && x <= s.x + s.width && y >= s.y && y <= s.y + s.height);
    if (hitIdx !== -1) {
        // Append to the ONE continuous cross-page reading order. Clicking the
        // same tile again (here or on a later visit to this page) just repeats
        // it — exactly what a chorus / repeated word needs.
        appState.globalSequence.push({ page: appState.currentPageIndex, sym: hitIdx });
        saveHistoryState();
        drawOrderCanvas();
        renderOrderSequenceStrip();
    }
}

// Robust reading order for a page: cluster tiles into rows using a threshold
// derived from the tiles' own median height (not a fixed 50px, which breaks on
// large/small symbols), then left-to-right within each row.
function readingOrderIndices(page: ProjectPage): number[] {
    const idx = page.symbols.map((_, i) => i);
    if (idx.length === 0) return idx;
    const heights = page.symbols.map(s => s.height).sort((a, b) => a - b);
    const medianH = heights[Math.floor(heights.length / 2)] || 50;
    const rowThreshold = Math.max(20, medianH * 0.6);
    return idx.sort((a, b) => {
        const sA = page.symbols[a], sB = page.symbols[b];
        const yA = sA.y + sA.height / 2, yB = sB.y + sB.height / 2;
        return Math.abs(yA - yB) > rowThreshold ? yA - yB : sA.x - sB.x;
    });
}

function autoOrderPage() {
    // Append THIS page's tiles, in reading order, to the end of the continuous
    // sequence. (Replaces this page's existing steps so re-running is stable.)
    const pageIdx = appState.currentPageIndex;
    const page = appState.pages[pageIdx];
    pruneGlobalSequence(pageIdx, { clearPage: true });
    readingOrderIndices(page).forEach(si => appState.globalSequence.push({ page: pageIdx, sym: si }));
    saveHistoryState();
    drawOrderCanvas();
    renderOrderSequenceStrip();
}

function resetOrderPage() {
    // Only clears THIS page's steps from the continuous sequence.
    pruneGlobalSequence(appState.currentPageIndex, { clearPage: true });
    if (dom.order.audio) {
        dom.order.audio.pause();
        dom.order.audio.currentTime = 0;
    }
    saveHistoryState();
    drawOrderCanvas();
    renderOrderSequenceStrip();
}
// The reading order to flatten into the Sync/Result list. Uses the continuous
// cross-page sequence; if none was defined, falls back to every tile on every
// page in natural order (e.g. board mode).
function effectiveSequence(): SequenceStep[] {
    ensureGlobalSequence();
    if (appState.globalSequence.length > 0) {
        return appState.globalSequence.filter(st => appState.pages[st.page]?.symbols[st.sym]);
    }
    const seq: SequenceStep[] = [];
    appState.pages.forEach((p, pi) => p.symbols.forEach((_, si) => seq.push({ page: pi, sym: si })));
    return seq;
}

// Build the flat appState.symbols list (one entry per sequence step, so a
// repeated tile becomes independent entries with their own timing).
function buildFlatSymbols() {
    appState.symbols = [];
    effectiveSequence().forEach(step => {
        const page = appState.pages[step.page];
        const sym = page.symbols[step.sym];
        if (!sym) return;
        const canvas = document.createElement('canvas');
        canvas.width = sym.width; canvas.height = sym.height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
            if (sym.customImage) ctx.drawImage(sym.customImage, 0, 0, sym.width, sym.height);
            else ctx.drawImage(page.image, sym.x, sym.y, sym.width, sym.height, 0, 0, sym.width, sym.height);
        }
        appState.symbols.push({
            globalIndex: appState.symbols.length,
            pageIndex: step.page,
            imageSrc: canvas.toDataURL(),
            startTime: 0,
            endTime: 0,
            direction: '',
            ...sym,
        });
    });
}

function finishOrderingSymbols() {
    buildFlatSymbols();
    if (appState.symbols.length === 0) {
        alert("No tiles in the reading order yet! Tap tiles on the page in the order they should play.");
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

    // Dynamically apply warnings and badges
    updateNavStripWarnings();
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

    ensureSyncTileVisible(idx);
    updateTimelineToolsUI();
    drawSyncTimeline();
}

// Scroll the timeline just enough to keep a tile on screen (used while nudging
// so keyboard adjustments never push the tile out of view).
function ensureSyncTileVisible(idx: number) {
    const sym = appState.symbols[idx];
    if (!sym) return;
    const zoom = appState.interaction.timelineZoom;
    const viewportW = dom.sync.timelineContainer.clientWidth;
    if (!zoom || !viewportW) return;
    const widthInSecs = viewportW / zoom;
    const margin = widthInSecs * 0.12;
    const left = appState.interaction.syncScrollX;
    const right = left + widthInSecs;
    if (sym.startTime < left + margin) {
        appState.interaction.syncScrollX = Math.max(0, sym.startTime - margin);
    } else if (sym.startTime > right - margin) {
        appState.interaction.syncScrollX = Math.max(0, sym.startTime - widthInSecs + margin);
    }
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
    updateNavStripWarnings(); // Update timing warning badges and borders
}

// Timeline Drag Logic
function handleTimelineMouseDown(e: MouseEvent | TouchEvent) {
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
        if (e.cancelable) e.preventDefault();
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
    if (!appState.interaction.isDragging) return;
    
    const pos = getPointerPos(e, dom.sync.timelineCanvas);
    const zoom = appState.interaction.timelineZoom;
    
    if (appState.interaction.dragAction === 'pan-timeline') {
        if (e.type === 'touchmove' && e.cancelable) e.preventDefault();
        const dx = pos.x - appState.interaction.dragStart.x;
        const dt = dx / zoom;
        appState.interaction.syncScrollX = Math.max(0, appState.interaction.syncScrollX - dt);
        appState.interaction.dragStart.x = pos.x;
    } else if (appState.interaction.timelineDragIndex !== -1) {
        if (e.type === 'touchmove' && e.cancelable) e.preventDefault();
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
// --- Visual Settings control helpers (shared by live editing & sync-back) ---

// Format each slider's read-out badge in human terms (percent / px / seconds).
function formatStyleBadges() {
    document.querySelectorAll('.setting-val[data-for]').forEach((span: Element) => {
        const el = span as HTMLElement;
        const input = document.getElementById(el.dataset.for!) as HTMLInputElement | null;
        if (!input) return;
        const v = parseFloat(input.value);
        const fmt = el.dataset.format;
        el.textContent = fmt === 'percent' ? Math.round(v * 100) + '%'
            : fmt === 'px' ? Math.round(v) + 'px'
            : fmt === 'seconds' ? v.toFixed(1) + 's'
            : input.value;
    });
}

// Read the selected value of a segmented (button-group) picker.
function segGet(key: string): number {
    const active = document.querySelector(`.seg-group[data-style="${key}"] button.active`) as HTMLElement | null;
    return active ? parseInt(active.dataset.value!) : 0;
}
// Select a value in a segmented picker.
function segSet(key: string, val: number) {
    document.querySelectorAll(`.seg-group[data-style="${key}"] button`).forEach(b => {
        b.classList.toggle('active', parseInt((b as HTMLElement).dataset.value!) === val);
    });
}

// Push the current styleConfig onto every control so the panel always shows the
// real values (e.g. after loading a project or reopening the Result view).
function syncStyleControls() {
    const c = appState.styleConfig;
    const set = (el: HTMLInputElement | null, v: string | number) => { if (el) el.value = String(v); };
    set(dom.result.styleBg as HTMLInputElement, c.backgroundColor);
    set(dom.result.styleActiveScale as HTMLInputElement, c.activeScale);
    set(dom.result.styleNextScale as HTMLInputElement, c.nextScale);
    set(dom.result.styleNextOpacity as HTMLInputElement, c.nextOpacity);
    set(dom.result.stylePrevScale as HTMLInputElement, c.prevScale);
    set(dom.result.stylePrevOpacity as HTMLInputElement, c.prevOpacity);
    set(dom.result.styleSpacing as HTMLInputElement, c.spacing);
    set(dom.result.styleRoundGap as HTMLInputElement, c.roundGap);
    (dom.result.styleRoundEnabled as HTMLInputElement).checked = !!c.roundEnabled;
    segSet('nextCount', c.nextCount);
    segSet('prevCount', c.prevCount);
    segSet('roundVoices', c.roundVoices || 2);
    (dom.result.styleRoundGap as HTMLInputElement).disabled = !c.roundEnabled;
    if (dom.result.roundSettings) {
        dom.result.roundSettings.style.opacity = c.roundEnabled ? '1' : '0.5';
        dom.result.roundSettings.setAttribute('aria-disabled', c.roundEnabled ? 'false' : 'true');
    }
    formatStyleBadges();
}

async function setupResultView() {
    dom.result.canvas.width = 640; dom.result.canvas.height = 360;
    syncStyleControls();
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

    // Musical round mode takes over the whole frame (its own title/waiting
    // states per voice), so branch before the single-conveyor title card.
    if (cfg.roundEnabled && appState.symbols.length > 0) {
        drawRoundFrame(ctx, w, h, time, firstStart);
        return;
    }

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
    let activeIndex = activeIndexAt(time);

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
        
        // Draw Prev (already-played tiles scrolling past the main tile)
        // Mirrors the Next conveyor: user-configurable count/scale/opacity,
        // and respects the Spacing slider (was a single hardcoded tile).
        for (let i = 1; i <= cfg.prevCount; i++) {
            if (activeIndex - i >= 0) {
                const s = cfg.prevScale * Math.pow(0.9, i-1);
                const o = cfg.prevOpacity * Math.pow(0.8, i-1);
                drawSym(activeIndex - i, cx - (i * cfg.spacing), s, o);
            }
        }
    }
}

// Which tile is active at a given time (shared by preview & round voices).
function activeIndexAt(time: number): number {
    const syms = appState.symbols;
    let idx = syms.findIndex(s => time >= (s.startTime || 0) && time < (s.endTime || 99999));
    if (idx === -1 && syms.length > 0 && time > (syms[syms.length - 1].startTime || 0)) {
        idx = syms.length - 1; // hold on last tile past the end
    }
    return idx;
}

// Colours used to distinguish the voices/groups of a round.
const VOICE_COLORS = ['#4f46e5', '#ea4335', '#16a34a'];
const VOICE_NAMES = ['Group 1', 'Group 2', 'Group 3'];

// Render the round: each voice is the same sequence shifted later by roundGap,
// drawn in its own horizontal band, colour-coded, separated by divider lines.
function drawRoundFrame(ctx: CanvasRenderingContext2D, w: number, h: number, time: number, firstStart: number) {
    const cfg = appState.styleConfig;
    const voices = Math.max(2, Math.min(3, cfg.roundVoices || 2));
    const gap = Math.max(0.1, cfg.roundGap || 4);
    const bandH = h / voices;

    for (let v = 0; v < voices; v++) {
        const tint = VOICE_COLORS[v % VOICE_COLORS.length];
        const cy = bandH * v + bandH / 2;
        // Following voices are the same melody entering `gap` seconds later each.
        const effTime = time - v * gap;

        // Subtle band wash in the voice colour.
        ctx.save();
        ctx.globalAlpha = 0.06;
        ctx.fillStyle = tint;
        ctx.fillRect(0, bandH * v, w, bandH);
        ctx.restore();

        // Group label pill on the left.
        ctx.save();
        ctx.font = 'bold 13px sans-serif';
        ctx.textBaseline = 'middle';
        const label = VOICE_NAMES[v % VOICE_NAMES.length];
        const lw = ctx.measureText(label).width + 18;
        ctx.fillStyle = tint;
        roundRect(ctx, 12, cy - 13, lw, 26, 13);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.fillText(label, 12 + lw / 2, cy + 1);
        ctx.restore();

        // Has this voice started yet?
        if (effTime < firstStart) {
            ctx.save();
            ctx.globalAlpha = 0.5;
            ctx.fillStyle = tint;
            ctx.font = 'italic 15px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(v === 0 ? '♪ singing…' : 'waiting to come in…', w / 2, cy);
            ctx.restore();
        } else {
            const activeIdx = activeIndexAt(effTime);
            if (activeIdx !== -1) {
                drawVoiceConveyor(ctx, activeIdx, w, cy, bandH, tint);
            }
        }

        // Divider line between bands.
        if (v > 0) {
            ctx.save();
            ctx.strokeStyle = 'rgba(120,120,140,0.55)';
            ctx.lineWidth = 2;
            ctx.setLineDash([8, 6]);
            ctx.beginPath();
            ctx.moveTo(0, bandH * v);
            ctx.lineTo(w, bandH * v);
            ctx.stroke();
            ctx.restore();
        }
    }
}

// One voice's conveyor (prev / active / next) in a band centred at cy, with the
// tiles sat on colour-coded cards so each group can follow its own colour.
function drawVoiceConveyor(ctx: CanvasRenderingContext2D, activeIndex: number, w: number, cy: number, bandH: number, tint: string) {
    const cfg = appState.styleConfig;
    const rowScale = Math.min(1, bandH / 240);
    const baseSize = 200 * rowScale;
    const spacing = cfg.spacing * rowScale;
    const cx = w / 2;

    const drawTile = (idx: number, x: number, scale: number, opacity: number, active: boolean) => {
        if (!appState.preview.loadedImages.has(idx)) return;
        const img = appState.preview.loadedImages.get(idx)!;
        const size = baseSize * scale;
        const ratio = Math.min(size / img.width, size / img.height);
        const dw = img.width * ratio, dh = img.height * ratio;
        const pad = active ? 12 : 8;
        ctx.save();
        ctx.globalAlpha = opacity;
        // Colour-coded card behind the tile.
        ctx.fillStyle = tint;
        ctx.globalAlpha = opacity * (active ? 0.22 : 0.14);
        roundRect(ctx, x - dw / 2 - pad, cy - dh / 2 - pad, dw + pad * 2, dh + pad * 2, 12);
        ctx.fill();
        if (active) {
            ctx.globalAlpha = opacity;
            ctx.strokeStyle = tint;
            ctx.lineWidth = 3;
            roundRect(ctx, x - dw / 2 - pad, cy - dh / 2 - pad, dw + pad * 2, dh + pad * 2, 12);
            ctx.stroke();
        }
        ctx.globalAlpha = opacity;
        ctx.drawImage(img, x - dw / 2, cy - dh / 2, dw, dh);
        ctx.restore();
    };

    // Next
    for (let i = cfg.nextCount; i >= 1; i--) {
        if (activeIndex + i < appState.symbols.length) {
            drawTile(activeIndex + i, cx + i * spacing, cfg.nextScale * Math.pow(0.9, i - 1), cfg.nextOpacity * Math.pow(0.8, i - 1), false);
        }
    }
    // Prev
    for (let i = 1; i <= cfg.prevCount; i++) {
        if (activeIndex - i >= 0) {
            drawTile(activeIndex - i, cx - i * spacing, cfg.prevScale * Math.pow(0.9, i - 1), cfg.prevOpacity * Math.pow(0.8, i - 1), false);
        }
    }
    // Active
    drawTile(activeIndex, cx, cfg.activeScale, 1.0, true);
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
        // Prefer WebM/VP9: far better compression efficiency for this content
        // (symbols over mostly-flat backgrounds), which means smaller files and
        // clean re-import in the same browsers. Fall back to MP4 for Safari,
        // whose MediaRecorder can only produce MP4.
        const preferredTypes = [
            "video/webm;codecs=vp9",
            "video/webm;codecs=vp8",
            "video/webm",
            "video/mp4",
        ];
        let mime = "video/webm";
        for (const t of preferredTypes) {
            if (MediaRecorder.isTypeSupported(t)) { mime = t; break; }
        }

        // VP9's efficiency lets us drop the bitrate without visible loss, so the
        // simple graphics content exports noticeably smaller. MP4 (H.264) is less
        // efficient, so keep it a little higher there to hold quality.
        const isMp4 = mime.includes("mp4");
        const bitrate = isMp4 ? 2500000 : 1600000;
        recorder = new MediaRecorder(combined, { mimeType: mime, videoBitsPerSecond: bitrate });
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

// --- Project Persistence & Manifest Export ---

function getBase64Image(img: HTMLImageElement | null): string {
    if (!img) return "";
    if (img.src.startsWith('data:')) return img.src;
    try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width || 200;
        canvas.height = img.naturalHeight || img.height || 200;
        const ctx = canvas.getContext('2d');
        if (ctx) {
            ctx.drawImage(img, 0, 0);
            return canvas.toDataURL('image/png');
        }
    } catch (err) {
        console.warn("Failed to base64 encode custom image, falling back:", err);
    }
    return img.src;
}

interface SyncIssue {
    type: 'unsynced' | 'gap';
    tileIndex: number;
    message: string;
}

function getSyncIssues(): SyncIssue[] {
    const issues: SyncIssue[] = [];
    if (appState.mode === 'board') return issues; // No timing sync needed for static board mode
    if (appState.symbols.length === 0) return issues;

    appState.symbols.forEach((sym, idx) => {
        if (sym.startTime === 0 && sym.endTime === 0) {
            issues.push({
                type: 'unsynced',
                tileIndex: idx,
                message: `Tile has not been synchronized (has no timing data).`
            });
        }
    });

    for (let i = 0; i < appState.symbols.length - 1; i++) {
        const current = appState.symbols[i];
        const next = appState.symbols[i + 1];

        if ((current.startTime === 0 && current.endTime === 0) || (next.startTime === 0 && next.endTime === 0)) {
            continue;
        }

        const gap = next.startTime - current.endTime;
        if (gap > 0.05) {
            issues.push({
                type: 'gap',
                tileIndex: i,
                message: `Gap of ${gap.toFixed(2)}s detected after this tile.`
            });
        }
    }

    return issues;
}

function updateNavStripWarnings() {
    const container = dom.sync.navStrip;
    if (!container) return;

    const issues = getSyncIssues();
    const items = container.querySelectorAll('.nav-symbol-item');

    items.forEach((item, idx) => {
        item.classList.remove('warning-unsynced', 'warning-gap');
        const oldWarn = item.querySelector('.warn-badge');
        if (oldWarn) oldWarn.remove();
        const oldGap = item.querySelector('.gap-badge');
        if (oldGap) oldGap.remove();

        const hasUnsynced = issues.some(iss => iss.type === 'unsynced' && iss.tileIndex === idx);
        const hasGapAfter = issues.some(iss => iss.type === 'gap' && iss.tileIndex === idx);

        if (hasUnsynced) {
            item.classList.add('warning-unsynced');
            const warnBadge = document.createElement('div');
            warnBadge.className = 'warn-badge';
            warnBadge.innerHTML = '⚠️';
            warnBadge.title = 'Tile is un-synced (missing timing)';
            item.appendChild(warnBadge);
        } else if (hasGapAfter) {
            item.classList.add('warning-gap');
            const gapBadge = document.createElement('div');
            gapBadge.className = 'gap-badge';
            gapBadge.innerHTML = '⏱️';
            gapBadge.title = 'Gap exists after this tile';
            item.appendChild(gapBadge);
        }
    });
}

function confirmExport(onConfirm: () => void) {
    const issues = getSyncIssues();
    if (issues.length === 0) {
        onConfirm();
        return;
    }

    // Update highlights in navigation strip
    updateNavStripWarnings();

    // Create warning modal
    const overlay = document.createElement('div');
    overlay.className = 'warning-modal-overlay';
    overlay.id = 'export-warning-modal';

    const content = document.createElement('div');
    content.className = 'warning-modal-content';

    const title = document.createElement('h3');
    title.className = 'warning-modal-title';
    title.innerHTML = '⚠️ Export Warning: Sync Issues Detected';

    const body = document.createElement('div');
    body.className = 'warning-modal-body';
    body.innerHTML = `
        <p>You are about to export this project, but we detected <strong>${issues.length}</strong> synchronization issue(s). Reviewing and fixing these will ensure a seamless karaoke playback experience.</p>
        <div class="warning-issue-list">
            ${issues.map(iss => {
                const badge = iss.type === 'unsynced' ? '⚠️' : '⏱️';
                const typeClass = iss.type === 'unsynced' ? 'unsynced' : 'gap';
                const label = iss.type === 'unsynced' ? 'Un-synced Timing' : 'Time Gap';
                return `<div class="warning-issue-item ${typeClass}">${badge} <strong>Tile ${iss.tileIndex + 1} (${label}):</strong> ${iss.message}</div>`;
            }).join('')}
        </div>
        <p style="font-size: 0.9rem; color: #5f6368;">Problematic tiles have been highlighted with red (missing timing) and yellow (time gaps) borders in the Step 3 synchronization timeline.</p>
    `;

    const btnContainer = document.createElement('div');
    btnContainer.className = 'warning-modal-buttons';

    const btnFix = document.createElement('button');
    btnFix.className = 'button secondary';
    btnFix.style.margin = '0';
    btnFix.textContent = 'Go Back & Fix';
    btnFix.addEventListener('click', () => {
        document.body.removeChild(overlay);
        switchView('sync-view');
        const firstIssue = issues[0];
        appState.interaction.selectedSyncIndex = firstIssue.tileIndex;
        selectTimelineTile(0);
    });

    const btnProceed = document.createElement('button');
    btnProceed.className = 'button';
    btnProceed.style.backgroundColor = '#ea4335';
    btnProceed.style.margin = '0';
    btnProceed.textContent = 'Export Anyway';
    btnProceed.addEventListener('click', () => {
        document.body.removeChild(overlay);
        onConfirm();
    });

    btnContainer.appendChild(btnFix);
    btnContainer.appendChild(btnProceed);

    content.appendChild(title);
    content.appendChild(body);
    content.appendChild(btnContainer);
    overlay.appendChild(content);

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            document.body.removeChild(overlay);
        }
    });

    document.body.appendChild(overlay);
}

/**
 * Reusable confirmation dialog for destructive / irreversible actions.
 * Prevents an accidental click on a "Reset" / "Clear" / "Start Over" button
 * from wiping the user's work without warning.
 *
 * Behaviour tuned for safety + seamlessness:
 *  - The safe "Cancel" button is focused by default, so a stray Enter/Space
 *    key press never triggers the destructive action.
 *  - Escape and clicking the dim backdrop both cancel.
 *  - The dialog only appears when the caller decides there is work to lose,
 *    so it never gets in the way when there's nothing to protect.
 */
function showConfirm(opts: {
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    danger?: boolean;
    onConfirm: () => void;
}) {
    const overlay = document.createElement('div');
    overlay.className = 'warning-modal-overlay';

    const content = document.createElement('div');
    content.className = 'warning-modal-content';
    // Red accent for destructive actions, blue for neutral confirmations.
    content.style.borderTopColor = opts.danger === false ? '#4285f4' : '#ea4335';

    const title = document.createElement('h3');
    title.className = 'warning-modal-title';
    if (opts.danger === false) title.style.color = '#174ea6';
    title.innerHTML = opts.title;

    const body = document.createElement('div');
    body.className = 'warning-modal-body';
    body.innerHTML = `<p>${opts.message}</p>`;

    const btnContainer = document.createElement('div');
    btnContainer.className = 'warning-modal-buttons';

    const close = () => {
        if (overlay.parentNode) document.body.removeChild(overlay);
        document.removeEventListener('keydown', onKey);
    };

    const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') { e.preventDefault(); close(); }
    };

    const btnCancel = document.createElement('button');
    btnCancel.className = 'button secondary';
    btnCancel.style.margin = '0';
    btnCancel.textContent = opts.cancelText || 'Cancel';
    btnCancel.addEventListener('click', close);

    const btnConfirm = document.createElement('button');
    btnConfirm.className = 'button';
    btnConfirm.style.margin = '0';
    if (opts.danger !== false) btnConfirm.style.backgroundColor = '#ea4335';
    btnConfirm.textContent = opts.confirmText || 'Confirm';
    btnConfirm.addEventListener('click', () => {
        close();
        opts.onConfirm();
    });

    btnContainer.appendChild(btnCancel);
    btnContainer.appendChild(btnConfirm);
    content.appendChild(title);
    content.appendChild(body);
    content.appendChild(btnContainer);
    overlay.appendChild(content);

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close();
    });

    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);
    // Focus the safe button so a stray Enter/Space can't destroy work.
    btnCancel.focus();
}

async function saveProjectJson() {
    if (appState.pages.length === 0) {
        alert("No active project to save.");
        return;
    }

    const savedPages = [];
    for (let pIndex = 0; pIndex < appState.pages.length; pIndex++) {
        const page = appState.pages[pIndex];
        const savedSymbols = [];
        for (const s of page.symbols) {
            savedSymbols.push({
                x: s.x,
                y: s.y,
                width: s.width,
                height: s.height,
                direction: s.direction || "",
                startTime: s.startTime || 0,
                endTime: s.endTime || 0,
                customImageBase64: s.customImage ? getBase64Image(s.customImage) : ""
            });
        }
        savedPages.push({
            pageIndex: pIndex,
            width: page.width,
            height: page.height,
            symbols: savedSymbols,
            sequence: [...page.sequence]
        });
    }

    const projectData: ProjectSaveData = {
        app: "Widget Machine",
        version: "0.1.0",
        date: new Date().toISOString(),
        songTitle: appState.songTitle,
        mode: appState.mode,
        sourceFiles: {
            pdfName: appState.files.pdf ? appState.files.pdf.name : "",
            imageNames: appState.files.images.map(f => f.name),
            audioVocalName: appState.files.audioVocal ? appState.files.audioVocal.name : "",
            audioBackingName: appState.files.audioBacking ? appState.files.audioBacking.name : ""
        },
        styleConfig: appState.styleConfig,
        gridConfig: appState.gridConfig,
        latencyOffset: appState.interaction.latencyOffset,
        globalSequence: appState.globalSequence.map(s => ({ page: s.page, sym: s.sym })),
        pages: savedPages
    };

    const blob = new Blob([JSON.stringify(projectData, null, 2)], { type: 'application/json' });
    const fileName = `${appState.songTitle.replace(/[^a-zA-Z0-9-_]/g, '_') || 'widget'}_project.json`;
    saveAs(blob, fileName);
}

function triggerProjectLoad() {
    if (dom.global && dom.global.inputLoad) {
        dom.global.inputLoad.click();
    }
}

function handleProjectLoadFile(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
        try {
            const data = JSON.parse(event.target?.result as string);
            if (data.app !== "Widget Machine") {
                alert("Invalid project file. Must be a 'Widget Machine' project.");
                return;
            }

            // Restore basic metadata
            appState.songTitle = data.songTitle || "";
            if (dom.upload.titleInput) {
                (dom.upload.titleInput as HTMLInputElement).value = appState.songTitle;
            }
            appState.mode = data.mode || "karaoke";
            if (data.styleConfig) appState.styleConfig = { ...appState.styleConfig, ...data.styleConfig };
            if (data.gridConfig) appState.gridConfig = { ...appState.gridConfig, ...data.gridConfig };
            if (data.latencyOffset !== undefined) {
                appState.interaction.latencyOffset = data.latencyOffset;
                if (dom.result.latencySlider) {
                    (dom.result.latencySlider as HTMLInputElement).value = String(data.latencyOffset * 1000);
                }
                if (dom.result.latencyVal) {
                    dom.result.latencyVal.textContent = data.latencyOffset.toFixed(2);
                }
            }

            // Reconstruct pages & custom images
            appState.pages = [];
            for (const pageData of data.pages) {
                // Generate simple blank slate canvas so they can continue even without original assets
                const canvas = document.createElement('canvas');
                canvas.width = pageData.width || 800;
                canvas.height = pageData.height || 1100;
                const ctx = canvas.getContext('2d');
                if (ctx) {
                    ctx.fillStyle = "#f5f5f5";
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                    ctx.fillStyle = "#ccc";
                    ctx.font = "16px sans-serif";
                    ctx.textAlign = "center";
                    ctx.fillText(`Drop original background PDF or images`, canvas.width / 2, canvas.height / 2 - 20);
                    ctx.fillText(`to recover the background visualization.`, canvas.width / 2, canvas.height / 2);
                }

                const img = new Image();
                img.src = canvas.toDataURL();
                await new Promise((resolve) => { img.onload = resolve; });

                const symbols = [];
                for (const s of pageData.symbols) {
                    let customImageObj = null;
                    if (s.customImageBase64) {
                        customImageObj = new Image();
                        customImageObj.src = s.customImageBase64;
                        await new Promise((resolve) => { customImageObj!.onload = resolve; });
                    }
                    symbols.push({
                        x: s.x,
                        y: s.y,
                        width: s.width,
                        height: s.height,
                        direction: s.direction || "",
                        startTime: s.startTime || 0,
                        endTime: s.endTime || 0,
                        customImage: customImageObj
                    });
                }

                appState.pages.push({
                    image: img,
                    width: canvas.width,
                    height: canvas.height,
                    symbols: symbols,
                    sequence: pageData.sequence || []
                });
            }

            // Cross-page order: use the saved global sequence if present,
            // otherwise ensureGlobalSequence() migrates the legacy per-page one.
            _thumbCache.clear();
            appState.globalSequence = Array.isArray(data.globalSequence) ? data.globalSequence : [];
            ensureGlobalSequence();

            // Rebuild Flat List
            rebuildGlobalSymbolsList();
            
            // Backup backgrounds
            (window as any)._originalPageBackgrounds = [...appState.pages];

            // Re-save history starting state
            undoStack.length = 0;
            redoStack.length = 0;
            saveHistoryState();

            // Toggle view
            appState.currentPageIndex = 0;
            switchView('define-symbols-view');
            
            alert(`Project "${appState.songTitle}" loaded successfully! If you'd like to restore the original full-resolution background templates, please drop the corresponding source PDF or image files on the creator area.`);
        } catch (err) {
            console.error("Load project failed:", err);
            alert("Failed to parse project file. Make sure it's a valid Widget Machine project JSON.");
        }
    };
    reader.readAsText(file);
}

function rebuildGlobalSymbolsList() {
    // Delegates to the shared builder, which walks the cross-page sequence
    // (migrating legacy per-page order in if needed) and preserves timings.
    buildFlatSymbols();
}

function exportProjectManifest() {
    if (appState.pages.length === 0) {
        alert("No active project to export manifest for.");
        return;
    }

    const songName = appState.songTitle || "Untitled Song";
    const dateStr = new Date().toLocaleString();
    const modeStr = appState.mode === 'board' ? "printable board" : "full-mix / backing-only";
    const sourceSheet = appState.files.pdf ? appState.files.pdf.name : appState.files.images.map(f => f.name).join(", ") || "None";
    const sourceAudio = appState.files.audioVocal ? appState.files.audioVocal.name : appState.files.audioBacking ? appState.files.audioBacking.name : "None";
    const numSymbols = appState.symbols.length;
    const syncMethod = appState.isRecordingSync ? "Manual Tapping" : "Loaded Timing / Draft Timeline";
    const appVersion = "v0.1.0";

    const manifestData = {
        title: "Widget Machine Export Manifest",
        header: "Widget Machine Export",
        songName: songName,
        date: dateStr,
        mode: modeStr,
        sourceSheetFilename: sourceSheet,
        sourceAudioFilename: sourceAudio,
        numberOfSymbols: numSymbols,
        syncMethod: syncMethod,
        estimatedProductionMethod: "Automated Widget Machine Karaoke Renderer",
        previousManualMethodReference: "Manual PowerPoint timeline animation / video editor",
        appVersion: appVersion,
        credits: "Designed and built by George Bunn (Georgeharrybunn96@gmail.com)"
    };

    const blob = new Blob([JSON.stringify(manifestData, null, 2)], { type: 'application/json' });
    const fileName = `${songName.replace(/[^a-zA-Z0-9-_]/g, '_') || 'widget'}_manifest.json`;
    saveAs(blob, fileName);
}

// --- Snapshot Undo/Redo Engine ---

function saveHistoryState() {
    const pagesData = appState.pages.map(p => {
        return {
            width: p.width,
            height: p.height,
            symbols: p.symbols.map(s => {
                return {
                    x: s.x,
                    y: s.y,
                    width: s.width,
                    height: s.height,
                    startTime: s.startTime || 0,
                    endTime: s.endTime || 0,
                    direction: s.direction || "",
                    customImageBase64: s.customImage ? getBase64Image(s.customImage) : ""
                };
            }),
            sequence: [...p.sequence]
        };
    });

    const symbolsData = appState.symbols.map(s => {
        return {
            globalIndex: s.globalIndex,
            pageIndex: s.pageIndex,
            imageSrc: s.imageSrc,
            startTime: s.startTime || 0,
            endTime: s.endTime || 0,
            direction: s.direction || "",
            x: s.x,
            y: s.y,
            width: s.width,
            height: s.height,
            customImageBase64: s.customImage ? getBase64Image(s.customImage) : ""
        };
    });

    const snapshot = JSON.stringify({
        pages: pagesData,
        symbols: symbolsData,
        globalSequence: appState.globalSequence,
        songTitle: appState.songTitle,
        mode: appState.mode,
        styleConfig: appState.styleConfig,
        gridConfig: appState.gridConfig,
        latencyOffset: appState.interaction.latencyOffset
    });

    if (undoStack.length === 0 || undoStack[undoStack.length - 1] !== snapshot) {
        undoStack.push(snapshot);
        if (undoStack.length > 50) {
            undoStack.shift();
        }
        redoStack.length = 0; // Clear redo
        updateUndoRedoUI();
    }
}

function updateUndoRedoUI() {
    if (dom.global) {
        if (dom.global.btnUndo) dom.global.btnUndo.disabled = undoStack.length <= 1;
        if (dom.global.btnRedo) dom.global.btnRedo.disabled = redoStack.length === 0;
        if (dom.global.btnSave) dom.global.btnSave.disabled = appState.pages.length === 0;
    }
}

async function historyUndo() {
    if (undoStack.length <= 1) return;
    const current = undoStack.pop()!;
    redoStack.push(current);

    const prev = undoStack[undoStack.length - 1];
    await applyHistorySnapshot(prev);
    updateUndoRedoUI();
}

async function historyRedo() {
    if (redoStack.length === 0) return;
    const next = redoStack.pop()!;
    undoStack.push(next);
    await applyHistorySnapshot(next);
    updateUndoRedoUI();
}

async function applyHistorySnapshot(snapshotStr: string) {
    try {
        const data = JSON.parse(snapshotStr);
        appState.songTitle = data.songTitle || "";
        if (dom.upload.titleInput) (dom.upload.titleInput as HTMLInputElement).value = appState.songTitle;
        appState.mode = data.mode || "karaoke";
        // Merge (not replace) so snapshots from older versions missing newer
        // fields (e.g. prevCount) keep their defaults.
        appState.styleConfig = { ...appState.styleConfig, ...(data.styleConfig || {}) };
        appState.gridConfig = data.gridConfig || appState.gridConfig;
        appState.interaction.latencyOffset = data.latencyOffset || 0;
        appState.globalSequence = Array.isArray(data.globalSequence) ? data.globalSequence : [];
        _thumbCache.clear();

        // Apply pages
        appState.pages = [];
        for (let pIdx = 0; pIdx < data.pages.length; pIdx++) {
            const p = data.pages[pIdx];
            
            // Re-use original background image if present
            let img = new Image();
            const originalBackgrounds = (window as any)._originalPageBackgrounds;
            if (originalBackgrounds && originalBackgrounds[pIdx] && originalBackgrounds[pIdx].image) {
                img = originalBackgrounds[pIdx].image;
            } else {
                const canvas = document.createElement('canvas');
                canvas.width = p.width || 800;
                canvas.height = p.height || 1100;
                const ctx = canvas.getContext('2d');
                if (ctx) {
                    ctx.fillStyle = "#f5f5f5";
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                    ctx.fillStyle = "#ccc";
                    ctx.font = "16px sans-serif";
                    ctx.textAlign = "center";
                    ctx.fillText(`Placeholder background`, canvas.width / 2, canvas.height / 2);
                }
                img.src = canvas.toDataURL();
                await new Promise(r => img.onload = r);
            }

            const symbols = [];
            for (const s of p.symbols) {
                let customImageObj = null;
                if (s.customImageBase64) {
                    customImageObj = new Image();
                    customImageObj.src = s.customImageBase64;
                    await new Promise(r => customImageObj!.onload = r);
                }
                symbols.push({
                    x: s.x,
                    y: s.y,
                    width: s.width,
                    height: s.height,
                    direction: s.direction || "",
                    startTime: s.startTime || 0,
                    endTime: s.endTime || 0,
                    customImage: customImageObj
                });
            }

            appState.pages.push({
                image: img,
                width: p.width || img.naturalWidth,
                height: p.height || img.naturalHeight,
                symbols: symbols,
                sequence: p.sequence || []
            });
        }

        // Apply flat symbols
        appState.symbols = [];
        for (const s of data.symbols) {
            let customImageObj = null;
            if (s.customImageBase64) {
                customImageObj = new Image();
                customImageObj.src = s.customImageBase64;
                await new Promise(r => customImageObj!.onload = r);
            }
            appState.symbols.push({
                globalIndex: s.globalIndex,
                pageIndex: s.pageIndex,
                imageSrc: s.imageSrc,
                startTime: s.startTime || 0,
                endTime: s.endTime || 0,
                direction: s.direction || '',
                x: s.x, y: s.y, width: s.width, height: s.height,
                customImage: customImageObj
            });
        }

        // Refresh currently active view
        if (appState.currentView === 'define-symbols-view') {
            resizeCanvas();
            drawCanvas();
            updateToolbarUI();
        } else if (appState.currentView === 'order-view') {
            setupOrderView();
        } else if (appState.currentView === 'sync-view') {
            setupSyncView();
        } else if (appState.currentView === 'result-view') {
            setupResultView();
        }
    } catch (e) {
        console.error("Undo/Redo apply state failed:", e);
    }
}

window.addEventListener('load', init);
export default {};