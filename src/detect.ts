// Smarter tile detection for the Define stage's "Fill" / auto-detect.
//
// The original detector was a projection profile: any-dark-pixel row bands,
// then column bands inside them. That only works for dark tiles on a white
// page laid out in strict rows. This detector recognises structures instead,
// tuned against real WidgitOnline songboards:
//
//   1. model the page background from the page's own frame;
//   2. mark pixels that differ from it (tolerance from the sensitivity
//      slider) and group them into connected components;
//   3. cluster nearby fragments (a borderless symbol arrives as several
//      pieces — picture, label — that belong together; a title's letters glue
//      into one long line that the aspect filter then rejects);
//   4. giant components get looked INSIDE: a bordered table (black gridlines,
//      no gaps) is split into its cells, keeping the ones with content; a
//      decorative page frame with an empty interior is dropped entirely;
//   5. tile population by ink share (a title's letter-blobs outnumber tiles
//      but never out-ink them), plus acceptance of secondary size-clusters
//      with >=3 similar members, so repeated borderless symbols (beats,
//      notes) survive while one-off logos do not;
//   6. runs of tiles touching with no gap are split evenly.
//
// The legacy scan remains a fallback when this finds nothing but the page
// plausibly has a grid, so no page detects worse than before.

export interface DetectedBox { x: number; y: number; width: number; height: number; }

interface DetectOpts {
    /** The Define stage's sensitivity slider (~150..255, higher = keener). */
    threshold: number;
    minWidth: number;
    minHeight: number;
}

interface Cand { x: number; y: number; w: number; h: number; n: number; }

const MAX_W = 1000;   // working resolution cap — geometry doesn't need more

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

    // --- 1. Background: dominant coarse colour of the page's outer ring. ---
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

    // --- 2. Content mask (colour distance beyond the slider's tolerance). --
    const sens = Math.max(0, Math.min(1, (opts.threshold - 150) / 100));
    const tol = 95 - 65 * sens;
    const tol2 = tol * tol;
    const mask = new Uint8Array(w * h);
    for (let p = 0, i = 0; p < w * h; p++, i += 4) {
        const dr = data[i] - bg.r, dg = data[i + 1] - bg.g, db = data[i + 2] - bg.b;
        if (dr * dr + dg * dg + db * db > tol2) mask[p] = 1;
    }
    const lum = (p: number) => (data[p * 4] + data[p * 4 + 1] + data[p * 4 + 2]) / 3;

    // --- 3. Connected components (8-way scanline flood). -------------------
    const label = new Int32Array(w * h);
    const raw: Cand[] = [];
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
        if (n >= 12) raw.push({ x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, n });
    }

    // --- 3.5 Text-line gluing. ---------------------------------------------
    // A title or caption arrives as one blob per letter; glued into their line
    // they become long and thin and the aspect filter rejects them. Gluing is
    // ONLY for small, baseline-aligned neighbours — tile-sized components never
    // glue, so tight grids (cells a few pixels apart) stay individual.
    const maxGlueH = h * 0.085;
    let clusters: Cand[] = raw.map(r => ({ ...r }));
    for (let changed = true; changed;) {
        changed = false;
        outer:
        for (let i = 0; i < clusters.length; i++) {
            for (let j = i + 1; j < clusters.length; j++) {
                const a = clusters[i], b = clusters[j];
                if (a.h > maxGlueH || b.h > maxGlueH) continue;
                const yOverlap = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
                if (yOverlap < Math.min(a.h, b.h) * 0.55) continue;
                const gap = Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w);
                if (gap > Math.min(a.h, b.h) * 0.9) continue;
                const nx = Math.min(a.x, b.x), ny = Math.min(a.y, b.y);
                a.w = Math.max(a.x + a.w, b.x + b.w) - nx;
                a.h = Math.max(a.y + a.h, b.y + b.h) - ny;
                a.x = nx; a.y = ny; a.n += b.n;
                clusters.splice(j, 1);
                changed = true;
                break outer;
            }
        }
    }

    // --- 3.7 Caption attach. ------------------------------------------------
    // A borderless Widgit symbol carries its word BELOW it as a separate
    // component; a bordered tile keeps the word inside its border, so this
    // never fires for those. Fold a text-sized, text-shaped line into the
    // symbol directly above it, so the tile crop keeps its word.
    const pageArea = w * h;
    const capGapMax = h * 0.06;
    for (let ti = clusters.length - 1; ti >= 0; ti--) {
        const t = clusters[ti];
        // Text-sized and not tall-thin — a short word ("ta") is square, so the
        // floor is below 1, not a strict wider-than-tall test.
        if (t.h > maxGlueH || t.w / t.h < 0.7) continue;
        if (t.y + t.h > h * 0.94) continue;                   // page-footer strip, never a caption
        const tcx = t.x + t.w / 2, tcy = t.y + t.h / 2;
        let host = -1, bestD = Infinity;
        for (let ai = 0; ai < clusters.length; ai++) {
            if (ai === ti) continue;
            const a = clusters[ai];
            if (a.w * a.h >= pageArea * 0.30) continue;       // giants: stage 4's problem
            // Content whose centre sits INSIDE a box belongs to that box (a
            // bordered tile's own word/picture) — it must never be read as a
            // caption for a touching neighbour above.
            if (tcx > a.x && tcx < a.x + a.w && tcy > a.y && tcy < a.y + a.h) { host = ai; break; }
            if (a.h <= t.h * 2.2) continue;                   // host must dwarf its caption
            const gap = t.y - (a.y + a.h);
            if (gap > capGapMax || gap < -t.h) continue;      // directly below (slight overlap ok)
            const dx = Math.abs(tcx - (a.x + a.w / 2));
            if (dx > Math.max(a.w, t.w) * 0.5) continue;      // centred under it
            // A caption hugs its symbol's footprint; a line that would grow
            // the host far sideways is page text, not this tile's word. The
            // height term keeps tall thin glyphs (a crotchet stem) able to
            // take a word wider than themselves.
            const uw = Math.max(a.x + a.w, t.x + t.w) - Math.min(a.x, t.x);
            if (uw > Math.max(a.w * 1.35, a.h * 0.9)) continue;
            const d = dx + Math.max(0, gap);
            if (d < bestD) { bestD = d; host = ai; }
        }
        if (host < 0) continue;
        const a = clusters[host];
        const nx = Math.min(a.x, t.x), ny = Math.min(a.y, t.y);
        a.w = Math.max(a.x + a.w, t.x + t.w) - nx;
        a.h = Math.max(a.y + a.h, t.y + t.h) - ny;
        a.x = nx; a.y = ny; a.n += t.n;
        clusters.splice(ti, 1);
    }

    // --- 4. Giant components: table? frame? -------------------------------
    // A bordered table (gridlines, zero gaps) is one component covering much
    // of the page: split it at its internal gridlines and keep the cells that
    // contain anything. A decorative frame with an empty interior is dropped.
    const contentFrac = (bx: number, by: number, bw: number, bh: number) => {
        let m = 0, t = 0;
        const step = Math.max(1, Math.round(Math.min(bw, bh) / 64));
        for (let y = by; y < by + bh; y += step) for (let x = bx; x < bx + bw; x += step) {
            t++; if (mask[y * w + x]) m++;
        }
        return t ? m / t : 0;
    };
    const expanded: Cand[] = [];
    for (const b of clusters) {
        if (b.w * b.h < pageArea * 0.30) { expanded.push(b); continue; }
        // Gridline profile: strongly dark rows/columns spanning the component.
        const darkFracCol = (x: number) => {
            let d = 0, t = 0;
            for (let y = b.y; y < b.y + b.h; y += 2) { t++; if (lum(y * w + x) < 140) d++; }
            return t ? d / t : 0;
        };
        const darkFracRow = (y: number) => {
            let d = 0, t = 0;
            for (let x = b.x; x < b.x + b.w; x += 2) { t++; if (lum(y * w + x) < 140) d++; }
            return t ? d / t : 0;
        };
        const inset = Math.round(Math.min(b.w, b.h) * 0.04);
        const findLines = (from: number, to: number, frac: (v: number) => number) => {
            const lines: { s: number; e: number }[] = [];
            let inL = false, s = 0;
            for (let v = from + inset; v <= to - inset; v++) {
                const on = frac(v) > 0.72;
                if (on && !inL) { inL = true; s = v; }
                else if (!on && inL) { inL = false; lines.push({ s, e: v - 1 }); }
            }
            if (inL) lines.push({ s, e: to - inset });
            return lines;
        };
        const vLines = findLines(b.x, b.x + b.w - 1, darkFracCol);
        const hLines = findLines(b.y, b.y + b.h - 1, darkFracRow);
        if (vLines.length >= 1 && hLines.length >= 1) {
            // A table: cells are the spans between the gridlines (and edges).
            const xCuts = [b.x, ...vLines.flatMap(l => [l.s, l.e + 1]), b.x + b.w];
            const yCuts = [b.y, ...hLines.flatMap(l => [l.s, l.e + 1]), b.y + b.h];
            for (let yi = 0; yi + 1 < yCuts.length; yi += 2) {
                for (let xi = 0; xi + 1 < xCuts.length; xi += 2) {
                    const cx = xCuts[xi], cy = yCuts[yi];
                    const cw = xCuts[xi + 1] - cx, chh = yCuts[yi + 1] - cy;
                    if (cw < 12 || chh < 12) continue;
                    const m = Math.max(2, Math.round(Math.min(cw, chh) * 0.08));
                    // Keep cells that hold anything (ink or a coloured fill).
                    if (contentFrac(cx + m, cy + m, cw - 2 * m, chh - 2 * m) > 0.04) {
                        expanded.push({ x: cx, y: cy, w: cw, h: chh, n: cw * chh });
                    }
                }
            }
        } else {
            // No internal grid. Empty decorative frame → drop; a genuine
            // full-card tile (frame WITH content inside) → keep whole.
            const m = Math.round(Math.min(b.w, b.h) * 0.10);
            const inner = contentFrac(b.x + m, b.y + m, b.w - 2 * m, b.h - 2 * m);
            if (inner > 0.08) expanded.push(b);
            // else: hollow frame — dropped
        }
    }

    // --- 4.5 Shape filter + nested merge. -----------------------------------
    const minW = Math.max(8, opts.minWidth * scale);
    const minH = Math.max(8, opts.minHeight * scale);
    let cands = expanded.filter(b => {
        if (b.w < minW || b.h < minH) return false;
        if (b.w > w * 0.92 && b.h > h * 0.92) return false;
        // Page furniture floor: a footer logo or a stray mark is far smaller
        // than any singable tile. 0.1% of the page.
        if (b.w * b.h < pageArea * 0.001) return false;
        const aspect = b.w / b.h;
        return aspect >= 0.22 && aspect <= 4.6;
    });
    cands.sort((a, b) => b.w * b.h - a.w * a.h);
    const merged: Cand[] = [];
    for (const cand of cands) {
        const cx = cand.x + cand.w / 2, cy = cand.y + cand.h / 2;
        const host = merged.find(m => cx >= m.x && cx <= m.x + m.w && cy >= m.y && cy <= m.y + m.h);
        if (host) {
            const nx0 = Math.min(host.x, cand.x), ny0 = Math.min(host.y, cand.y);
            host.w = Math.max(host.x + host.w, cand.x + cand.w) - nx0;
            host.h = Math.max(host.y + host.h, cand.y + cand.h) - ny0;
            host.x = nx0; host.y = ny0; host.n += cand.n;
        } else merged.push({ ...cand });
    }

    // --- 5. Population: dominant ink cluster + repeated-pattern clusters. ---
    const med = (arr: number[]) => arr.slice().sort((a, b) => a - b)[Math.floor(arr.length / 2)];
    let out = merged;
    if (out.length >= 3) {
        const key = (b: Cand) => Math.round(Math.log2(b.w * b.h) * 2);
        const groups = new Map<number, Cand[]>();
        for (const b of out) {
            const k = key(b);
            if (!groups.has(k)) groups.set(k, []);
            groups.get(k)!.push(b);
        }
        // Family = bucket + neighbours. Dominant family = the one owning the
        // most ink; secondary families survive with >=3 similar members (a
        // repeated symbol is a pattern; a one-off logo is not).
        const famOf = (k: number) => [...(groups.get(k - 1) || []), ...(groups.get(k) || []), ...(groups.get(k + 1) || [])];
        let domK = 0, bestInk = -1;
        groups.forEach((_, k) => {
            const ink = famOf(k).reduce((s, b) => s + b.w * b.h, 0);
            if (ink > bestInk) { bestInk = ink; domK = k; }
        });
        const domFam = famOf(domK);
        const domRef = med(domFam.map(b => b.w * b.h));
        const kept = new Set<Cand>();
        domFam.forEach(b => kept.add(b));
        groups.forEach((_, k) => {
            if (Math.abs(k - domK) <= 1) return;
            const fam = famOf(k);
            const ref = med(fam.map(b => b.w * b.h));
            if (fam.length >= 3 && ref >= domRef / 14) fam.forEach(b => kept.add(b));
        });
        out = out.filter(b => {
            if (kept.has(b)) return true;
            const a = b.w * b.h;
            return a > domRef / 4 && a < domRef * 4;
        });
    }

    // --- 5.5 Split runs of tiles touching with no gap. ----------------------
    if (out.length >= 1) {
        const mh = med(out.map(b => b.h));
        const mw = med(out.map(b => b.w));
        const split: Cand[] = [];
        for (const b of out) {
            let k = 0;
            // Only a box markedly wider than tall can be a run of tiles — a
            // normal tile in a MIXED population (small symbols + big bordered
            // tiles) must never be carved to the small population's width.
            if (out.length >= 4 && b.w / b.h >= 1.8) {
                const est = Math.round(b.w / mw);
                if (est >= 2 && b.h < mh * 1.6 && Math.abs(b.w - est * mw) < mw * 0.35) k = est;
            }
            if (!k) {
                const est = Math.round(b.w / b.h);
                if (est >= 3 && Math.abs(b.w / b.h - est) < 0.3) k = est;
            }
            if (k >= 2) {
                for (let i = 0; i < k; i++) split.push({ x: b.x + (b.w * i) / k, y: b.y, w: b.w / k, h: b.h, n: b.n / k });
            } else split.push(b);
        }
        out = split;
    }

    // --- 6. Back to page coordinates, reading order. ------------------------
    return out
        .map(b => ({
            x: Math.max(0, Math.round(b.x / scale)),
            y: Math.max(0, Math.round(b.y / scale)),
            width: Math.min(pageW, Math.round(b.w / scale)),
            height: Math.min(pageH, Math.round(b.h / scale)),
        }))
        .sort((a, b) => (Math.abs(a.y - b.y) > Math.min(a.height, b.height) * 0.5 ? a.y - b.y : a.x - b.x));
}
