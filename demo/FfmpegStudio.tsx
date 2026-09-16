import React, { useState, useMemo } from 'react';
import type { UIEvent } from 'react';
import { useRef } from 'react';
import * as Remotion from 'remotion';
import * as Lucide from 'lucide-react';
import {
  Play,
  Download,
  Terminal,
  Settings,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { PlayerSandbox } from '../src/player';
import type { PlayerSandboxRef } from '../src/player';
import { createTailwindPlugin } from '../src/plugins/tailwind-plugin';
import { exportViaFfmpegBackend } from '../src/export/client-ffmpeg-export';
import './styles.css';

const DEFAULT_TSX_CODE = `import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';
import { Cpu, Zap, Activity } from 'lucide-react';

export const compositionConfig = {
  id: 'Scene',
  durationInFrames: 120,
  fps: 30,
  width: 1920,
  height: 1080,
};

export default function MyScene() {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const enter = spring({ frame, fps, config: { damping: 14 } });
  const scale = interpolate(frame, [0, durationInFrames], [1, 1.08]);
  const rot = frame * 1.5;

  return (
    <AbsoluteFill className="bg-[#0b1326] flex items-center justify-center font-sans select-none overflow-hidden">
      <AbsoluteFill
        style={{
          opacity: 0.15,
          backgroundImage: 'linear-gradient(to right, #4fdbc815 1px, transparent 1px), linear-gradient(to bottom, #4fdbc815 1px, transparent 1px)',
          backgroundSize: '48px 48px',
        }}
      />

      <div style={{ transform: \`scale(\${scale})\` }} className="flex flex-col items-center gap-6 z-10">
        <div className="flex items-center gap-6">
          <Cpu size={56} className="text-[#4fdbc8]" style={{ transform: \`rotate(\${rot}deg)\` }} />
          <Zap size={64} className="text-[#ddb7ff]" />
          <Activity size={56} className="text-[#ffb4ab]" />
        </div>

        <h1 style={{ opacity: enter, transform: \`scale(\${enter})\` }} className="text-7xl font-black tracking-tight text-white m-0 uppercase">
          FFMPEG <span className="text-[#4fdbc8]">RENDER</span>
        </h1>

        <p className="font-mono text-xl text-slate-400 m-0">
          Кадр: {frame} / {durationInFrames} ({fps} FPS)
        </p>
      </div>
    </AbsoluteFill>
  );
}
`;

export function FfmpegStudio() {
  const playerRef = useRef<PlayerSandboxRef>(null);

  const [code, setCode] = useState(DEFAULT_TSX_CODE);
  const [activeCode, setActiveCode] = useState(DEFAULT_TSX_CODE);

  const [width, setWidth] = useState(1920);
  const [height, setHeight] = useState(1080);
  const [fps, setFps] = useState(30);
  const [durationInFrames, setDurationInFrames] = useState(120);
  const [preset, setPreset] = useState<'ultrafast' | 'superfast' | 'veryfast' | 'faster' | 'fast' | 'medium'>('veryfast');
  const [crf, setCrf] = useState(20);

  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [currentRenderFrame, setCurrentRenderFrame] = useState(0);
  const [wsStatus, setWsStatus] = useState<'idle' | 'connecting' | 'streaming' | 'finishing' | 'done' | 'error'>('idle');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [mbSent, setMbSent] = useState(0);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);

  const abortRef = useRef<AbortController | null>(null);
  const statsTimerRef = useRef<number | null>(null);

  const plugins = useMemo(() => [createTailwindPlugin()], []);
  const modules = useMemo(() => ({ remotion: Remotion, 'lucide-react': Lucide }), []);

  const toViteFsPath = (src: string): string => {
    const clean = src.replace(/^file:\/\/\//i, '');
    if (/^[a-zA-Z]:[\\/]/.test(clean)) return '/@fs/' + clean.replace(/\\/g, '/');
    return src;
  };

  const addLog = (msg: string) => {
    const time = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev.slice(-49), `[${time}] ${msg}`]);
  };

  const handleApplyCode = () => {
    setActiveCode(code);
    setDownloadUrl(null);
    addLog('Код обновлён в Live Preview');
  };

  const handleFfmpegRender = async () => {
    const player = playerRef.current;
    if (!player) return;

    const remotionPlayer = player.getRemotionPlayerRef();
    const container = remotionPlayer?.getContainerNode();
    if (!container) {
      addLog('Ошибка: контейнер плеера не найден');
      return;
    }

    try {
      abortRef.current?.abort();
      abortRef.current = new AbortController();

      setIsExporting(true);
      setExportProgress(0);
      setCurrentRenderFrame(0);
      setWsStatus('connecting');
      setElapsedMs(0);
      setMbSent(0);
      setDownloadUrl(null);
      player.pause();
      addLog(
        `Открыт WebSocket /api/ffmpeg/ws: ${width}x${height}, ${durationInFrames} кадров, preset=${preset}, crf=${crf}`,
      );

      const startTime = performance.now();
      let lastDeltaAt = startTime;
      let lastFrameReported = 0;

      const statsTimer = window.setInterval(() => {
        setElapsedMs(performance.now() - startTime);
        const runMs = performance.now() - lastDeltaAt;
        if (runMs > 500 && currentRenderFrame > lastFrameReported) {
          const fpsNow = ((currentRenderFrame - lastFrameReported) / runMs) * 1000;
          addLog(`Стриминг: ${fpsNow.toFixed(1)} кадр/сек (WS-ACK), всего ${currentRenderFrame}`);
          lastDeltaAt = performance.now();
          lastFrameReported = currentRenderFrame;
        }
      }, 500);
      statsTimerRef.current = statsTimer;

      const url = await exportViaFfmpegBackend({
        container,
        durationInFrames,
        fps,
        width,
        height,
        seekTo: (frame) => player.seekTo(frame),
        preset,
        crf,
        signal: abortRef.current.signal,
        onFrame: (frame) => setCurrentRenderFrame(frame + 1),
        onProgress: (frame, total, pct) => {
          setCurrentRenderFrame(frame);
          setMbSent((frame / Math.max(total, 1)) * 4);
          setExportProgress(Math.round(pct * 100));
        },
      });

      window.clearInterval(statsTimer);
      statsTimerRef.current = null;
      setWsStatus('done');

      const totalTime = ((performance.now() - startTime) / 1000).toFixed(2);
      setDownloadUrl(url);
      addLog(`Рендер завершён за ${totalTime} сек через единый WebSocket-стрим!`);
    } catch (error) {
      if (statsTimerRef.current !== null) {
        window.clearInterval(statsTimerRef.current);
        statsTimerRef.current = null;
      }
      const message = error instanceof Error ? error.message : String(error);
      setWsStatus(message.includes('отменён') ? 'idle' : 'error');
      addLog(`Ошибка: ${message}`);
    } finally {
      setIsExporting(false);
    }
  };

  const handleCancelRender = () => {
    if (!abortRef.current) return;
    abortRef.current.abort();
    setWsStatus('idle');
    addLog('Рендер отменён пользователем (WebSocket закрыт, FFmpeg убит на сервере)');
  };

  return (
    <div className="min-h-screen bg-[#06080f] text-slate-100 p-6 flex flex-col gap-6 max-w-[1700px] mx-auto font-sans">
      <header className="flex justify-between items-center border-b border-slate-800 pb-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-3">
            <Terminal className="text-[#4fdbc8]" /> Studio FFmpeg Render Engine
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Вставляйте свой TSX-код, смотрите превью и рендерите MP4: кадры летят через WebSocket в FFmpeg
          </p>
        </div>
        <div className="flex gap-4 items-center">
          <span className="flex items-center gap-2 text-xs font-mono">
            <span
              className={`w-2 h-2 rounded-full ${
                wsStatus === 'streaming' || wsStatus === 'connecting'
                  ? 'bg-[#4fdbc8] animate-pulse'
                  : wsStatus === 'done'
                    ? 'bg-emerald-400'
                    : wsStatus === 'error'
                      ? 'bg-rose-500'
                      : 'bg-slate-600'
              }`}
            />
            <span className="text-slate-400">
              WS:{' '}
              {wsStatus === 'streaming' || wsStatus === 'connecting'
                ? 'стриминг'
                : wsStatus === 'done'
                  ? 'готово'
                  : wsStatus === 'error'
                    ? 'ошибка'
                    : 'idle'}
            </span>
          </span>
          <button
            onClick={handleApplyCode}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-semibold rounded-lg transition"
          >
            Обновить превью
          </button>
          {isExporting && (
            <button
              onClick={handleCancelRender}
              className="px-4 py-2.5 bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 text-sm font-bold rounded-lg border border-rose-800/60 transition"
            >
              Отменить
            </button>
          )}
          <button
            onClick={handleFfmpegRender}
            disabled={isExporting}
            className="px-5 py-2.5 bg-[#4fdbc8] hover:bg-[#3ec4b2] text-[#06231d] text-sm font-bold rounded-lg flex items-center gap-2 transition disabled:opacity-50"
          >
            <Download size={18} />
            {isExporting
              ? `Кадр ${currentRenderFrame}/${durationInFrames}`
              : 'Рендерить через FFmpeg'}
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 flex-1 items-start">
        <div className="flex flex-col gap-4 bg-[#0f1626] border border-slate-800 rounded-xl p-4">
          <div className="flex justify-between items-center">
            <span className="text-xs font-mono font-bold uppercase text-slate-400">
              TSX Редактор сцены
            </span>
            <span className="text-xs text-slate-500">{code.length} символов</span>
          </div>
          <textarea
            value={code}
            onChange={(event: UIEvent<HTMLTextAreaElement>) =>
              setCode(event.currentTarget.value)
            }
            spellCheck={false}
            rows={26}
            className="w-full bg-[#06080f] text-slate-200 p-4 font-mono text-xs leading-relaxed rounded-lg border border-slate-800 focus:outline-none focus:border-[#4fdbc8] resize-y"
          />
        </div>

        <div className="flex flex-col gap-6">
          <div className="bg-[#0f1626] border border-slate-800 rounded-xl p-4 flex flex-col gap-3">
            <div className="flex justify-between items-center">
              <span className="text-xs font-mono font-bold uppercase text-slate-400">
                Live Preview
              </span>
              <span className="text-xs text-slate-500">
                {width}x{height} @ {fps}fps
              </span>
            </div>

            <div className="w-full aspect-video bg-black rounded-lg overflow-hidden border border-slate-800 relative">
              <PlayerSandbox.Root
                ref={playerRef}
                config={{
                  code: activeCode,
                  modules,
                  plugins,
                  mediaResolver: toViteFsPath,
                  durationInFrames,
                  fps,
                  width,
                  height,
                  controls: true,
                  loop: true,
                }}
              />
            </div>
          </div>

          <div className="bg-[#0f1626] border border-slate-800 rounded-xl p-4 flex flex-col gap-4">
            <div className="flex items-center gap-2 text-xs font-mono font-bold uppercase text-slate-400">
              <Settings size={14} /> Настройки вывода FFmpeg
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <label className="text-xs text-slate-400 flex flex-col gap-1.5">
                Ширина
                <input
                  type="number"
                  value={width}
                  onChange={(event) => setWidth(Number(event.currentTarget.value))}
                  className="bg-[#06080f] border border-slate-800 p-2 rounded text-xs font-mono text-white"
                />
              </label>

              <label className="text-xs text-slate-400 flex flex-col gap-1.5">
                Высота
                <input
                  type="number"
                  value={height}
                  onChange={(event) => setHeight(Number(event.currentTarget.value))}
                  className="bg-[#06080f] border border-slate-800 p-2 rounded text-xs font-mono text-white"
                />
              </label>

              <label className="text-xs text-slate-400 flex flex-col gap-1.5">
                Кадров всего
                <input
                  type="number"
                  value={durationInFrames}
                  onChange={(event) => setDurationInFrames(Number(event.currentTarget.value))}
                  className="bg-[#06080f] border border-slate-800 p-2 rounded text-xs font-mono text-white"
                />
              </label>

              <label className="text-xs text-slate-400 flex flex-col gap-1.5">
                Пресет скорости
                <select
                  value={preset}
                  onChange={(event) =>
                    setPreset(
                      event.currentTarget.value as
                        | 'ultrafast'
                        | 'superfast'
                        | 'veryfast'
                        | 'faster'
                        | 'fast'
                        | 'medium',
                    )
                  }
                  className="bg-[#06080f] border border-slate-800 p-2 rounded text-xs font-mono text-white"
                >
                  <option value="ultrafast">ultrafast</option>
                  <option value="superfast">superfast</option>
                  <option value="veryfast">veryfast</option>
                  <option value="faster">faster</option>
                  <option value="fast">fast</option>
                  <option value="medium">medium</option>
                </select>
              </label>
            </div>

            <label className="text-xs text-slate-400 flex flex-col gap-1.5 max-w-[200px]">
              CRF (качество)
              <input
                type="number"
                min={0}
                max={51}
                value={crf}
                onChange={(event) => setCrf(Number(event.currentTarget.value))}
                className="bg-[#06080f] border border-slate-800 p-2 rounded text-xs font-mono text-white"
              />
            </label>

            {isExporting && (
              <div className="flex flex-col gap-2 mt-2">
                <div className="flex justify-between text-xs font-mono">
                  <span className="text-[#4fdbc8]">
                    {wsStatus === 'finishing'
                      ? 'Финализация FFmpeg...'
                      : 'Стриминг кадров в FFmpeg (WebSocket)...'}
                  </span>
                  <span>{exportProgress}%</span>
                </div>
                <div className="w-full h-2 bg-slate-950 rounded-full overflow-hidden">
                  <div
                    style={{ width: `${exportProgress}%` }}
                    className="h-full bg-[#4fdbc8] transition-all duration-100"
                  />
                </div>
                <div className="flex gap-4 text-[11px] font-mono text-slate-500 mt-1">
                  <span>⏱ {(elapsedMs / 1000).toFixed(1)} сек</span>
                  <span>
                    ⚡{' '}
                    {elapsedMs > 0 && currentRenderFrame > 0
                      ? `${(currentRenderFrame / (elapsedMs / 1000)).toFixed(2)} кадр/с`
                      : '...'}
                  </span>
                  <span>📦 {mbSent.toFixed(2)} MB</span>
                </div>
              </div>
            )}

            {downloadUrl && (
              <div className="flex justify-between items-center bg-emerald-950/40 border border-emerald-800/60 p-3 rounded-lg mt-2">
                <span className="text-xs text-emerald-300 flex items-center gap-2">
                  <CheckCircle2 size={16} /> Видео готово к загрузке
                </span>
                <a
                  href={downloadUrl}
                  download="my-render.mp4"
                  className="px-4 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold rounded flex items-center gap-2"
                >
                  <Download size={14} /> Скачать MP4
                </a>
              </div>
            )}

            {logs.some((line) => line.includes('Ошибка')) && (
              <div className="flex items-center gap-2 bg-rose-950/40 border border-rose-800/60 p-3 rounded-lg mt-2 text-xs text-rose-300">
                <AlertCircle size={16} /> Последний рендер завершился с ошибкой
              </div>
            )}
          </div>

          <div className="bg-[#0f1626] border border-slate-800 rounded-xl p-4 flex flex-col gap-2">
            <span className="text-xs font-mono font-bold uppercase text-slate-400">
              Терминал вывода
            </span>
            <div className="bg-[#06080f] p-3 rounded-lg border border-slate-800 h-32 overflow-y-auto font-mono text-[11px] text-slate-400 space-y-1">
              {logs.length === 0 ? (
                <span className="text-slate-600">Готов к работе...</span>
              ) : (
                logs.map((line, index) => <div key={index}>{line}</div>)
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Play size={12} />
            Запуск: <code className="text-slate-400">npm run dev</code>{' '}
            → <code className="text-slate-400">http://localhost:5173/ffmpeg.html</code>
          </div>
        </div>
      </div>
    </div>
  );
}