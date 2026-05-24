/// <reference path="./types/spicetify.d.ts" />

// --- Localization ---

const ru = {
  replaced:        "Трек заменён на версию без цензуры",
  saved:           "Замена сохранена",
  removed:         "Замена удалена",
  disabled:        "Замена отключена для этого трека",
  dbError:         "AntiCensor: не удалось загрузить базу треков",
  menuReplace:     "Заменить на версию без цензуры",
  menuRemove:      "Удалить замену без цензуры",
  promptLabel:     "Вставь прямую ссылку на аудиофайл без цензуры:",
};

const en: typeof ru = {
  replaced:        "Track replaced with uncensored version",
  saved:           "Replacement saved",
  removed:         "Replacement removed",
  disabled:        "Replacement disabled for this track",
  dbError:         "AntiCensor: failed to load track database",
  menuReplace:     "Replace with uncensored version",
  menuRemove:      "Remove uncensored replacement",
  promptLabel:     "Paste a direct link to the uncensored audio file:",
};

const t = navigator.language.toLowerCase().startsWith("ru") ? ru : en;

const DB_URL =
  "https://raw.githubusercontent.com/vvertax/AntiCensor/main/db.json";
const CACHE_KEY = "anticensor_db_cache";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface Database {
  tracks: Record<string, string>;
}

interface CacheEntry {
  ts: number;
  data: Database;
}

// --- Database loading ---

async function loadDatabase(): Promise<Database> {
  const raw = localStorage.getItem(CACHE_KEY);
  if (raw) {
    const entry = JSON.parse(raw) as CacheEntry;
    if (Date.now() - entry.ts < CACHE_TTL_MS) {
      return entry.data;
    }
  }

  try {
    const res = await fetch(DB_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as Database;
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data }));
    return data;
  } catch (e) {
    if (raw) {
      console.warn("[AntiCensor] fetch failed, using stale cache:", e);
      return (JSON.parse(raw) as CacheEntry).data;
    }
    throw e;
  }
}

// --- LocalOverrides & Blacklist ---

const OVERRIDES_KEY = "anticensor_overrides";
const BLACKLIST_KEY = "anticensor_blacklist";

function getOverrides(): Record<string, string> {
  const raw = localStorage.getItem(OVERRIDES_KEY);
  return raw ? (JSON.parse(raw) as Record<string, string>) : {};
}

function getBlacklist(): Set<string> {
  const raw = localStorage.getItem(BLACKLIST_KEY);
  return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
}

function saveOverride(trackId: string, url: string): void {
  // Adding an override un-blacklists the track
  const bl = getBlacklist();
  bl.delete(trackId);
  localStorage.setItem(BLACKLIST_KEY, JSON.stringify([...bl]));

  const overrides = getOverrides();
  overrides[trackId] = url;
  localStorage.setItem(OVERRIDES_KEY, JSON.stringify(overrides));
}

function removeReplacement(trackId: string): void {
  // Remove user override if present
  const overrides = getOverrides();
  delete overrides[trackId];
  localStorage.setItem(OVERRIDES_KEY, JSON.stringify(overrides));

  // Blacklist so DB entry is also ignored
  const bl = getBlacklist();
  bl.add(trackId);
  localStorage.setItem(BLACKLIST_KEY, JSON.stringify([...bl]));
}

function getReplacementUrl(trackId: string, db: Database): string | undefined {
  if (getBlacklist().has(trackId)) return undefined;
  return getOverrides()[trackId] ?? dbLookup(trackId, db);
}

// Returns URL regardless of blacklist — for pre-filling the edit dialog
function getRawUrl(trackId: string, db: Database): string | undefined {
  return getOverrides()[trackId] ?? dbLookup(trackId, db);
}

function dbLookup(trackId: string, db: Database): string | undefined {
  if (db.tracks[trackId]) return db.tracks[trackId];
  for (const key of Object.keys(db.tracks)) {
    if (key.split(",").some((id) => id.trim() === trackId)) {
      return db.tracks[key];
    }
  }
  return undefined;
}

// --- Track ID extraction ---

function trackIdFromUri(uri: string): string | null {
  const parts = uri.split(":");
  if (parts[0] === "spotify" && parts[1] === "track" && parts[2]) {
    return parts[2];
  }
  return null;
}

function getCurrentTrackId(): string | null {
  const uri = Spicetify.Player.data?.item?.uri;
  return uri ? trackIdFromUri(uri) : null;
}

// --- Preload ---

let preloadedAudio: HTMLAudioElement | null = null;
let preloadedUrl: string | null = null;

function preloadNextTrack(db: Database): void {
  const nextItems = Spicetify.Player.data?.nextItems;
  if (!nextItems?.length) return;

  const nextId = trackIdFromUri(nextItems[0].uri ?? "");
  if (!nextId) return;

  const url = getReplacementUrl(nextId, db);
  if (!url || url === preloadedUrl) return;

  if (preloadedAudio) {
    preloadedAudio.src = "";
    preloadedAudio.remove();
  }

  preloadedAudio = document.createElement("audio");
  preloadedAudio.preload = "auto";
  preloadedAudio.src = url;
  preloadedAudio.style.display = "none";
  document.body.appendChild(preloadedAudio);
  preloadedAudio.load();
  preloadedUrl = url;
}

// --- Custom volume slider ---

let customVolumeEl: HTMLElement | null = null;
let spotifyVolumeEl: HTMLElement | null = null;

function showCustomVolume(): void {
  // The volume bar contains: [mute button] + [slider child div]
  // We hide only the slider child and inject ours inside the same container.
  const volumeBar = document.querySelector<HTMLElement>(
    '.volume-bar[data-testid="volume-bar"]'
  );
  if (!volumeBar) return;

  // The slider is the first child that is NOT the mute button
  const sliderChild = volumeBar.querySelector<HTMLElement>(
    ":scope > *:not(button)"
  );
  if (!sliderChild) return;

  spotifyVolumeEl = sliderChild;
  sliderChild.style.visibility = "hidden";

  const gradient = (v: number) =>
    `linear-gradient(to right,#fff 0%,#fff ${v * 100}%,rgba(255,255,255,.3) ${v * 100}%,rgba(255,255,255,.3) 100%)`;

  const input = document.createElement("input");
  input.type = "range";
  input.min = "0";
  input.max = "1";
  input.step = "0.01";
  input.value = String(savedVolume);
  input.style.cssText = `
    -webkit-appearance:none;appearance:none;
    flex:1;height:4px;border-radius:2px;
    outline:none;cursor:pointer;margin:0;
    background:${gradient(savedVolume)};
  `;

  input.addEventListener("input", () => {
    const v = parseFloat(input.value);
    if (ourAudio) ourAudio.volume = v;
    savedVolume = v;
    input.style.background = gradient(v);
  });

  if (!document.getElementById("anticensor-vol-style")) {
    const style = document.createElement("style");
    style.id = "anticensor-vol-style";
    style.textContent = `
      #anticensor-volume input[type=range]::-webkit-slider-thumb {
        -webkit-appearance:none;appearance:none;
        width:12px;height:12px;border-radius:50%;
        background:#fff;cursor:pointer;
        opacity:0;transition:opacity .1s;
      }
      #anticensor-volume:hover input[type=range]::-webkit-slider-thumb {
        opacity:1;
      }
    `;
    document.head.appendChild(style);
  }

  const wrapper = document.createElement("div");
  wrapper.id = "anticensor-volume";
  wrapper.style.cssText = "flex:1;display:flex;align-items:center;";
  wrapper.appendChild(input);

  // Insert inside the volume bar, right after the mute button
  volumeBar.appendChild(wrapper);
  customVolumeEl = wrapper;
}

function hideCustomVolume(): void {
  customVolumeEl?.remove();
  customVolumeEl = null;
  if (spotifyVolumeEl) {
    spotifyVolumeEl.style.visibility = "";
    spotifyVolumeEl = null;
  }
}

// --- Audio replacement ---

let replacementPlaying = false;
let replacementAbort: (() => void) | null = null;
let ourAudio: HTMLAudioElement | null = null;
let savedVolume = 1;

function stopReplacement(): void {
  if (!ourAudio) return;
  ourAudio.pause();
  ourAudio.src = "";
  ourAudio.remove();
  ourAudio = null;
  replacementPlaying = false;
  replacementAbort = null;
  hideCustomVolume();
  Spicetify.Player.setVolume(savedVolume);
}

function replaceAudio(url: string): void {
  stopReplacement();

  savedVolume = Spicetify.Player.getVolume();
  Spicetify.Player.setVolume(0);
  showCustomVolume();

  // Use preloaded element if available for this URL
  if (preloadedAudio && preloadedUrl === url) {
    ourAudio = preloadedAudio;
    preloadedAudio = null;
    preloadedUrl = null;
  } else {
    ourAudio = document.createElement("audio");
    ourAudio.src = url;
    ourAudio.style.display = "none";
    document.body.appendChild(ourAudio);
  }

  ourAudio.volume = savedVolume;
  replacementPlaying = true;

  const startPlayback = () => {
    if (!ourAudio) return;
    ourAudio.currentTime = Spicetify.Player.getProgress() / 1000;
    // Unpause Spotify's UI so controls stay in sync
    if (!Spicetify.Player.isPlaying()) Spicetify.Player.play();
    ourAudio.play().catch((e: unknown) =>
      console.warn("[AntiCensor] play() failed:", e)
    );
  };

  if (ourAudio.readyState >= 3) {
    startPlayback();
  } else {
    ourAudio.addEventListener("canplay", startPlayback, { once: true });
    ourAudio.load();
  }

  const syncInterval = setInterval(() => {
    if (!ourAudio || !replacementPlaying) {
      clearInterval(syncInterval);
      return;
    }
    if (!Spicetify.Player.isPlaying()) return;
    const expected = Spicetify.Player.getProgress() / 1000;
    const diff = ourAudio.currentTime - expected;
    const absDiff = Math.abs(diff);
    if (absDiff > 0.5) {
      ourAudio.currentTime = expected;
      ourAudio.playbackRate = 1;
    } else if (absDiff > 0.1) {
      // Nudge rate to close the gap gradually (±5%)
      ourAudio.playbackRate = diff > 0 ? 0.95 : 1.05;
    } else {
      ourAudio.playbackRate = 1;
    }
  }, 500);

  const onEnded = () => {
    replacementPlaying = false;
    replacementAbort = null;
    stopReplacement();
    // Don't call Player.next() — Spotify is already playing silently in the
    // background and will handle repeat/next naturally on its own.
  };
  ourAudio.addEventListener("ended", onEnded, { once: true });

  const onPlayPause = () => {
    if (!ourAudio) return;
    if (Spicetify.Player.isPlaying()) {
      ourAudio.play().catch(() => {});
    } else {
      ourAudio.pause();
    }
  };
  Spicetify.Player.addEventListener("onplaypause", onPlayPause);

  replacementAbort = () => {
    replacementPlaying = false;
    clearInterval(syncInterval);
    ourAudio?.removeEventListener("ended", onEnded);
    Spicetify.Player.removeEventListener("onplaypause", onPlayPause);
    stopReplacement();
    replacementAbort = null;
  };
}

// --- Song change handler ---

function makeSongChangeHandler(db: Database) {
  return function onSongChange() {
    replacementAbort?.();

    setTimeout(() => {
      const trackId = getCurrentTrackId();
      if (!trackId) return;

      const url = getReplacementUrl(trackId, db);
      if (url) {
        try {
          replaceAudio(url);
          Spicetify.showNotification(t.replaced);
        } catch (e) {
          console.error("[AntiCensor] replaceAudio error:", e);
        }
      }

      preloadNextTrack(db);
    }, 300);
  };
}

// --- Context menu ---

function registerContextMenu(db: Database): void {
  new Spicetify.ContextMenu.Item(
    t.menuReplace,
    ([uri]: string[]) => {
      const trackId = trackIdFromUri(uri);
      if (!trackId) return;

      const existing = getRawUrl(trackId, db);
      const input = prompt(t.promptLabel, existing ?? "");
      if (input === null) return;

      const trimmed = input.trim();
      if (trimmed === "") {
        removeReplacement(trackId);
        Spicetify.showNotification(t.removed);
      } else {
        saveOverride(trackId, trimmed);
        Spicetify.showNotification(t.saved);
        if (getCurrentTrackId() === trackId) {
          replaceAudio(trimmed);
        }
      }
    },
    ([uri]: string[]) => uri.startsWith("spotify:track:")
  ).register();

  new Spicetify.ContextMenu.Item(
    t.menuRemove,
    ([uri]: string[]) => {
      const trackId = trackIdFromUri(uri);
      if (!trackId) return;
      removeReplacement(trackId);
      // Stop replacement if this track is currently playing
      if (getCurrentTrackId() === trackId) {
        replacementAbort?.();
        Spicetify.Player.seek(Spicetify.Player.getProgress());
      }
      Spicetify.showNotification(t.disabled);
    },
    ([uri]: string[]) => {
      const trackId = trackIdFromUri(uri);
      return trackId !== null && getReplacementUrl(trackId, db) !== undefined;
    }
  ).register();
}

// --- Spicetify readiness ---

async function waitForSpicetify(): Promise<void> {
  while (
    !Spicetify?.Player?.addEventListener ||
    !Spicetify?.Platform ||
    !Spicetify?.showNotification ||
    !Spicetify?.ContextMenu
  ) {
    await new Promise<void>((r) => setTimeout(r, 100));
  }
}

// --- Entry point ---

async function main(): Promise<void> {
  await waitForSpicetify();

  let db: Database;
  try {
    db = await loadDatabase();
  } catch (e) {
    console.error("[AntiCensor] failed to load database:", e);
    Spicetify.showNotification(t.dbError);
    return;
  }

  const onSongChange = makeSongChangeHandler(db);
  Spicetify.Player.addEventListener("songchange", onSongChange);
  onSongChange();
  registerContextMenu(db);
}

main();
