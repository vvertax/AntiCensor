# AntiCensor · [Русский](README.md)

A [Spicetify](https://spicetify.app) extension that automatically replaces censored tracks with uncensored versions.

![preview](preview.gif)

## How it works

When a track starts playing, the extension checks its Spotify ID against a remote database. If a match is found, Spotify is muted and the clean version from the database plays instead. The volume slider is replaced with a custom one synced to the replacement audio.

## Installation

### Via Spicetify Marketplace

Find **AntiCensor** in the Extensions tab of the Spicetify Marketplace and click Install.

### Manual

```bash
cp AntiCensor.js ~/.config/spicetify/Extensions/
spicetify apply
```

## Usage

- The extension works automatically — no configuration needed
- A notification appears when a track is replaced
- Volume is controlled by a custom slider that replaces the default one during playback

### Context menu (right-click on a track)

| Item | Action |
|---|---|
| Replace with uncensored version | Manually bind your own audio file to this track |
| Remove uncensored replacement | Disable replacement for this track |

## Database

The database is stored in [`db.json`](db.json) in this repository. Audio files are in the [`tracks/`](tracks/) folder.

`db.json` format:

```json
{
  "tracks": {
    "SPOTIFY_TRACK_ID": "https://raw.githubusercontent.com/vvertax/AntiCensor/main/tracks/FILENAME",
    "ID1,ID2,ID3": "https://raw.githubusercontent.com/vvertax/AntiCensor/main/tracks/FILENAME"
  }
}
```

Multiple IDs separated by commas — for tracks that were released under different Spotify IDs.

The Spotify Track ID can be found in the track URL: `open.spotify.com/track/`**`TRACK_ID`**

## Limitations

- The progress bar and scrubber reflect the position of Spotify's censored track
- If the censored version is shorter than the original, the track will switch early
