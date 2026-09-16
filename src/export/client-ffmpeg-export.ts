import { stepDeterministicTick } from './deterministic-stepper';
import type { SnapshotOptions } from '../sandbox/snapshot';

export interface ClientFfmpegExportOptions {
  container: HTMLElement;
  durationInFrames: number;
  fps: number;
  width: number;
  height: number;
  seekTo: (frame: number) => void;
  filename?: string;
  crf?: number;
  preset?: string;
  snapshotOptions?: SnapshotOptions;
  onProgress?: (frame: number, total: number, progress: number) => void;
  onFrame?: (frame: number) => void;
  signal?: AbortSignal;
}

type WsMessage =
  | { type: 'STARTED' }
  | { type: 'ACK' }
  | { type: 'DONE'; downloadUrl: string; code: number };

/**
 * Покадрово двигает таймлайн и отправляет кадры через WebSocket в нативный FFmpeg.
 *
 * В отличие от HTTP-версии, бинарные JPEG-кадры передаются мгновенно (<0.5 мс)
 * без оверхеда HTTP-рукопожатий и заголовков.
 *
 * Каждый кадр проходит детерминированный цикл:
 *   Пауза → Синхронизация B-Roll (requestVideoFrameCallback) → Отрисовка → Снимок
 *
 * Возвращает относительный URL готового файла (`/api/ffmpeg/download?f=...`).
 */
export async function exportViaFfmpegBackend(
  options: ClientFfmpegExportOptions,
): Promise<string> {
  const {
    container,
    durationInFrames,
    fps,
    width,
    height,
    seekTo,
    filename = `render-${Date.now()}.mp4`,
    crf = 20,
    preset = 'veryfast',
    snapshotOptions,
    onProgress,
    onFrame,
    signal,
  } = options;

  return new Promise<string>((resolve, reject) => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/api/ffmpeg/ws`);

    let currentFrame = 0;
    let isAborted = false;

    const abortHandler = () => {
      isAborted = true;
      ws.close();
      reject(new Error('Экспорт отменён пользователем'));
    };
    if (signal) {
      signal.addEventListener('abort', abortHandler, { once: true });
    }

    const cleanup = () => {
      if (signal) signal.removeEventListener('abort', abortHandler);
    };

    ws.onerror = () => {
      cleanup();
      reject(new Error('Ошибка соединения с WebSocket сервером FFmpeg'));
    };

    ws.onclose = () => {
      cleanup();
    };

    ws.onmessage = async (event: MessageEvent) => {
      if (typeof event.data === 'string') {
        const msg = JSON.parse(event.data) as WsMessage;

        if (msg.type === 'STARTED' || msg.type === 'ACK') {
          if (isAborted) return;

          if (currentFrame >= durationInFrames) {
            ws.send(JSON.stringify({ type: 'FINISH' }));
            return;
          }

          try {
            const frameBlob = await stepDeterministicTick(
              container,
              currentFrame,
              fps,
              width,
              height,
              seekTo,
              snapshotOptions,
            );

            ws.send(frameBlob);

            currentFrame++;
            onFrame?.(currentFrame - 1);
            onProgress?.(currentFrame, durationInFrames, currentFrame / durationInFrames);
          } catch (err) {
            ws.close();
            cleanup();
            reject(err);
          }
        } else if (msg.type === 'DONE') {
          cleanup();
          ws.close();
          if (msg.code === 0 && msg.downloadUrl) {
            resolve(msg.downloadUrl);
          } else {
            reject(new Error(`FFmpeg завершился с кодом ${msg.code}`));
          }
        }
      }
    };

    ws.onopen = () => {
      ws.send(JSON.stringify({
        type: 'START',
        width,
        height,
        fps,
        totalFrames: durationInFrames,
        filename,
        crf,
        preset,
      }));
    };
  });
}
