# See Song

Turn symbol songboards into audio-synced karaoke videos — entirely in your browser.

See Song takes a symbol chart (a Widgit-style PDF or images) plus an audio track and
helps you:

1. **Refine** the tiles detected on each page (any grid size).
2. **Order** them into one continuous reading sequence — across pages, with repeats.
3. **Sync** each tile to the music by tapping along, then fine-tune on a timeline.
4. **Preview & export** as a video — conveyor style, a "follow the sheet" highlight
   mode, or a colour-coded **musical round** whose loop you mark on the timeline.

You can also **import a finished video** to pull its audio and frames back into an
editable project. Everything runs client-side; your files never leave your device.

## Run locally

**Prerequisites:** Node.js

```bash
npm install
npm run dev
```

Then open http://localhost:3000.

## Build

```bash
npm run build   # outputs static files to dist/
npm run preview # serve the production build
```

The build is a fully static site (no server, no API keys), so it can be hosted on any
static host.
