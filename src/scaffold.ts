// Staged scaffold removal — masking helpers.
//
// A masked tile keeps its full footprint (position, size, border, timing and any
// active highlight/animation); only the instructional content inside it is
// covered, using a colour sampled from that tile's OWN background so differently
// coloured boards stay coherent. Colour detection and the inset-mask draw are
// isolated here to keep the scaffold logic out of the main render functions.

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

/**
 * Cover a tile's content with an inset filled rectangle in `color`, leaving a
 * narrow outer margin so the tile's own coloured border stays visible. The rect
 * is drawn where the tile image was drawn: top-left (dx,dy), size (dw,dh).
 */
export function drawContentMask(
    ctx: CanvasRenderingContext2D,
    color: string,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
) {
    // Margin scales with tile size but stays within sensible pixel bounds, so the
    // border ring reads on both a tiny conveyor thumbnail and a large sheet tile.
    const margin = Math.max(3, Math.min(14, Math.min(dw, dh) * 0.1));
    const ix = dx + margin, iy = dy + margin;
    const iw = Math.max(0, dw - margin * 2), ih = Math.max(0, dh - margin * 2);
    if (iw <= 0 || ih <= 0) return;
    const r = Math.min(10, iw / 2, ih / 2);
    ctx.save();
    // Inherit the caller's globalAlpha so a faded conveyor neighbour keeps its
    // fade, but never carry a drop shadow onto the flat mask fill.
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(ix + r, iy);
    ctx.arcTo(ix + iw, iy, ix + iw, iy + ih, r);
    ctx.arcTo(ix + iw, iy + ih, ix, iy + ih, r);
    ctx.arcTo(ix, iy + ih, ix, iy, r);
    ctx.arcTo(ix, iy, ix + iw, iy, r);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
}
