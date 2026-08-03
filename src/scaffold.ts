// Staged scaffold removal — masking helpers.
//
// A masked tile keeps its full footprint (position, size, border, timing and any
// active highlight/animation); only the instructional content inside it is
// covered, using a colour sampled from that tile's OWN background so differently
// coloured boards stay coherent. Colour detection and the inset-mask draw are
// isolated here to keep the scaffold logic out of the main render functions.
//
// How much gets covered is the level's ScaffoldMaskMode: the whole tile, just
// the word underneath, or just the picture above it.

import { ScaffoldMaskMode } from './types';

/** What a masked tile actually shows, once 'alternate' has been resolved. */
export type ResolvedMaskMode = 'blank' | 'symbol' | 'word';

/**
 * The mask mode configured for a practice level (1-based). Levels with nothing
 * recorded — including every level in a project saved before mask modes existed
 * — fall back to 'blank', which is what those projects used to do.
 */
export function levelMaskMode(modes: ScaffoldMaskMode[] | undefined, level: number): ScaffoldMaskMode {
    const m = modes && modes[level - 1];
    return m === 'symbol' || m === 'word' || m === 'alternate' ? m : 'blank';
}

/**
 * Settle 'alternate' into a concrete mode for one tile. `ordinal` is the tile's
 * position in the reading order, so the treatment alternates ALONG THE SONG —
 * predictable to watch, and stable whichever tiles happen to be assigned.
 */
export function resolveMaskMode(mode: ScaffoldMaskMode, ordinal: number): ResolvedMaskMode {
    if (mode !== 'alternate') return mode;
    return ordinal % 2 === 0 ? 'symbol' : 'word';
}

/**
 * Cumulative visibility test. A sequence occurrence with the given removalLevel
 * is hidden once the active practice level reaches it: level 1 hides tiles
 * assigned to 1; level 2 hides 1 and 2; and so on. undefined/0 = always visible.
 */
export function isMasked(removalLevel: number | undefined, activeLevel: number): boolean {
    return !!removalLevel && removalLevel > 0 && activeLevel >= removalLevel;
}

// Detected background colours, cached per source-tile key so repeated tiles and
// every frame reuse a single detection instead of re-sampling pixels each draw.
const _maskColorCache = new Map<string, string>();

/** Drop cached colours (e.g. after a project load replaces all the tiles). */
export function clearMaskColorCache() {
    _maskColorCache.clear();
}

/**
 * Estimate a tile's background colour from its rendered crop. Samples a ring of
 * points set in from the edges — far enough to clear the tile's coloured border,
 * but around the perimeter rather than the centre where the symbol/text sits —
 * and takes the per-channel median, which is robust to the odd sample that lands
 * on symbol ink. Result is cached under `key`. Falls back to white on any
 * failure (e.g. a tainted canvas), which is a safe, neutral mask.
 */
export function tileMaskColor(img: HTMLImageElement | null | undefined, key: string): string {
    if (!img) return '#ffffff';
    const cached = _maskColorCache.get(key);
    if (cached) return cached;

    let color = '#ffffff';
    try {
        // Work at a small fixed resolution — plenty for a colour estimate and cheap.
        const N = 48;
        const cv = document.createElement('canvas');
        cv.width = N; cv.height = N;
        const cx = cv.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | null;
        if (cx && (img.naturalWidth || img.width)) {
            cx.drawImage(img, 0, 0, N, N);
            const data = cx.getImageData(0, 0, N, N).data;
            // Inset ~16% to skip the border; sample two concentric rings of points.
            const rs = [0.16, 0.24];
            const ts = [0.16, 0.5, 0.84];
            const pts: Array<[number, number]> = [];
            for (const r of rs) {
                const lo = Math.round(N * r);
                const hi = Math.round(N * (1 - r));
                for (const t of ts) {
                    const m = Math.round(lo + (hi - lo) * t);
                    pts.push([lo, m], [hi, m], [m, lo], [m, hi]); // left/right/top/bottom edges
                }
            }
            const rC: number[] = [], gC: number[] = [], bC: number[] = [];
            for (const [x, y] of pts) {
                const i = (y * N + x) * 4;
                if (data[i + 3] < 8) continue; // skip transparent
                rC.push(data[i]); gC.push(data[i + 1]); bC.push(data[i + 2]);
            }
            if (rC.length) {
                const med = (arr: number[]) => {
                    const s = arr.slice().sort((a, b) => a - b);
                    return s[Math.floor(s.length / 2)];
                };
                color = `rgb(${med(rC)}, ${med(gC)}, ${med(bC)})`;
            }
        }
    } catch {
        // tainted/unsupported → keep the white fallback
    }
    _maskColorCache.set(key, color);
    return color;
}

/** Word band as a fraction of tile height, kept to values that leave both halves usable. */
export const WORD_BAND_MIN = 0.15;
export const WORD_BAND_MAX = 0.5;
export const WORD_BAND_DEFAULT = 0.3;

export function clampWordBand(v: number): number {
    if (!isFinite(v) || v <= 0) return WORD_BAND_DEFAULT;
    return Math.max(WORD_BAND_MIN, Math.min(WORD_BAND_MAX, v));
}

/**
 * Cover part of a tile's content with a filled rectangle in `color`, inset by a
 * narrow margin so the tile's own coloured border stays visible. The tile image
 * was drawn at top-left (dx,dy), size (dw,dh).
 *
 *   'blank'  covers all of it;
 *   'symbol' covers the bottom `wordBand` strip, leaving the picture;
 *   'word'   covers everything above that strip, leaving the word.
 *
 * Corners are rounded only where the mask meets the tile's edge, so a partial
 * mask reads as a strip of the tile's background rather than a floating box.
 */
export function drawContentMask(
    ctx: CanvasRenderingContext2D,
    color: string,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
    mode: ResolvedMaskMode = 'blank',
    wordBand: number = WORD_BAND_DEFAULT,
) {
    // Margin scales with tile size but stays within sensible pixel bounds, so the
    // border ring reads on both a tiny conveyor thumbnail and a large sheet tile.
    const margin = Math.max(3, Math.min(14, Math.min(dw, dh) * 0.1));
    const ix = dx + margin, iy = dy + margin;
    const iw = Math.max(0, dw - margin * 2), ih = Math.max(0, dh - margin * 2);
    if (iw <= 0 || ih <= 0) return;

    const band = clampWordBand(wordBand);
    let my = iy, mh = ih;
    // Corner radii, clockwise from top-left. A cut edge stays square.
    let corners: [boolean, boolean, boolean, boolean] = [true, true, true, true];
    if (mode === 'symbol') {          // keep the picture, cover the word below it
        mh = ih * band;
        my = iy + ih - mh;
        corners = [false, false, true, true];
    } else if (mode === 'word') {     // keep the word, cover the picture above it
        mh = ih * (1 - band);
        corners = [true, true, false, false];
    }
    if (mh < 1) return;

    const r = Math.min(10, iw / 2, mh / 2);
    const rr = corners.map(c => (c ? r : 0)) as [number, number, number, number];
    ctx.save();
    // Inherit the caller's globalAlpha so a faded conveyor neighbour keeps its
    // fade, but never carry a drop shadow onto the flat mask fill.
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(ix + rr[0], my);
    ctx.arcTo(ix + iw, my, ix + iw, my + mh, rr[1]);
    ctx.arcTo(ix + iw, my + mh, ix, my + mh, rr[2]);
    ctx.arcTo(ix, my + mh, ix, my, rr[3]);
    ctx.arcTo(ix, my, ix + iw, my, rr[0]);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
}
