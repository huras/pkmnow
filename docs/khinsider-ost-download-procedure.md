# KHInsider OST Download Procedure

This project uses `scripts/download-khinsider-album.mjs` to crawl a KHInsider album page and download all MP3 tracks.

## Quick Command

```bash
node "scripts/download-khinsider-album.mjs" \
  --album-url "https://downloads.khinsider.com/game-soundtracks/album/<album-slug>" \
  --dest "audio/bgm/<Album Folder Name>"
```

## Standard Destination Convention

- Base folder: `audio/bgm/`
- One folder per album
- Use a clear album name, usually: `<Game/Album Name> (<Year>)`

Examples used in this repo:

- `audio/bgm/Ragnarok Battle Offline Vol.1`
- `audio/bgm/Ragnarok Battle Offline Original Sound Track Vol.2 Chocolate Night (2006)`
- `audio/bgm/Pokemon Black 2 White 2 (2012)`
- `audio/bgm/Pokemon Black and White`

## Behavior of the Script

- Crawls album song pages from KHInsider
- Extracts MP3 links and chooses the best candidate when multiple are available
- Downloads all tracks into the destination folder
- Skips files that already exist and are large enough
- Writes `manifest.json` inside the destination with source URLs and metadata

## Retry Strategy (Important)

If you see intermittent network errors such as `fetch failed`:

1. Run the exact same command again.
2. Keep `--dest` unchanged.
3. The script will skip already downloaded files and fetch missing ones.

This makes retries safe and incremental.

## Verification Checklist

After completion, confirm:

1. Final line reports `Done: <ok> ok, <failed> failed`
2. `failed` is `0`
3. `manifest.json` exists in the destination folder

## Optional Flags

- `--overwrite`: redownloads files even if they already exist

Example:

```bash
node "scripts/download-khinsider-album.mjs" \
  --album-url "https://downloads.khinsider.com/game-soundtracks/album/pokemon-black-and-white" \
  --dest "audio/bgm/Pokemon Black and White" \
  --overwrite
```
