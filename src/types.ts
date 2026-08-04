export interface SymbolTile {
    x: number;
    y: number;
    width: number;
    height: number;
    /** Rendered crop of this tile as a data URL. Populated on the flat
     *  AppState.symbols entries; not stored on the per-page source tiles. */
    imageSrc?: string;
    /** Runtime-only decoded image for a user-supplied tile. Persisted to
     *  saves as ProjectSaveData…symbols[].customImageBase64, not this field. */
    customImage?: HTMLImageElement | null;
    startTime?: number;
    endTime?: number;
    direction?: string;
    globalIndex?: number;
    pageIndex?: number;
    /**
     * Staged-scaffold removal level for THIS sequence occurrence, mirrored from
     * the backing SequenceStep.removalLevel when the flat list is rebuilt. Used
     * by the renderer. undefined/0 = always visible. See ScaffoldConfig.
     */
    removalLevel?: number;
}

export interface ProjectPage {
    image: HTMLImageElement;
    width: number;
    height: number;
    /**
     * Source-of-truth tiles for this page (spatially attached to the page).
     * The flat AppState.symbols list is derived from these plus the reading
     * order — edit tiles here, then rebuild the flat list.
     */
    symbols: SymbolTile[];
    /**
     * @deprecated Legacy per-page ordering. Retained only for backward
     * compatibility with saved projects and as a migration fallback — the
     * canonical reading order is AppState.globalSequence, which can span and
     * revisit pages. Do not use in new logic.
     */
    sequence: number[];
}

/** One step in the continuous cross-page reading order. */
export interface SequenceStep {
    page: number;   // page index
    sym: number;    // symbol index within that page
    /**
     * Staged-scaffold removal level for THIS occurrence — "the first scaffold
     * level at which this specific occurrence becomes hidden". Stored against the
     * occurrence, NOT the source tile, so repeated tiles can be removed at
     * different stages. undefined or 0 = always visible; 1 = hidden from Level 1
     * onwards; 2 = from Level 2 onwards; etc. (cumulative). Absent in projects
     * saved before staged scaffold removal existed.
     */
    removalLevel?: number;
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
    // Three small, independent refinements to the default (non-sheet) tile
    // renderer. Each is its own on/off switch and they compose freely — a
    // teacher can have all three, one, or none. All default off: they change
    // how the active tile reads, and an existing project's look shouldn't
    // shift under it because the app learned a new trick.
    durationFill: boolean;   // a wipe crosses the active tile over its recorded window
    activeCard: boolean;     // a card + ring behind the active tile, not just its size
    beatPulse: boolean;      // a pop and a hopping dot on each change
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
    /**
     * First tile of the phrase each FOLLOWING voice sings, as a 0-based index
     * into its own line. Deliberately separate from canonEntries: that decides
     * WHEN a voice fires, this decides WHAT it sings at that moment, and the two
     * are not the same choice. canonStarts[0] is voice 2, [1] voice 3, [2] voice 4.
     * Absent in projects saved before per-voice phrases existed — those load as
     * 0, i.e. every voice starts at the first tile, the original behaviour.
     */
    canonStarts: number[];
    /**
     * Last tile of each following voice's sung phrase (0-based, inclusive).
     * -1 means sing on to the end of the song, which is the default.
     */
    canonEnds: number[];
    /**
     * Tail loop: a short phrase the voices repeat at the end so a canon can
     * finish in unison instead of each voice simply stopping when it runs out
     * of line. 0-based tile indices into the reading order; -1 = no loop.
     */
    canonLoopStart: number;
    canonLoopEnd: number;
    /**
     * How many times the LEADER repeats that phrase. 0 = work it out
     * automatically, which is almost always what you want: a voice N tiles
     * behind needs exactly N tiles of vamp to catch up, so the count follows
     * from the tile offsets and the loop length rather than being guessed.
     * Following voices repeat proportionally fewer times, so every voice runs
     * out of music at the same moment.
     */
    canonLoopRepeats: number;
    canonCountdown: boolean;    // show a beat countdown before each voice enters
    canonCountInBeats: number;  // beats to count (from the song's time signature)
    /**
     * Resolution of the EXPORTED video, as a key into EXPORT_SIZES ('720' |
     * '1080'). The on-screen preview is always 640x360; this only affects the
     * rendered file. Absent in projects saved before the setting existed, which
     * load as '720'.
     */
    exportRes: string;
    /**
     * @deprecated Superseded by presentationMode ('sheet'). Kept only so a
     * project saved before presentationMode existed can be migrated —
     * normalizePresentationMode() reads it once, then presentationMode is the
     * only field anything else looks at. Do not use in new logic.
     */
    sheetMode: boolean;
    /**
     * How the symbols are shown. 'conveyor' is the original tiles-slide-across
     * view; the rest are full-frame alternatives, mutually exclusive with it and
     * with each other:
     *   'sheet'      — the whole songsheet, current tile glow-highlighted, that
     *                  scrolls down as the song plays ("Follow the sheet").
     *   'spotlight'  — one symbol, as large as the frame allows, nothing else.
     *   'phraseLine' — the current physical row of the songboard as a line,
     *                  lighting up left to right as it's sung.
     *   'nowNext'    — a large NOW panel and a smaller NEXT panel, captioned.
     *   'vertical'   — the conveyor turned ninety degrees: symbols rise past a
     *                  fixed mark instead of sliding across one.
     * Absent in projects saved before it existed; normalizePresentationMode()
     * derives it from the legacy sheetMode boolean on load.
     */
    presentationMode: 'conveyor' | 'sheet' | 'spotlight' | 'phraseLine' | 'nowNext' | 'vertical';
}

/**
 * How much of a masked tile is taken away. A Widgit tile is a picture with its
 * word underneath, and the two are worth removing separately — taking the word
 * away leaves a symbol to read, taking the symbol away leaves text to read, and
 * they are different skills.
 *
 *   'blank'     — background colour only: no picture, no word.
 *   'symbol'    — the picture stays, the word underneath is covered.
 *   'word'      — the word stays, the picture above it is covered.
 *   'alternate' — alternates symbol-only / word-only along the reading order.
 *
 * Named for what SURVIVES, not what is removed.
 */
export type ScaffoldMaskMode = 'blank' | 'symbol' | 'word' | 'alternate';

/**
 * Staged scaffold removal: progressively strip the tiles themselves back across
 * numbered, cumulative practice STAGES to support recall and independent
 * singing. Which tiles are affected at each stage lives on
 * SequenceStep.removalLevel; how much of an affected tile is taken away is the
 * stage's ScaffoldMaskMode. This holds the feature's configuration and the
 * transient preview/assignment UI state.
 *
 * Note on naming: the interface says "stage" throughout — "level" ranks a child
 * by what they cannot yet do, which is the wrong idea for a practice sequence.
 * The FIELD names below still say "level" because they are written into saved
 * project files; renaming them would strand every project already saved. Stored
 * name is historical, the user-facing word is "stage".
 */
export interface ScaffoldConfig {
    enabled: boolean;
    /** Number of configured levels (>=1). Levels are numbered 1..levelCount. */
    levelCount: number;
    /**
     * Mask mode per level — index 0 is level 1. Entries past the end (and files
     * saved before mask modes existed) read as 'blank', the original all-or-
     * nothing behaviour.
     */
    levelModes: ScaffoldMaskMode[];
    /**
     * Height of the word strip at the bottom of a tile, as a fraction of tile
     * height. Decides where the 'symbol'/'word' modes cut. Boards vary, so it is
     * adjustable; 0.3 suits a typical Widgit symbol-above-word tile.
     */
    wordBand: number;
    /**
     * The level currently "armed" for assignment at the Sync stage. 0 = no level
     * armed, so nav-strip taps keep their ordinary timeline-selection behaviour.
     * Transient UI state (not meaningful once you leave the Sync stage).
     */
    selectedAssignmentLevel: number;
    /**
     * Level shown in the preview / used by a normal single export. 0 = full
     * support (everything visible); N = show masking cumulative up to level N.
     */
    previewLevel: number;
    /** Whether the last export chose a single level or the progressive video. */
    exportMode: "single" | "progressive";
}

export interface GridConfig {
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
    /**
     * Derived, sequence-expanded flat list — NOT a second copy of the page
     * tiles. Rebuilt from pages[].symbols + the reading order: one entry per
     * reading-order step (so a repeated tile yields multiple independent
     * entries, each carrying its own imageSrc crop and startTime/endTime).
     * This is the timing/playback representation; treat pages[].symbols as the
     * source of truth and rebuild this, don't hand-edit it.
     */
    symbols: SymbolTile[];
    isRecordingSync: boolean;
    currentSyncIndex: number;
    audioBuffer: AudioBuffer | null;
    gridConfig: GridConfig;
    styleConfig: StyleConfig;
    /** Staged scaffold removal configuration + transient preview/assignment state. */
    scaffold: ScaffoldConfig;
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
        /**
         * Decoded per-tile images for rendering the preview/export, keyed by
         * flat AppState.symbols index (NOT page images — the page backgrounds
         * live on ProjectPage.image). Each value is a decode of that tile's
         * imageSrc crop.
         */
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
    /**
     * Staged scaffold removal configuration. Absent in files saved before the
     * feature existed — such files load with scaffold removal disabled.
     */
    scaffold?: ScaffoldConfig;
    latencyOffset: number;
    /**
     * The pipeline stage the project was on when saved (e.g. 'sync-view',
     * 'result-view'), so a reload can resume there instead of the first step.
     * Absent in files saved before this feature.
     */
    currentView?: string;
    /** Cross-page reading order. Absent in files saved before this feature. */
    globalSequence?: SequenceStep[];
    /**
     * The recorded sync, one entry per reading-order step, parallel to
     * globalSequence. Timings live on the DERIVED flat tile list, not on the
     * page tiles, so they have to be saved separately — page tiles carry
     * startTime/endTime fields that nothing ever writes to, and a save built
     * from those contains only zeros. Per occurrence, not per tile: a repeated
     * chorus symbol is one tile sung at several different moments.
     * Absent in files saved before this was fixed; those load untimed.
     */
    timings?: { st: number; et: number; dir?: string }[];
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
            customImageBase64?: string; // Serialized base64 of customImage (runtime: SymbolTile.customImage)
        }[];
        /**
         * @deprecated Legacy per-page order, written for backward compatibility.
         * The canonical saved order is ProjectSaveData.globalSequence.
         */
        sequence: number[];
    }[];
}
