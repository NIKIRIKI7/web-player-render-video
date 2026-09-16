<div align="center">
  <img src="./assets/readme/hero.svg" width="100%" alt="browser-tsx-sandbox — компиляция TSX и рендер Remotion-видео прямо в браузере">

  <p>
    <a href="https://www.npmjs.com/package/browser-tsx-sandbox"><img alt="npm" src="https://img.shields.io/npm/v/browser-tsx-sandbox?color=4FDBC8&label=npm"></a>
    <img alt="types included" src="https://img.shields.io/badge/types-included-67E8F9">
    <img alt="Remotion" src="https://img.shields.io/badge/Remotion-%E2%89%A54-C4A8FF">
    <img alt="100% client-side" src="https://img.shields.io/badge/100%25-client--side-4FDBC8">
    <img alt="license MIT" src="https://img.shields.io/badge/license-MIT-8FA2C2">
  </p>

  <p><b>Компилирует TSX и рендерит Remotion-видео прямо в браузере.</b><br>
  Без сервера и без сборки бандла: npm-зависимости тянутся с <code>esm.sh</code>, ассеты — через <code>blob:</code>, предпросмотр — в официальном <code>@remotion/player</code>.</p>
</div>

> ## ⚠️ Статус: активная разработка
>
> **Библиотека находится в стадии активной разработки и тестирования.** Пока **не рекомендуется**
> использовать её в production-проектах: общедоступный API всё ещё может меняться без предупреждения
> (переименования, новые конкурентные API, изменения типов и поведения экспорта).

---

## Зачем это

Вы пишете или генерируете **TSX** (в редакторе, от ИИ, из JSON-каталога) — и получаете работающий React-компонент и настоящий видеопредпросмотр **прямо на клиенте**. Это ядро для браузерных видеоредакторов, AI-видеогенераторов и playground'ов, которым нельзя позволить себе серверный бандлинг.

- 🚀 **Zero-Backend** — компиляция, загрузка библиотек и рендер происходят в браузере.
- 📦 **NPM из коробки** — `import { motion } from 'framer-motion'` подгружается с CDN на лету.
- ▶️ **Живой Player** — одиночный вызов, полный Remotion-контекст (`useCurrentFrame`, `<Sequence>`).
- ⏱ **Data-Driven Timeline** — музыка, озвучка, SFX, субтитры и стикеры описываются JSON-массивом `Cue`.
- 🎨 **Headless UI** — примитивы плеера отдают состояние через *Render Props*: свой дизайн на Tailwind/Radix/MUI.
- 🧩 **Ассеты без сервера** — Drag & Drop медиа → `blob:` → `staticFile()`.
- 🛡️ **Устойчивость** — защита от бесконечных циклов, watchdog `delayRender`, ErrorBoundary, WebGL-guard.

---

## Реальный выхлоп

Кадры, отрендеренные пакетом в headless Chrome (скрипты `render:timeline`, `render:voiceover`, `render:animation`):

<p align="center">
  <img src="./assets/readme/proof-timeline.png" width="32%" alt="Data-Driven Timeline: музыка, озвучка, SFX и стикеры из массива Cue">
  <img src="./assets/readme/proof-voiceover.png" width="32%" alt="Анимация с реальной озвучкой, музыкой с ducking и звуковыми эффектами">
  <img src="./assets/readme/proof-motion.png" width="32%" alt="Ритм-анимация: музыка приглушается на удары, SFX играют по таймкоду">
</p>

Всё это — результат работы пайплайна песочницы, а не мокапы: `SandboxFacade` компилирует TSX, `executeComponent` выполняет его, а Remotion рендерит H.264 + AAC.

---

## Быстрый старт

```bash
npm install browser-tsx-sandbox react remotion @remotion/player
```

**Готовый UI-компонент** — один проп-объект:

```tsx
import { Sandbox } from 'browser-tsx-sandbox';

const code = `
  export default function Scene() {
    return <div style={{ color: '#4FDBC8', fontSize: 72 }}>Hello sandbox</div>;
  }
`;

<Sandbox config={{ code, className: 'rounded-xl overflow-hidden' }} />
```

**Живой видеоплеер** (subpath `browser-tsx-sandbox/player`):

```tsx
import { PlayerSandbox } from 'browser-tsx-sandbox/player';

<PlayerSandbox
  config={{
    code,
    durationInFrames: 300,
    fps: 30,
    width: 1920,
    height: 1080,
    controls: true,
    loop: true,
    renderLoading: () => <Spinner />,
    renderError: ({ error }) => <Banner text={error.message} />,
    onCompiled: ({ executionTimeMs }) => console.log(`compiled in ${executionTimeMs}ms`),
  }}
/>
```

---

## ⏱ Data-Driven Timeline

<img src="./assets/readme/timeline.svg" width="100%" alt="Массив cues превращается в дорожки музыки, озвучки, SFX и стикеров; громкость музыки приглушается под озвучку">

Слои описываются **единым массивом `Cue`**, а не хардкодом `<Sequence>` в TSX. Меняете массив в стейте — сцена обновляется без перекомпиляции.

```tsx
import { MusicLayer, SFXLayer, TrackLayer, useActiveCues, type Cue } from 'browser-tsx-sandbox';

const cues: Cue<any>[] = [
  { id: 'bgm',   type: 'music',   startFrame: 0,  payload: { src: 'bgm.mp3', volume: 0.8 } },
  { id: 'voice', type: 'voice',   startFrame: 60, durationInFrames: 120, payload: { src: 'voice.mp3' } },
  { id: 'sfx',   type: 'sfx',     startFrame: 30, payload: { src: 'pop.ogg' } },
  { id: 'cap',   type: 'caption', startFrame: 60, durationInFrames: 60, payload: { text: 'Привет!' } },
  { id: 'st',    type: 'sticker', startFrame: 30, durationInFrames: 80, payload: { x: '20%', icon: 'Zap' } },
];

export default function Scene() {
  // Audio Ducking: музыка затихает, пока звучит озвучка.
  const duck = (frame: number) => (frame >= 60 && frame <= 180 ? 0.15 : 1);
  const caption = useActiveCues(cues, 'caption')[0]?.payload?.text;

  return (
    <AbsoluteFill>
      <MusicLayer cues={cues} volumeDucking={duck} />
      <SFXLayer cues={cues} globalVolume={0.9} />
      <TrackLayer cues={cues} type="sticker" renderCue={(c) => <Sticker {...c.payload} />} />
      {caption ? <Caption text={caption} /> : null}
    </AbsoluteFill>
  );
}
```

| Слой | Что делает |
|---|---|
| `MusicLayer` | фоновая музыка с покадровым `volumeDucking` (Audio Ducking) |
| `SFXLayer` | оборачивает `type: 'sfx'` в `<Sequence><Audio /></Sequence>` |
| `TrackLayer` | универсальный визуальный трек: тайминг задаёт `<Sequence>`, контент — `renderCue` |
| `useActiveCues(cues, type?)` | события, активные на текущем кадре (субтитры, HUD) |

Готовые примеры: `examples/data-driven-timeline.tsx`, `examples/voiceover-animation.tsx`.

### Редактор без перекомпиляции

Держите `cues` в состоянии UI и подавайте через `inputProps` — `code` не меняется, а кадр обновляется:

```tsx
const [cues, setCues] = useState<Cue[]>([]);

<PlayerSandbox config={{
  code: SCENE_TSX,                       // не меняется
  modules: { remotion, 'browser-tsx-sandbox': Timeline },
  inputProps: { cues },                  // сцена читает cues из пропсов
  durationInFrames: 300, fps: 30,
}} />
```

---

## 🎨 Headless UI плеера

<img src="./assets/readme/headless.svg" width="100%" alt="PlayerSandbox.Root хранит состояние; PlayButton, Timeline, TimeDisplay и VolumeControl отдают его через render props">

`PlayerSandbox.Root` рендерит **сам холст** (`@remotion/player`) и — вслед за ним в том же контейнере — своих детей-тулбар. Состояние живёт в `PlayerContext`, каждый примитив можно заменить целиком: логика остаётся внутри, разметку задаёте вы.

```tsx
import { PlayerSandbox } from 'browser-tsx-sandbox/player';
import { Play, Pause } from 'lucide-react';

<PlayerSandbox.Root
  config={{ code, durationInFrames: 300, fps: 30, controls: false, loop: true }}
>
  <div className="mt-4 flex items-center gap-4 rounded-xl bg-gray-900 p-4">
    <PlayerSandbox.PlayButton>
      {({ isPlaying, toggle }) => (
        <button onClick={toggle} className="p-3 rounded-full bg-blue-600 text-white">
          {isPlaying ? <Pause size={20} /> : <Play size={20} />}
        </button>
      )}
    </PlayerSandbox.PlayButton>

    <PlayerSandbox.Timeline
      render={({ currentFrame, durationInFrames, seekTo }) => (
        <input type="range" className="flex-1" min={0} max={durationInFrames - 1}
          value={currentFrame} onChange={(e) => seekTo(Number(e.target.value))} />
      )}
    />

    <PlayerSandbox.TimeDisplay
      render={({ time, totalTime }) => <span className="font-mono text-gray-400">{time} / {totalTime}</span>}
    />

    <PlayerSandbox.VolumeControl
      render={({ volume, isMuted, setVolume, toggleMute }) => (
        <input type="range" min={0} max={1} step={0.01} value={volume}
          onChange={(e) => setVolume(Number(e.target.value))} />
      )}
    />
  </div>
</PlayerSandbox.Root>
```

> `Root` рендерит холст сам — вкладывать в него ещё один `<PlayerSandbox />` **не нужно**, это создаст второй экземпляр плеера.

| Примитив | API | Контекст |
|---|---|---|
| `PlayButton` | `children`-функция | `{ isPlaying, toggle }` |
| `Timeline` | `render` | `{ currentFrame, durationInFrames, seekTo }` |
| `TimeDisplay` | `render` | `{ frame, totalFrames, time, totalTime, fps }` |
| `VolumeControl` | `render` | `{ volume, isMuted, setVolume, toggleMute }` |
| `ExportButton` | `children`-функция | `{ isExporting, supported, progress, error, exportVideo, cancel }` |
| `Guides` | `preset` | `SafeZonePreset \| SafeZonePreset[]` — оверлей зон без входа в экспорт |

Внутри `PlayerSandbox.Root` доступен и хук `usePlayerContext()` — для горячих клавиш, внешних контролов и программного экспорта:

```tsx
const { exportVideo, takeSnapshot, seekTo } = usePlayerContext();
await exportVideo({ filename: 'reel.mp4', codec: 'avc', quality: 'high' });
```

Без render prop примитивы рендерят дефолтную разметку.

---

## 🎵 Аудио: музыка, озвучка, SFX

Звук собирается штатным `<Audio />` из Remotion: ассеты (MP3/WAV/OGG) загружаются пользователем, превращаются в `blob:` и передаются в `config.assets`.

```tsx
const assets = {
  'bgm.mp3': URL.createObjectURL(bgmFile),
  'voice.mp3': URL.createObjectURL(voiceFile),
};

<PlayerSandbox config={{ code, assets }} />
```

```tsx
import { Audio, Sequence, staticFile, useCurrentFrame, useVideoConfig, interpolate } from 'remotion';

export default function Scene() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const bgmVolume = interpolate(frame, [45, 60, 180, 195], [0.8, 0.15, 0.15, 0.8],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  return (
    <>
      <Audio src={staticFile('bgm.mp3')} volume={bgmVolume} />
      <Sequence from={60} durationInFrames={120}>
        <Audio src={staticFile('voice.mp3')} volume={1} />
      </Sequence>
    </>
  );
}
```

> `MusicLayer` использует тот же приём: Remotion `<Audio volume={(frame) => number}>` позволяет считать ducking покадрово.

---

## 🏗 Как это работает

<img src="./assets/readme/architecture.svg" width="100%" alt="Пайплайн: вход TSX/VFS, резолв импортов и ассетов, компиляция Sucrase, изолированное исполнение, рендер в Player или MP4">

1. **Input** — строка TSX или виртуальная файловая система (`files` + `entry`).
2. **Resolve** — `ImportResolver` ищет локальные файлы в VFS, недостающие npm-пакеты тянет с CDN, ассеты подменяет на `blob:`.
3. **Compile** — Sucrase транспилирует TSX → CommonJS (опционально в Web Worker).
4. **Evaluate** — `new Function` в изолированной области (`window`, `document`, `fetch`, `localStorage` затенены в `undefined`).
5. **Render** — компонент играет в `@remotion/player` или рендерится в MP4 офлайн (Node + Chrome).

### Возможности ядра

| Возможность | API |
|---|---|
| Компиляция TSX → CJS | `compileTsx`, `SucraseCompilerAdapter` |
| Оркестрация пайплайна | `SandboxFacade` (`compile`, `setAssets`, `registerModule`) |
| React-хук с debounce/abort | `useLiveSandbox` |
| Виртуальная ФС | `files` + `entry`, `resolveVfsPath`, `scanImports` |
| NPM с CDN | `loadMissingModules`, `defaultCdnResolver`, `defaultImporter` |
| Кэш модулей + IndexedDB | `ModuleCache` |
| Защита от зависаний | `injectLoopProtection`, `ExecutionTimeoutError` |
| Компиляция в воркере | `WorkerCompilerAdapter`, `createCompilerWorker` |
| Плагины пайплайна | `plugins: [{ beforeCompile, afterCompile }]` |
| Фазы ошибок | `getErrorPhase`, `ErrorPhase`, `CompilerError`… |
| Типы для Monaco/CodeMirror | `getSandboxTypeDefinitions` |
| ZIP-ассеты | `extractAssetZip`, `createAssetUrlMap`, `releaseAssetUrls` |

### Надёжность плеера (v0.4.0+)

- **Smart Frame Retention** — при перекомпиляции сохраняются кадр и play (`smartFrameRetention`).
- **Чистый кадр для TikTok/Reels/Shorts** — `takeSnapshot` и `exportVideo` снимают
  **только композицию** (`data-remotion-canvas`): safe-zone оверлеи, `<audio>/<video>`
  вырезаются из кадра, CSS страницы инъектируется в `foreignObject`, а размер
  принудительно приводится к `config.width × config.height` (точный 1:1).
- **Императивный API** — `PlayerSandboxRef`: `seekTo`, `getCurrentFrame`, `play/pause/toggle`, `takeSnapshot`, `exportVideo`, `abortExport`, `resetZoomPan`, `getActiveDelayHandles`, `getRemotionPlayerRef`.
- **delayRender Watchdog** — снимает зависшую блокировку кадра (`createRemotionWatchdog`).
- **WebGL Guard** — освобождает контексты при размонтировании (`cleanupCanvasWebGl`).
- **Snapshot** — PNG/JPEG текущего кадра прямо в браузере (`takeContainerSnapshot`).
- **Safe Zones** — `tiktok-9x16`, `reels-9x16`, `shorts-9x16`, `tv-safe-16x9`, `rule-of-thirds`, `center-cross`.
- **Studio Canvas** — `canvasControls: { zoom, pan }` (Ctrl+Wheel, Shift+Drag).

---

## 📦 Ассеты и внешние библиотеки

**ZIP-архив** медиа → карта `blob:`-ссылок:

```ts
import { extractAssetZip, createAssetUrlMap, releaseAssetUrls } from 'browser-tsx-sandbox';

const archive = extractAssetZip(zipBytes);
const urls = createAssetUrlMap(archive, (bytes) => URL.createObjectURL(new Blob([bytes])));
facade.setAssets(urls);            // staticFile('clip.mp4') → blob:
// ...
releaseAssetUrls(urls, URL.revokeObjectURL);
```

**Динамический npm** — просто импортируйте пакет в TSX; он подгрузится с `esm.sh` во время выполнения:

```tsx
import { motion } from 'framer-motion';   // esm.sh/framer-motion
import * as d3 from 'd3';                 // esm.sh/d3
import confetti from 'canvas-confetti';
```

Свой CDN или компилятор — через `cdnResolver`, `compiler`, `importer`.

---

## 🎬 Рендер видео (офлайн, Node + Chrome)

| Команда | Результат |
|---|---|
| `npm run render` | PNG-кадр + MP4 из сцены песочницы |
| `npm run render:assets` | сцена с медиа из ZIP (`OffthreadVideo` + `Img`) |
| `npm run render:example` | пример `examples/remotion-scene.tsx` |
| `npm run render:widgets` | виджеты из JSON-каталога |
| `npm run render:cdn` | d3/three, скачанные с esm.sh прямо в браузере |
| `npm run render:showcase` | Tailwind + lucide + d3/three в одной сцене |
| `npm run render:audio` | музыка + озвучка + Audio Ducking |
| `npm run render:animation` | ритм-анимация со скачанными музыкой и SFX |
| `npm run render:timeline` | Data-Driven Timeline из массива `Cue` |
| `npm run render:voiceover` | реальная озвучка `examples/voice/voice_01.wav` + музыка + SFX |

> Рендер в файл (`renderMedia`) — офлайн в Node + Chrome. В браузере доступен мгновенный предпросмотр через Player.

Демо: `npm run demo` (редактор + Player), `/studio.html` (Smart Frame Retention, snapshot, safe zones, зум, headless-тулбар).

---

## 📋 API-справочник — шпаргалка

Полный вариант — в [`API.md`](./API.md). Здесь — самые частые вопросы: конфиг плеера, многофайловый вход и HMR, ассеты, экспорт и лимиты.

### `PlayerSandboxConfig`

`<PlayerSandbox>` принимает единственный проп `config`. Помимо перечисленного ниже, доступны все поля `SandboxConfig` (`modules`, `importer`, `plugins`, `mediaResolver`…).

| Поле | Описание | По умолчанию |
|---|---|---|
| `code` | TSX-строка (одиночный файл) | — |
| `files` | объект VFS `{ '/путь': код }`, приоритетнее `code` | — |
| `entry` | точка входа внутри VFS | `/App.tsx` |
| `hmr` | инкрементальная перекомпиляция зависимостей (только для `files`) | `false` |
| `modules` | пре-зарегистрированные модули (`import` без CDN) | — |
| `assets` | карта `имя → URL` для `staticFile()` | — |
| `mediaResolver` | `(src) => string` — перехват `src` медиа без правки кода сцены | — |
| `plugins` | `(PipelinePlugin \| SandboxPlugin)[]` (до/после компиляции + onResolve/onLoad) | `[]` |
| `durationInFrames` | длина композиции | `300` |
| `fps` | частота кадров | `30` |
| `width` / `height` | разрешение композиции | `1920` / `1080` |
| `controls` | нативные контролы Remotion | `true` |
| `loop` / `autoPlay` | зацикливание / автоплей | `false` |
| `inputProps` | пропсы сцены (редактор без перекомпиляции) | — |
| `smartFrameRetention` | сохранять текущий кадр и play при перекомпиляции | `true` |
| `delayRenderTimeoutMs` | таймаут watchdog'а `delayRender` | `4000` |
| `safeZone` | оверлей безопасных зон (`SafeZonePreset[]`) | — |
| `canvasControls` | `{ enabled, minZoom, maxZoom, initialZoom }` | `0.25` / `4` / `1` |
| `maxIterations` | лимит срабатывания LoopProtect | `500_000` |
| `debounceMs` | дебаунс компиляции (Monaco/CodeMirror) | `0` |
| `renderLoading` / `renderError` | рендер-слоты состояний | — |
| `onError` / `onCompiled` | колбэки фазы (в `onCompiled` — `{ component, executionTimeMs, metadata }`) | — |

Если `durationInFrames/fps/width/height` не заданы в конфиге, они извлекаются из кода автоматически (`extractSceneMetadata`); вручную заданное значение приоритетнее («конфиг → код → дефолт»).

### Виртуальная ФС и HMR

```tsx
const files = {
  '/App.tsx': `import { Scene } from './scene'; export default Scene;`,
  '/scene.tsx': `export function Scene() { return <div>Hi</div>; }`,
  '/theme.ts': `export const ACCENT = '#4FDBC8';`,
};

<PlayerSandbox config={{ files, entry: '/App.tsx', hmr: true }} />
```

- Резолвер подбирает расширения `.tsx/.ts/.jsx/.js/.json` и `index.*` (`resolveVfsPath`).
- `entry` задаёт точку входа (по умолчанию `/App.tsx`); остальные файлы подключаются обычными относительными импортами.
- При `hmr: true` перекомпилируются **только изменённый файл и его зависимые** (граф из `facade.hmrUpdate` → `HmrEvent.recompiled`), остальные модули берутся из кеша.
- HMR работает только для object-VFS (`files`); для строки `code` происходит полная перекомпиляция. Сводку последнего апдейта можно читать из `lastHmr`.

### Ассеты: ZIP и локальные пути

**Одиночные файлы** — имя → `blob:`/`data:` URL:

```tsx
<PlayerSandbox config={{ code: SCENE, assets: { 'bgm.mp3': URL.createObjectURL(file) } }} />
```

**ZIP с медиа** → карта URL для `staticFile()`:

```ts
import { extractAssetZip, createAssetUrlMap, releaseAssetUrls } from 'browser-tsx-sandbox';

const archive = extractAssetZip(zipBytes);   // Record<путь внутри архива, Uint8Array>
const urls = createAssetUrlMap(archive, (bytes) => URL.createObjectURL(new Blob([bytes])));
// <PlayerSandbox config={{ assets: urls }} />  или  facade.setAssets(urls)
releaseAssetUrls(urls, URL.revokeObjectURL);  // освободить blob:, чтобы не текла память
```

**Локальные абсолютные пути** (`C:\Users\...`) — сцена не меняется, путь перехватывает `mediaResolver`:

```tsx
const toViteFsPath = (src: string) =>
  /^[a-zA-Z]:[\\/]/.test(src) ? '/@fs/' + src.replace(/\\/g, '/') : src;

<PlayerSandbox config={{ code, mediaResolver: toViteFsPath }} />
```

`mediaResolver` применяется к `OffthreadVideo / Video / Audio / Img` (см. API.md §5.1). Внимание: одиночный бэкслэш в строке сцены съедается самим JS — пишите `C:/...` или `C:\\...`; схема `/@fs/` работает только на dev-сервере Vite, в production-билде используйте `blob:`/`data:`.

### Экспорт видео в браузере (WebCodecs)

Захват кадра идёт **в разрешении композиции** (без UI-масштаба) — видео не размывается; в кадр не попадают safe-zone оверлеи. Фазы прогресса: `capturing → encoding → muxing → done`.

```tsx
// 1) Готовый compound-контрол
<PlayerSandbox.ExportButton codec="avc" quality="high" filename="reel.mp4">
  {({ isExporting, progress, exportVideo, supported, error }) => (
    <button disabled={!supported || isExporting} onClick={exportVideo}>
      {isExporting ? `${Math.round((progress ?? 0) * 100)}%` : 'Экспорт MP4'}
    </button>
  )}
</PlayerSandbox.ExportButton>

// 2) Программно через ref
const blob = await playerRef.current?.exportVideo({
  filename: 'reel.mp4',
  codec: 'avc',
  quality: 'high',
  onProgress: ({ phase, progress }) => setStatus(`${Math.round(progress * 100)}% ${phase}`),
});
```

| Опция | Значение |
|---|---|
| `codec` | `avc` — MP4/H.264 (по умолчанию), `vp8`/`vp9` — WebM |
| `quality` | `low`/`medium`/`high` (по умолчанию `high`); битрейт = `px/с × 0.05 / 0.1 / 0.2` |
| `bitrate` | явный битрейт (бит/с), приоритетнее `quality` |
| `width` / `height` / `fps` | переопределить вместо `config.*` |
| `filename` | `string` — скачать файл; `false` — только вернуть `Blob` |
| `onProgress` | `{ frame, totalFrames, progress, phase }` |

Низкоуровневый путь — `exportBrowserVideo({ container, durationInFrames, fps, width, height, seekTo, … })`, готовность браузера — `supportsBrowserExport()`, скачивание — `downloadExportBlob(blob, filename)`.

### Безопасность и лимиты

**Затенение глобалов** — внутри песочницы заняты в `undefined`:

```
window, document, localStorage, sessionStorage,
fetch, XMLHttpRequest, indexedDB, navigator, WebSocket
```

| Механизм | Что делает |
|---|---|
| LoopProtect (`maxIterations`, по умолчанию `500_000`) | бесконечный цикл → `ExecutionTimeoutError` |
| Watchdog `delayRender` (`delayRenderTimeoutMs`, `4000`) | снимает зависшую блокировку кадра |
| WebGL Guard | при размонтировании высвобождает WebGL-контексты всех канвасов |
| ErrorBoundary + фазы | ошибки типизированы: `compiler / network / security / runtime / timeout` |

> Исполнение идёт в том же JS-realm: затенение защищает от случайного доступа, но это **не изоляция уровня ОС** — непроверенный код запускайте только в собственном sandbox-контуре. Полная модель — в API.md §18.

---

## ⚙️ Под капотом: продвинутые возможности

### ⚡ Многопоточная компиляция (Web Worker)

По умолчанию Sucrase транспилирует TSX в главном UI-потоке — при вводе сложного кода возможны микрофризы. Адаптер `WorkerCompilerAdapter` (поле `config.compiler`) выносит транспиляцию в отдельный поток:

```tsx
import React, { useEffect, useMemo } from 'react';
import { PlayerSandbox } from 'browser-tsx-sandbox/player';
import { WorkerCompilerAdapter } from 'browser-tsx-sandbox';

export function BackgroundCompilerEditor() {
  const compiler = useMemo(() => new WorkerCompilerAdapter(), []);

  useEffect(() => () => compiler.dispose(), [compiler]); // освободить воркер при размонтировании

  return <PlayerSandbox config={{ code: userCode, compiler, width: 1920, height: 1080 }} />;
}
```

- Воркер создаётся inline из Blob (`createCompilerWorker()`): Sucrase тянется с `esm.sh` и исполняется за пределами UI-потока.
- Если `Worker`/`Blob`/`URL` недоступны (Node, SSR, jsdom) — адаптер **прозрачно работает на главном потоке** (`adapter.isWorker === false`), поэтому его можно включать и в режиме серверного рендера.
- Интерфейс — `CompilerAdapter { name, transform(code, filepath): Promise<string>, dispose() }`, тот же контракт, что у `SucraseCompilerAdapter`, поэтому адаптер взаимозаменяем.

### ⏱ Защита от зависших кадров (delayRender Watchdog)

`delayRender()` в Remotion приостанавливает кадр до загрузки шрифта/ассета. Если код забыл вызвать `continueRender()`, плеер завис бы навсегда. В `PlayerSandbox` watchdog включён **автоматически**:

- дескриптор, удерживаемый дольше `delayRenderTimeoutMs`, снимается принудительно, в консоль пишется предупреждение;
- таймаут по умолчанию — `4000` мс.

```tsx
const playerRef = useRef<PlayerSandboxRef>(null);

<PlayerSandbox
  ref={playerRef}
  config={{ code: userCode, delayRenderTimeoutMs: 3500 }}
/>

// активные блокировки кадра (лейбл из delayRender("...") или handle_id)
const stuck = playerRef.current?.getActiveDelayHandles(); // ['FontLoad', 'handle_102']
```

Для ручной интеграции (фасад/свой модуль remotion) экспортирован `createRemotionWatchdog(remotionModule, timeoutMs, onTimeout?)` → `{ proxiedRemotion, getActiveHandles, clearAllTimeouts }`.

### 🧠 Автоопределение параметров сцены

Плеер умеет выводить `durationInFrames / fps / width / height / defaultProps` из кода — жёстко прописывать их в конфиге не обязательно. Порядок приоритетов (проверяются по очереди, первый найденный выигрывает):

**1. Вычисленные экспорты** — объект в одном из имён: `compositionConfig`, `config`, `sceneConfig`, `metadata` (допустимы синонимы полей `durationFrames`, `compositionWidth`, `compositionHeight`, пропсы как `defaultProps` **или** `inputProps`):

```tsx
export const compositionConfig = {
  id: 'CustomReel',
  durationInFrames: 240,
  fps: 60,
  width: 1080,
  height: 1920,
  defaultProps: { title: 'Привет' },
};
```

**2. Именованные экспорты** — `export const durationInFrames/fps/width/height`.

**3. Статические свойства компонента** — `Scene.durationInFrames = 300;` (и `fps`/`width`/`height`/`defaultProps`).

**4. JSON-исходники** — прямой `{ durationInFrames, fps, width, height, id }` или каталог виджетов `{ widgets: [...] }`; в последнем случае по `widget.id` определяется формат: содержит `9x16` → `1080×1920`, `16x9` → `1920×1080`, `fps` по умолчанию `30`, пропсы из `default_props`.

**5. Рег-экспы по тексту TSX** (fallback) — тег `<Composition durationInFrames={90} fps={30} width={1920} height={1080} />` или `export const …`.

> Явные значения в `config` переопределяют метаданные: приоритет «конфиг → код → дефолт» (`300 кадров / 30 fps / 1920×1080`, если не найдено ничего). Подробный разбор — в API.md §19.

### 📸 Снятие скриншотов кадра (Snapshot API)

Для постеров и превью без бэкенда — `takeSnapshot()` через `ref` плеера:

```tsx
const playerRef = useRef<PlayerSandboxRef>(null);

const handleCapture = async () => {
  const dataUrl = await playerRef.current?.takeSnapshot({
    format: 'image/png',   // 'image/png' | 'image/jpeg' | 'image/webp' (по умолчанию png)
    quality: 0.95,         // 0..1, для jpeg/webp
    targetWidth: 1920,     // опционально, 1:1 без UI-масштаба
    targetHeight: 1080,
  });
  if (dataUrl) { /* data:image/png;base64,... → <img src={dataUrl}/> или загрузка */ }
};
```

Алгоритм `takeContainerSnapshot`: берёт готовый `<canvas>` композиции с пропорциями таргета → иначе изолирует `[data-remotion-canvas]` в `<foreignObject>` SVG → растеризует в canvas → PNG/JPEG/WebP. Оверлеи safe zones и `<audio>/<video>` вырезаются (`data-sandbox-overlay`), стили страницы инжектируются (Tailwind-классы работают), пиксели канвасов переносятся из оригинала. Если canvas «загрязнён» CORS-медиа и растеризация невозможна, возвращается безопасный `data:image/svg+xml`.

### 📐 Safe Zones и направляющие

Проп `safeZone` накладывает векторную сетку поверх холста (в скриншоты и экспорт видео она не попадает). Один пресет или массив:

```tsx
<PlayerSandbox config={{ code, width: 1080, height: 1920, safeZone: ['tiktok-9x16', 'rule-of-thirds'] }} />
```

| Пресет | Что рисует (viewBox 1080×1920) |
|---|---|
| `tiktok-9x16` | зоны TikTok: шапка/поиск (0..220), панель действий справа (x=880), подпись/звук (0..-440) |
| `reels-9x16` | Instagram Reels: top-UI (0..220), правый рельс действий (x=900), капшены (440) |
| `shorts-9x16` | YouTube Shorts: хедер (0..140), кнопки реакций справа (x=880), титул/нав (340) |
| `tv-safe-16x9` | концентрические рамки 90% (Action Safe) и 80% (Title Safe) |
| `rule-of-thirds` | классическая сетка третей (линии 33.3% / 66.6%) |
| `center-cross` | крест строго по центру холста |

### 🔍 Отладка и логирование

Встроенный логгер выключен по умолчанию. Для отладки HMR, метаданных и экспорта:

```tsx
import { configureLogger } from 'browser-tsx-sandbox';

configureLogger({ enabled: true, level: 'debug' }); // 'debug' | 'info' | 'warn' | 'error'
```

Печатается с префиксом `[browser-tsx-sandbox:<level>]`, например:

```text
[browser-tsx-sandbox:debug] extractSceneMetadata: старт извлечения параметров
[browser-tsx-sandbox:info] Извлеченные параметры сцены: { durationInFrames: 150, fps: 30 }
[browser-tsx-sandbox:warn] [Remotion Watchdog]: delayRender("FontLoad") [id: 102] превысил лимит 4000ms. Блокировка кадра снята принудительно.
```

`level` — порог отсечения: при `error` печатаются только ошибки, при `debug` — всё.

### 🚨 Классификация ошибок

Все ошибки типизированы (`getErrorPhase` → `compiler | network | security | timeout | runtime`), что удобно использовать в `renderError`:

```tsx
<PlayerSandbox
  config={{
    code: userCode,
    renderError: ({ error, isCompiling, isRuntime }) => {
      if (error.name === 'CompilerError')
        return <pre>Синтаксис: строка {error.line}:{error.column}\n{error.snippet}</pre>;
      if (error.name === 'NetworkModuleError')
        return <div>Не удалось скачать модуль: {error.moduleName}</div>;
      if (error.name === 'ExecutionTimeoutError')
        return <div>Цикл превысил {error.limit} итераций — выполнение прервано.</div>;
      if (error.name === 'SecurityError')
        return <div>Нарушение безопасности: {error.message}</div>;
      return <div>Ошибка кадра: {error.message}</div>;
    },
  }}
/>
```

| Класс | Когда кидается | Полезные поля |
|---|---|---|
| `CompilerError` | синтаксис/транспиляция TSX | `line`, `column`, `snippet` |
| `NetworkModuleError` | пакет не загрузился с CDN | `moduleName` |
| `SecurityError` | запрещённый импорт/доступ | `message` |
| `ExecutionTimeoutError` | сработал LoopProtect | `limit` |
| `RuntimeRenderError` | ошибка в компоненте пользователя (ловится ErrorBoundary) | `componentStack`, `cause` |

---

## 🧩 Интеграции и режимы использования

### 💻 Monaco / CodeMirror: IntelliSense для кода сцены

Пользователю редактора нужны подсказки по `staticFile` и хукам Remotion. Хелпер `getSandboxTypeDefinitions()` возвращает готовые виртуальные `.d.ts`:

```tsx
import Editor from '@monaco-editor/react';
import { getSandboxTypeDefinitions } from 'browser-tsx-sandbox';

const handleEditorMount = (editor, monaco) => {
  monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
    target: monaco.languages.typescript.ScriptTarget.ES2020,
    esModuleInterop: true,
    allowJs: true,
    jsx: monaco.languages.typescript.JsxEmit.ReactJSX,
    moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
  });

  for (const def of getSandboxTypeDefinitions()) {
    monaco.languages.typescript.typescriptDefaults.addExtraLib(def.content, def.filename);
  }
};

<Editor height="600px" defaultLanguage="typescript" onMount={handleEditorMount} />
```

Декларации: `ts:browser-tsx-sandbox/globals.d.ts` (глобал `staticFile`, `const React`) и `ts:browser-tsx-sandbox/remotion.d.ts` (`declare module 'remotion'` — `useCurrentFrame`, `useVideoConfig`, `spring`, `interpolate`, `AbsoluteFill`, `Sequence`, `Composition`, `OffthreadVideo`, `Img`). Связка с компилятором песочницы — в API.md §15.6.

### 🤖 Ответы нейросетей можно вставлять сырыми (Markdown Fences)

LLM оборачивают код в ```` ```tsx … ``` ````. Компилятор по умолчанию сам вырезает ограждения: `compileTsx` (а значит `<Sandbox>`, `<PlayerSandbox>` и `SandboxFacade` без кастомного `compiler`) первым шагом вызывает `cleanMarkdownFences(code)`. Сырой ответ — в том числе при потоковой сборке из кусков — можно передавать напрямую, без ручной очистки:

```tsx
<PlayerSandbox config={{ code: rawLLMResponse /* ```tsx ...``` без проблем */ }} />
```

> Если вы подключаете собственный `compiler` (например, `WorkerCompilerAdapter`), очистку fences сделайте сами: `code = cleanMarkdownFences(code)` перед компиляцией.

### ⏱ Живое редактирование: дебаунс компиляции

`debounceMs` (по умолчанию `0`) откладывает компиляцию до паузы в вводе — при наборе в `<textarea>`/Monaco на каждый символ не запускается тяжёлая транспиляция:

```tsx
<PlayerSandbox
  config={{
    code: draft,
    debounceMs: 250,
    onCompiled: ({ executionTimeMs }) => console.log(`compiled in ${executionTimeMs.toFixed(1)} ms`),
  }}
/>
```

### 💾 Кэш модулей: в памяти и IndexedDB

`ModuleCache` — это и **persistent-репозиторий сессии** (сколько жива вкладка), и набор примитивов для офлайн-хранилища. По умолчанию CDN-библиотеки (`loadMissingModules`) кэшируются **в памяти** — повторные компиляции в рамках сессии не ходят в сеть. Персистентность между визитами даётся двумя методами, которые вы связываете сами:

```tsx
import { ModuleCache, loadMissingModules } from 'browser-tsx-sandbox';

// DB: 'browser_tsx_sandbox_cache', хранилище: 'modules_store'

const cache = new ModuleCache();

// 1. Достаём прошлые бандлы из IndexedDB (строка — сериализация за вами)
const cached: string | null = await cache.loadFromIndexedDb('framer-motion');
if (cached) cache.register('framer-motion', hydrate(cached));

// 2. После обычной загрузки кладём бандл в IndexedDB на следующий визит
await loadMissingModules(['framer-motion', 'canvas-confetti'], cache);
const bundle = cache.get('framer-motion');
await cache.saveToIndexedDb('framer-motion', serialized(bundle));
```

> Честно о статусе: IDB-хелперы (`loadFromIndexedDb` / `saveToIndexedDb`) есть, но в стандартный пайплайн **не подключены** — это интеграция за приложением. `cache.clear()` очищает только in-memory реестр.

### 🌐 Свой CDN и приватные реестры (`cdnResolver`)

По умолчанию пакеты тянутся с `esm.sh` с **припинкованной версией React хоста**:

```
https://esm.sh/<pkg>?deps=react@<React.version>,react-dom@<React.version>
```

Пин версии React — не деталь: библиотеки, спаренные с другой мажорной версией React, ломают реконсилер. Свой источник задаётся одним колбэком:

```tsx
<PlayerSandbox
  config={{
    code,
    cdnResolver: (pkg: string) => `https://npm-mirror.my-company.internal/${pkg}?bundle`,
  }}
/>
```

`CdnResolver = (pkg) => string` принимается и в `SandboxFacadeOptions` (facade/useLiveSandbox), и в `loadMissingModules({ cdnResolver })`. За раздачу самого бандла отвечает `importer` (`ModuleImporter`), тоже переопределяемый.

### 🖥 Проверка поддержки WebCodecs

`VideoEncoder` есть в современных Chromium, но может отсутствовать в старых WebView. Проверяйте до отрисовки кнопки экспорта:

```tsx
import { supportsBrowserExport } from 'browser-tsx-sandbox/export';

function ExportControls() {
  if (!supportsBrowserExport())
    return <div className="alert-warning">Экспорт недоступен — обновите браузер (Chrome/Edge).</div>;
  return <PlayerSandbox.ExportButton codec="avc" quality="high" />;
}
```

Доступно из subpath `browser-tsx-sandbox/export` (только экспорт, без плеера), из главного входа и `browser-tsx-sandbox/player`; `ExportButton` сам пометит себя `disabled`, но UI-предупреждение красивее.

### 🧩 `<Sandbox />` — рендер без видеоплеера

Когда нужно отрисовать **интерактивный React-виджет** (счётчик, дашборд, график) или статичный компонент без таймлайна — используйте `<Sandbox />`: он легче, не инициализирует `@remotion/player`, таймеры и canvas-контролы, но сохраняет компиляцию, LoopProtect, ErrorBoundary, CDN-импорты, плагины и `mediaResolver`.

| | `<Sandbox />` | `<PlayerSandbox />` |
|---|---|---|
| Рендер | интерактивный React-компонент | Remotion-композиция (кадры, `useCurrentFrame`) |
| Таймлайн/плеер | нет | да (`controls`, `safeZone`, `canvasControls`) |
| Снапшот/экспорт | нет | `takeSnapshot`, `exportVideo` |
| Безопасность/плагины | да | да |

```tsx
import { Sandbox } from 'browser-tsx-sandbox';
import { createTailwindPlugin } from 'browser-tsx-sandbox/plugins';

<Sandbox config={{ code: counterWidgetTSX, plugins: [createTailwindPlugin()] }} />
```

### ⚙️ `SandboxFacade` — песочница без React-UI

Для Node-скриптов, CLI-утилит и автотестов ядро не требует компонентов: фасад компилирует, исполняет и отдаёт сырые экспорты:

```ts
import React from 'react';
import { SandboxFacade } from 'browser-tsx-sandbox';

const facade = new SandboxFacade({ react: React } /* реестр модулей */, {
  plugins: [],            // опционально: (PipelinePlugin | SandboxPlugin)[]
  compiler: undefined,    // опционально: WorkerCompilerAdapter
  maxIterations: 500_000,
});

const result = await facade.compile(`
  export const message = 'Ready';
  export default function Widget() { return <div>Hello</div>; }
`);

if (result.error) throw result.error;             // + result.errorPhase: 'compiler' | ...
console.log(result.component, result.exports?.message, result.executionTimeMs);
```

`compile(input, { signal, entry })` принимает строку или VFS и возвращает `EvaluationResult` (`component`, `exports`, `executionTimeMs`, `metadata`, `error`, `errorPhase`). Для ассетов и модулей — `setAssets(urls)` и `registerModule(name, module)`. HMR из кода — `facade.hmrUpdate(files, …)` → `{ …result, hmr: HmrEvent }` (см. API.md §3, §10).

---

## ✅ Тесты и качество

| Команда | Что проверяет |
|---|---|
| `npm test` | 165 юнит-тестов (компилятор, песочница, timeline, Player, примитивы) |
| `npm run test:e2e` | реальный рендер в Chrome: кадры, H.264 + AAC |
| `npm run test:network` | загрузка d3/three/canvas-confetti с esm.sh |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run verify:video` | разбор MP4 (кодек, размеры, длительность) |
| `npm run arch` | проверка модульной архитектуры (граничные зависимости + циклы) |

---

## 📖 Документация

- **[`API.md`](./API.md)** — полный справочник: `SandboxFacade`, `useLiveSandbox`, `<Sandbox>`, `<PlayerSandbox>`, headless-примитивы, Timeline, ассеты, ошибки, безопасность.
- **[`docs/plugins.md`](./docs/plugins.md)** — система плагинов: подключение Tailwind JIT и создание собственных (до/после компиляции).
- **[`docs/studio-demo.md`](./docs/studio-demo.md)** — анализ Studio-демо: добавление `ExportButton`, исправленные SVG, проверка архитектуры.
- **Демо-страницы** — `demo/index.html`, `demo/studio.html`.
- **Примеры** — `examples/`.

---

## ⚠️ Ограничения

- **Безопасность.** Затенение глобалов (`window`, `document`, `fetch`…) — защита от случайного и вредоносного доступа, но исполнение идёт в том же JS-realm: это не изоляция уровня ОС. Не запускайте непроверенный код без собственного sandbox-контура.
- **Сеть.** NPM-импорты и часть e2e требуют доступа к CDN. В Node нативные `https`-импорты не поддерживаются — тесты используют адаптер с `?bundle`.
- **`takeSnapshot`** для canvas-сцен (WebGL/2D) даёт настоящий PNG/JPEG; для чисто DOM-сцен браузер может пометить canvas как *tainted* и вернётся SVG data-URL.
- **Браузерный рендер в файл** — экспорт MP4 (H.264) и WebM (VP8/VP9) через WebCodecs + мультиплексирование `mediabunny` (`ExportButton`, `exportBrowserVideo`, `PlayerSandbox` `exportVideo`). Захват кадра идёт в **разрешении композиции** (без UI-масштаба) — видео не размывается; пресеты качества `low`/`medium`/`high`. Полный MKV/AAC-рендер в файл — только офлайн (Node + Chrome).

---

## 🛠 Разработка

```bash
npm install
npm test            # юнит-тесты
npm run test:e2e    # реальный рендер (нужен Chrome)
npm run typecheck
npm run build       # tsup → dist/ (ESM + CJS + d.ts)
npm run pack:check  # содержимое npm-тарбола
```

Публикуются только `dist/`, `README.md`, `API.md`. `react` — peer, `sucrase`/`fflate` — зависимости, `@remotion/player`/`remotion` — optional peer.

---

## License

[MIT](./package.json) © browser-tsx-sandbox
