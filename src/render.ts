// Faster-than-real-time video rendering.
//
// The original export pipeline is real-time by construction: it drives the
// canvas from `requestAnimationFrame`, clocks itself off a live AudioContext,
// and hands a `captureStream` to MediaRecorder — an API that samples the canvas
// as it is painted. A three-minute song therefore takes three minutes, and a set
// of practice videos takes that again for every stage. Measured: a 72s timeline
// exported in 74.2s, and 720p and 1080p took exactly the same time, which is the
// giveaway — nothing was working hard, it was waiting on a clock.
//
// This module renders the same frames deterministically instead. Frame i is
// simply the picture at t = i/fps: draw it, hand it to a WebCodecs VideoEncoder,
// move on. Audio is rendered through an OfflineAudioContext and encoded
// separately, then both are muxed on one shared timeline.
//
// Two things fall out of that beyond speed, and they matter as much:
//   - The output no longer depends on what the browser was doing at the time.
//     Under the old pipeline, switching tabs throttled rAF while the audio clock
//     kept running, so the render "finished" on schedule having captured frozen
//     frames. There was no warning and no way to tell from the file.
//   - Audio and video share one timeline by construction, so they cannot drift.
//
// Speed is NOT guaranteed: software VP9 measured 2.85x real time at 720p but
// 0.81x — slower than the old path — at 1080p on a machine with no hardware
// encoder. So `calibrateEncoder` measures the actual machine before committing,
// and the caller falls back to the real-time path when this one would lose.

export interface FastRenderSize { w: number; h: number }

export interface FastRenderOptions {
    size: FastRenderSize;
    fps: number;
    durationSec: number;
    bitrate: number;
    /** Paint the shared canvas for song-time `t`. Must be synchronous. */
    drawFrame: (t: number) => void;
    /** The canvas `drawFrame` paints into — wrapped directly as each VideoFrame. */
    canvas: HTMLCanvasElement;
    /** Decoded track to lay under the video, or null for a silent render. */
    audioBuffer: AudioBuffer | null;
    onProgress: (frac: number) => void;
    signal: AbortSignal;
}

/** Thrown when the caller aborts; callers unwind quietly rather than alerting. */
export class FastRenderCancelled extends Error {
    constructor() { super('Render cancelled'); this.name = 'FastRenderCancelled'; }
}

const VIDEO_CODECS = ['vp09.00.10.08', 'vp8'] as const;
const AUDIO_CODEC = 'opus';

/** Everything this path needs, present and willing. Cheap; safe to call often. */
export function hasWebCodecs(): boolean {
    return typeof VideoEncoder !== 'undefined'
        && typeof AudioEncoder !== 'undefined'
        && typeof VideoFrame !== 'undefined'
        && typeof AudioData !== 'undefined'
        && typeof OfflineAudioContext !== 'undefined';
}

/**
 * First video codec the machine will actually encode at this size, or null.
 * VP9 first: markedly better compression for symbols over flat backgrounds,
 * which is most of what these videos are.
 */
export async function pickVideoCodec(size: FastRenderSize, bitrate: number): Promise<string | null> {
    if (!hasWebCodecs()) return null;
    for (const codec of VIDEO_CODECS) {
        try {
            const s = await VideoEncoder.isConfigSupported({
                codec, width: size.w, height: size.h, bitrate, framerate: 30,
            });
            if (s.supported) return codec;
        } catch { /* try the next one */ }
    }
    return null;
}

/**
 * Measure real throughput on THIS machine, in milliseconds per frame.
 *
 * There is no way to ask a browser whether its encoder is hardware-backed, so
 * this measures instead. Two details matter, both learned the hard way:
 *
 *  - It draws the REAL frames, sampled across the song, not a synthetic test
 *    pattern. A flat rectangle encodes far quicker than a screen of symbol tiles
 *    with shadows, and a synthetic probe predicted 1.91x real time at 1080p on a
 *    machine that then delivered 0.85x.
 *  - It throws away the first frames. Encoder start-up makes the opening burst
 *    unrepresentative in both directions, which is how a 1080p probe once came
 *    out FASTER than the same probe at 720p.
 *
 * Costs roughly a second, which a multi-minute render can well afford.
 */
export async function calibrateEncoder(opts: {
    size: FastRenderSize;
    codec: string;
    bitrate: number;
    canvas: HTMLCanvasElement;
    drawFrame: (t: number) => void;
    durationSec: number;
    frames?: number;
    warmup?: number;
}): Promise<number> {
    const { size, codec, bitrate, canvas, drawFrame, durationSec } = opts;
    const frames = opts.frames ?? 24;
    const warmup = opts.warmup ?? 8;

    const encoder = new VideoEncoder({ output: () => {}, error: () => {} });
    encoder.configure({ codec, width: size.w, height: size.h, bitrate, framerate: 30, latencyMode: 'realtime' });

    let t0 = 0;
    for (let i = 0; i < frames; i++) {
        // Spread the samples over the whole song so the measurement sees the
        // real range of content, not just the opening bar.
        drawFrame((i / frames) * durationSec);
        const frame = new VideoFrame(canvas, { timestamp: Math.round((i * 1e6) / 30) });
        encoder.encode(frame, { keyFrame: i === 0 });
        frame.close();
        if (encoder.encodeQueueSize > 6) await new Promise(r => setTimeout(r, 0));
        if (i === warmup - 1) { await encoder.flush(); t0 = performance.now(); }
    }
    await encoder.flush();
    const measured = frames - warmup;
    const ms = (performance.now() - t0) / Math.max(1, measured);
    encoder.close();
    return ms;
}

/**
 * Render one video without a real-time clock anywhere, and return the muxed
 * WebM. Resolves only once every frame has been encoded and the container is
 * finalised, so the caller gets a complete file or an exception.
 */
export async function renderFast(opts: FastRenderOptions): Promise<Blob> {
    const { size, fps, durationSec, bitrate, drawFrame, canvas, audioBuffer, onProgress, signal } = opts;
    const codec = await pickVideoCodec(size, bitrate);
    if (!codec) throw new Error('No WebCodecs video encoder available.');

    // webm-muxer is only pulled down when a fast render actually happens, the
    // same treatment PDF.js/jsPDF/JSZip get — it never enters the initial load.
    const { Muxer, ArrayBufferTarget } = await import('webm-muxer');

    // Audio first: the muxer wants to know whether an audio track exists, and
    // OfflineAudioContext renders far quicker than real time so this is cheap.
    const audio = audioBuffer ? await renderAudioChunks(audioBuffer, durationSec, signal) : null;

    const target = new ArrayBufferTarget();
    const muxer = new Muxer({
        target,
        video: { codec: codec.startsWith('vp09') ? 'V_VP9' : 'V_VP8', width: size.w, height: size.h, frameRate: fps },
        audio: audio ? { codec: 'A_OPUS', numberOfChannels: audio.channels, sampleRate: audio.sampleRate } : undefined,
        firstTimestampBehavior: 'offset',
    });

    let encodeError: Error | null = null;
    const encoder = new VideoEncoder({
        output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
        error: (e) => { encodeError = e instanceof Error ? e : new Error(String(e)); },
    });
    encoder.configure({
        codec, width: size.w, height: size.h, bitrate, framerate: fps,
        latencyMode: 'realtime',    // measured ~20% quicker than 'quality' at the same bitrate
    });

    const totalFrames = Math.max(1, Math.ceil(durationSec * fps));
    try {
        for (let i = 0; i < totalFrames; i++) {
            if (signal.aborted) throw new FastRenderCancelled();
            if (encodeError) throw encodeError;

            drawFrame(i / fps);
            const frame = new VideoFrame(canvas, {
                timestamp: Math.round((i * 1e6) / fps),
                duration: Math.round(1e6 / fps),
            });
            // A keyframe every 2s keeps seeking usable without inflating the file.
            encoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
            frame.close();

            // Backpressure. Without this the encoder queue grows unbounded and a
            // long song exhausts memory before it finishes.
            if (encoder.encodeQueueSize > 8) {
                while (encoder.encodeQueueSize > 4) await new Promise(r => setTimeout(r, 0));
            } else if ((i & 15) === 0) {
                // Yield periodically anyway so the overlay repaints and Cancel is
                // clickable — this loop otherwise never lets go of the main thread.
                await new Promise(r => setTimeout(r, 0));
            }
            onProgress((i + 1) / totalFrames);
        }
        await encoder.flush();
        if (encodeError) throw encodeError;
        // Opus needs its decoder config (the OpusHead) carried into the container
        // or the track will not play; webm-muxer reads it off the chunk metadata.
        if (audio) for (const c of audio.chunks) muxer.addAudioChunkRaw(c.data, c.type, c.timestamp, c.meta);
        muxer.finalize();
    } finally {
        if (encoder.state !== 'closed') encoder.close();
    }

    return new Blob([target.buffer], { type: 'video/webm' });
}

/**
 * Render the track offline and Opus-encode it. Returns raw chunks rather than
 * feeding the muxer directly so the caller can add them after the video track,
 * which keeps the muxer's cue points tidy.
 */
async function renderAudioChunks(buffer: AudioBuffer, durationSec: number, signal: AbortSignal) {
    const sampleRate = buffer.sampleRate;
    const channels = Math.min(2, buffer.numberOfChannels);
    const frames = Math.ceil(durationSec * sampleRate);

    // Offline render pads the track out to the video's length, so a song shorter
    // than its tile timeline ends in silence rather than a truncated file.
    const offline = new OfflineAudioContext(channels, frames, sampleRate);
    const src = offline.createBufferSource();
    src.buffer = buffer;
    src.connect(offline.destination);
    src.start(0);
    const rendered = await offline.startRendering();

    const chunks: { data: Uint8Array; type: 'key' | 'delta'; timestamp: number; meta?: EncodedAudioChunkMetadata }[] = [];
    let encodeError: Error | null = null;
    const encoder = new AudioEncoder({
        output: (chunk, meta) => {
            const data = new Uint8Array(chunk.byteLength);
            chunk.copyTo(data);
            chunks.push({ data, type: chunk.type as 'key' | 'delta', timestamp: chunk.timestamp, meta });
        },
        error: (e) => { encodeError = e instanceof Error ? e : new Error(String(e)); },
    });
    encoder.configure({ codec: AUDIO_CODEC, numberOfChannels: channels, sampleRate, bitrate: 128000 });

    // Feed it in ~20ms slices, interleaved as the encoder expects.
    const SLICE = Math.round(sampleRate * 0.02);
    const planar: Float32Array[] = [];
    for (let c = 0; c < channels; c++) planar.push(rendered.getChannelData(c));
    const scratch = new Float32Array(SLICE * channels);

    for (let off = 0; off < rendered.length; off += SLICE) {
        if (signal.aborted) { encoder.close(); throw new FastRenderCancelled(); }
        if (encodeError) { encoder.close(); throw encodeError; }
        const n = Math.min(SLICE, rendered.length - off);
        for (let i = 0; i < n; i++) {
            for (let c = 0; c < channels; c++) scratch[i * channels + c] = planar[c][off + i];
        }
        const data = new AudioData({
            format: 'f32',
            sampleRate,
            numberOfFrames: n,
            numberOfChannels: channels,
            timestamp: Math.round((off / sampleRate) * 1e6),
            data: scratch.subarray(0, n * channels),
        });
        encoder.encode(data);
        data.close();
        if (encoder.encodeQueueSize > 16) await new Promise(r => setTimeout(r, 0));
    }
    await encoder.flush();
    encoder.close();
    if (encodeError) throw encodeError;
    return { chunks, channels, sampleRate };
}
