# Watermark 9000

Batch watermark + transcode export queue for turnovers. Build a queue of
clips × output presets (Sound, Music, VFX, Avid, Review…), press **Start Queue**, walk away.

## Run

- **App:** `release/Watermark 9000-darwin-arm64/Watermark 9000.app` (drag to /Applications)
- **From source:** `npm start` (builds the UI and launches Electron)
- **Rebuild the .app:** `npm run package` (also writes `release/Watermark-9000-arm64.zip`)
- **Install on another Mac:** copy the zip, double-click to unzip, then right-click the app → Open
  the first time (it isn't notarised).

No Homebrew needed: the app bundles a self-contained ffmpeg 6.0 + ffprobe (Apple silicon) in
`Contents/Resources/bin`. If a system ffmpeg is installed and has x264, VideoToolbox ProRes and
DNxHD, the app prefers it (current Homebrew builds encode x264 ~30% faster). The engine in use is
shown in Settings. Set `WM_NO_SYSTEM_FFMPEG=1` to force the bundled binaries for testing.

## How it works

- **Export Queue (⌘1)** — drop clips/folders into the Media Pool, tick output presets,
  *Add to Render Queue*. Jobs run N in parallel with per-job progress/fps/ETA and a
  queue ETA + "finishes at" clock. Drag rows to reorder; the queue survives restarts;
  the Mac is kept awake while rendering; you get a notification when it's done.
- **Watermark Presets (⌘2)** — text (with tokens like `{filename}`, `{recipient}`,
  `{show}`, `{date}`), running timecode (source / zero / custom, drop-frame aware),
  frame counter and image layers. Drag to move, round handle rotates, square handle
  scales. Font, weight, colour, opacity, tracking, box, outline, shadow. Sizes are
  relative to frame height, so one preset works at any resolution.
- **Render Frame** runs the real ffmpeg pipeline for one frame so you can confirm the
  exact burn-in before committing a queue.

## Engine notes

The ffmpeg build has no `drawtext`, so overlays are rendered by the same canvas code
as the editor: static parts become cropped PNG layers; running timecode/frame
counters become a 0–9 digit strip that ffmpeg crops per frame with expressions
derived from the frame number (verified identical to the preview, incl. drop-frame).

Speed (M4 Pro): software decode + x264 `superfast` is ~3× faster than the single
shared VideoToolbox H.264 engine, so H.264 defaults to x264; ProRes and HEVC use
Apple hardware. Hardware decode is off by default (it was slower in testing).
