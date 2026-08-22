// Smarter tile detection for the Define stage's "Fill" / auto-detect.
//
// The original detector was a projection profile: any-dark-pixel row bands,
// then column bands inside them. That only works for dark tiles on a white
// page laid out in strict rows — a coloured background, a staggered layout,
// touching tiles, or a header/logo all defeat it.
//
// This detector recognises the tiles as OBJECTS instead:
//   1. model the page background from the page's own frame,
//   2. mark pixels that differ from it (tolerance driven by the sensitivity
//      slider), 3. group them into connected components,
//   4. merge nested/overlapping fragments (a tile whose fill matches the
//      background still yields its border ring + inner symbol as one box),
//   5. use grid statistics to reject non-tile outliers (titles, logos) and to
//      split runs of tiles that touch with no gap between them.
// The caller falls back to the legacy scan if this finds too little, so the
// worst case is exactly the old behaviour.

export interface DetectedBox { x: number; y: number; width: number; height: number; }

interface DetectOpts {
    /** The Define stage's sensitivity slider value (~150..255, higher = keener). */
    threshold: number;
    minWidth: number;
    minHeight: number;
}

// Work at a bounded resolution — plenty for tile geometry, and keeps the
// flood fill fast on multi-thousand-pixel PDF renders.
const MAX_W = 1000;

export function detectTiles(
    img: HTMLImageElement | HTMLCanvasElement,
    pageW: number,
    pageH: number,
    opts: DetectOpts,
): DetectedBox[] {
    const scale = Math.min(1, MAX_W / pageW);
    const w = Math.max(1, Math.round(pageW * scale));
    const h = Math.max(1, Math.round(pageH * scale));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(img, 0, 0, w, h);
    const data = g.getImageData(0, 0, w, h).data;

    // --- 1. Background model: dominant coarse colour of the page frame. ----
    // Tiles sit inside the page; the outer frame is almost always background.
    const bins = new Map<number, { n: number; r: number; g: number; b: number }>();
    const ring = Math.max(2, Math.round(Math.min(w, h) * 0.02));
    const addSample = (x: number, y: number) => {
        const i = (y * w + x) * 4;
        const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
        let b = bins.get(key);
        if (!b) { b = { n: 0, r: 0, g: 0, b: 0 }; bins.set(key, b); }
        b.n++; b.r += data[i]; b.g += data[i + 1]; b.b += data[i + 2];
    };
    for (let x = 0; x < w; x += 2) for (let y = 0; y < ring; y++) { addSample(x, y); addSample(x, h - 1 - y); }
    for (let y = 0; y < h; y += 2) for (let x = 0; x < ring; x++) { addSample(x, y); addSample(w - 1 - x, y); }
    let bg = { r: 255, g: 255, b: 255 }, best = -1;
    bins.forEach(b => { if (b.n > best) { best = b.n; bg = { r: b.r / b.n, g: b.g / b.n, b: b.b / b.n }; } });

    // --- 2. Content mask: distance from background beyond the tolerance. ---
    // Slider semantics preserved: a higher threshold means keener detection.
    const sens = Math.max(0, Math.min(1, (opts.threshold - 150) / 100));
    const tol = 95 - 65 * sens;                      // 245 default → ~33
    const tol2 = tol * tol;
    const mask = new Uint8Array(w * h);
    for (let p = 0, i = 0; p < w * h; p++, i += 4) {
        const dr = data[i] - bg.r, dg = data[i + 1] - bg.g, db = data[i + 2] - bg.b;
        if (dr * dr + dg * dg + db * db > tol2) mask[p] = 1;
    }

    // --- 3. Connected components (8-way, scanline flood with a stack). -----
    const label = new Int32Array(w * h);            // 0 = unvisited
    const boxes: { x0: number; y0: number; x1: number; y1: number; n: number }[] = [];
    const stack: number[] = [];
    let next = 0;
    for (let start = 0; start < w * h; start++) {
        if (!mask[start] || label[start]) continue;
        next++;
        let x0 = w, y0 = h, x1 = 0, y1 = 0, n = 0;
        stack.length = 0; stack.push(start); label[start] = next;
        while (stack.length) {
            const p = stack.pop()!;
            const px = p % w, py = (p / w) | 0;
            n++;
            if (px < x0) x0 = px; if (px > x1) x1 = px;
            if (py < y0) y0 = py; if (py > y1) y1 = py;
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
                if (!dx && !dy) continue;
                const nx = px + dx, ny = py + dy;
                if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
                const q = ny * w + nx;
                if (mask[q] && !label[q]) { label[q] = next; stack.push(q); }
            }
        }
        boxes.push({ x0, y0, x1, y1, n });
    }

    // --- 4. Candidate filter + nested-box merging. --------------------------
    const minW = Math.max(8, opts.minWidth * scale);
    const minH = Math.max(8, opts.minHeight * scale);
    let cands = boxes.filter(b => {
        const bw = b.x1 - b.x0 + 1, bh = b.y1 - b.y0 + 1;
        if (bw < minW || bh < minH) return false;
        if (bw > w * 0.92 && bh > h * 0.92) return false;   // the whole page
        const aspect = bw / bh;
        if (aspect < 0.25 || aspect > 4.5) return false;    // rules, text lines
        return true;
    }).map(b => ({ x: b.x0, y: b.y0, w: b.x1 - b.x0 + 1, h: b.y1 - b.y0 + 1, n: b.n }));

    // Largest first; absorb any candidate whose centre falls inside an accepted
    // box (a tile's inner symbol, or its border ring's fragments).
    cands.sort((a, b) => b.w * b.h - a.w * a.h);
    const merged: typeof cands = [];
    for (const cand of cands) {
        const cx = cand.x + cand.w / 2, cy = cand.y + cand.h / 2;
        const host = merged.find(m => cx >= m.x && cx <= m.x + m.w && cy >= m.y && cy <= m.y + m.h);
        if (host) {
            const nx0 = Math.min(host.x, cand.x), ny0 = Math.min(host.y, cand.y);
            host.w = Math.max(host.x + host.w, cand.x + cand.w) - nx0;
            host.h = Math.max(host.y + host.h, cand.y + cand.h) - ny0;
            host.x = nx0; host.y = ny0; host.n += cand.n;
        } else {
            merged.push({ ...cand });
        }
    }

    // --- 5. Grid statistics: find the tile population, reject outliers,
    //        split touching runs. ------------------------------------------
    let out = merged;
    const med = (arr: number[]) => arr.slice().sort((a, b) => a - b)[Math.floor(arr.length / 2)];
    if (out.length >= 3) {
        // Which candidates are "the tiles"? Not the most numerous — a big title
        // splits into more letter-blobs than there are tiles — but the cluster
        // that owns the most page ink. Bucket by log2(area) and pick the bucket
        // family with the largest SUMMED area.
        const buckets = new Map<number, { sum: number; areas: number[] }>();
        for (const b of out) {
            const a = b.w * b.h;
            const key = Math.round(Math.log2(a) * 2);   // half-octave granularity
            let bk = buckets.get(key);
            if (!bk) { bk = { sum: 0, areas: [] }; buckets.set(key, bk); }
            bk.sum += a; bk.areas.push(a);
        }
        let refAreas: number[] = [], bestSum = -1;
        buckets.forEach((bk, key) => {
            // A tile population can straddle a bucket edge; join neighbours.
            const lo = buckets.get(key - 1), hi = buckets.get(key + 1);
            const sum = bk.sum + (lo?.sum || 0) + (hi?.sum || 0);
            if (sum > bestSum) {
                bestSum = sum;
                refAreas = [...bk.areas, ...(lo?.areas || []), ...(hi?.areas || [])];
            }
        });
        const ref = med(refAreas);
        out = out.filter(b => { const a = b.w * b.h; return a > ref / 4 && a < ref * 4; });
    }
    // A run of tiles touching with no gap arrives as one box roughly n tiles
    // wide and one tile tall — split it evenly. With a surviving population,
    // the population's median width says how many; a lone run falls back to
    // its own aspect ratio (>=3 tiles wide, so a genuine 2:1 phrase tile is
    // never guessed apart).
    if (out.length >= 1) {
        const mh = med(out.map(b => b.h));
        const mw = med(out.map(b => b.w));
        const split: typeof out = [];
        for (const b of out) {
            let k = 0;
            if (out.length >= 4) {
                const est = Math.round(b.w / mw);
                if (est >= 2 && b.h < mh * 1.6 && Math.abs(b.w - est * mw) < mw * 0.35) k = est;
            }
            if (!k) {
                const est = Math.round(b.w / b.h);
                if (est >= 3 && Math.abs(b.w / b.h - est) < 0.3) k = est;
            }
            if (k >= 2) {
                for (let i = 0; i < k; i++) split.push({ x: b.x + (b.w * i) / k, y: b.y, w: b.w / k, h: b.h, n: b.n / k });
            } else {
                split.push(b);
            }
        }
        out = split;
    }

    // --- 6. Back to page coordinates. ---------------------------------------
    return out
        .map(b => ({
            x: Math.max(0, Math.round(b.x / scale)),
            y: Math.max(0, Math.round(b.y / scale)),
            width: Math.min(pageW, Math.round(b.w / scale)),
            height: Math.min(pageH, Math.round(b.h / scale)),
        }))
        .sort((a, b) => (Math.abs(a.y - b.y) > Math.min(a.height, b.height) * 0.5 ? a.y - b.y : a.x - b.x));
}
