export interface SymbolTile {
    x: number;
    y: number;
    width: number;
    height: number;
    imageSrc?: string;
    customImage?: HTMLImageElement | null;
    startTime?: number;
    endTime?: number;
    direction?: string;
    globalIndex?: number;
    pageIndex?: number;
}

export interface ProjectPage {
    image: HTMLImageElement;
    width: number;
    height: number;
    symbols: SymbolTile[];
    sequence: number[];
}

export interface SyncTiming {
    symbolIndex: number;
    time: number;
}

export interface StyleConfig {
    backgroundColor: string;
    activeScale: number;
    nextCount: number;
    nextScale: number;
    nextOpacity: number;
    spacing: number;
    prevCount: number;
    prevScale: number;
    prevOpacity: number;
}

export interface GridConfig {
    rowBreakThreshold: number;
    colBreakThreshold: number;
    minSymbolWidth: number;
    minSymbolHeight: number;
    contentThreshold: number;
}

export interface AppState {
    currentView: string;
    mode: string;
    songTitle: string;
    files: {
        images: File[];
        audioVocal: File | null;
        audioBacking: File | null;
        pdf: File | null;
    };
    pages: ProjectPage[];
    currentPageIndex: number;
    symbols: SymbolTile[];
    isRecordingSync: boolean;
    currentSyncIndex: number;
    syncData: SyncTiming[];
    audioBuffer: AudioBuffer | null;
    stats: {
        avgDuration: number;
    };
    gridConfig: GridConfig;
    styleConfig: StyleConfig;
    interaction: {
        isDragging: boolean;
        dragStart: { x: number; y: number };
        selectedIndices: Set<number>;
        initialSelection: Set<number>;
        dragAction: string;
        zoomLevel: number;
        marqueeStart: { x: number; y: number };
        marqueeCurrent: { x: number; y: number };
        timelineZoom: number;
        timelineDragIndex: number;
        selectedSyncIndex: number;
        syncScrollX: number;
        lastTouchDistance: number;
        latencyOffset: number;
    };
    preview: {
        isPlaying: boolean;
        animationId: number;
        startTime: number;
        loadedImages: Map<number, HTMLImageElement>;
    };
    aiModeEnabled: boolean;
}

export interface ProjectSaveData {
    app: string;
    version: string;
    date: string;
    songTitle: string;
    mode: string;
    sourceFiles: {
        pdfName: string;
        imageNames: string[];
        audioVocalName: string;
        audioBackingName: string;
    };
    styleConfig: StyleConfig;
    gridConfig: GridConfig;
    latencyOffset: number;
    pages: {
        pageIndex: number;
        width: number;
        height: number;
        symbols: {
            x: number;
            y: number;
            width: number;
            height: number;
            direction?: string;
            startTime?: number;
            endTime?: number;
            customImageBase64?: string; // Serialized base64 of customImage
        }[];
        sequence: number[];
    }[];
}
