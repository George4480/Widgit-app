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
    /**
     * Legacy per-page ordering. Retained for backward compatibility with
     * saved projects and as a fallback, but the canonical reading order is
     * now AppState.globalSequence, which can span and revisit pages.
     */
    sequence: number[];
}

/** One step in the continuous cross-page reading order. */
export interface SequenceStep {
    page: number;   // page index
    sym: number;    // symbol index within that page
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
    // Round: identical melody at EQUAL spacing that LOOPS a marked phrase to a
    // unison finish (e.g. "Row, Row, Row Your Boat"). A cyclic form.
    roundEnabled: boolean;
    roundVoices: number;        // total voices including the leader (2-3)
    roundGap: number;           // seconds each following voice enters after the previous
    roundCountdown: boolean;    // show a beat countdown before each voice enters
    roundCountInBeats: number;  // beats to count (from the song's time signature)
    // Canon: a DIFFERENT musical form — the same melody simply fired later. Each
    // following voice enters at its OWN chosen point, sings the line ONCE, and it
    // ends. It does not loop and is not a round.
    canonEnabled: boolean;
    canonVoices: number;        // total voices including the leader (2-4)
    /**
     * Entry point of each FOLLOWING voice, as a 0-based leader tile index — the
     * tile the leader is on when that voice fires its own first tile.
     * canonEntries[0] is voice 2, [1] is voice 3, [2] is voice 4.
     */
    canonEntries: number[];
    canonCountdown: boolean;    // show a beat countdown before each voice enters
    canonCountInBeats: number;  // beats to count (from the song's time signature)
    // "Follow the sheet" mode: show the whole songsheet (cropped to the tiles,
    // excluding header/footer logos), glow-highlight the current tile, and
    // scroll down continuously as the song progresses. Alternative to conveyor.
    sheetMode: boolean;
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
    /** Canonical reading order across all pages (supports revisits & repeats). */
    globalSequence: SequenceStep[];
    /** Round loop section defined at the Sync stage, by flat tile index (-1 = unset). */
    round: { start: number; end: number };
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
    /**
     * The pipeline stage the project was on when saved (e.g. 'sync-view',
     * 'result-view'), so a reload can resume there instead of the first step.
     * Absent in files saved before this feature.
     */
    currentView?: string;
    /** Cross-page reading order. Absent in files saved before this feature. */
    globalSequence?: SequenceStep[];
    /** Round loop section by tile index. Absent in older files. */
    round?: { start: number; end: number };
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
