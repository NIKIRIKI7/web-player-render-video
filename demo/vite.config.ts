import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { spawn } from 'node:child_process';
import type { ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';
import path from 'node:path';
import { existsSync, mkdirSync, createReadStream, rmSync } from 'node:fs';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';

const page = (name: string) => fileURLToPath(new URL(`./${name}`, import.meta.url));

interface FfmpegStartBody {
  width: number;
  height: number;
  fps: number;
  totalFrames: number;
  filename?: string;
  crf?: number;
  preset?: string;
}

type FfmpegProc = ChildProcessByStdio<null, Readable, Readable>;

interface WsStartBody {
  width: number;
  height: number;
  fps: number;
  totalFrames: number;
  filename?: string;
  crf?: number;
  preset?: string;
}

// Оптимальный баланс качества/скорости для локального рендера (вместо crf=18, preset=fast).
const DEFAULT_CRF = 20;
const DEFAULT_PRESET = 'veryfast';

// Multi-page demo: index.html (Player) + studio.html (Studio) + ffmpeg.html (FFmpeg Studio).
export default defineConfig({
  server: {
    fs: {
      // Разрешить Vite отдавать локальные файлы по абсолютному пути (`/@fs/C:/...`),
      // чтобы медиа-сцены с путями `C:\...` работали без блокировки браузера.
      strict: false,
    },
  },
  plugins: [
    {
      name: 'ffmpeg-render-api',
      configureServer(server) {
        let ffmpeg: FfmpegProc | null = null;
        let outputPath = '';
        let stderrTail = '';
        let startedAt = 0;
        let lastFrameAt = 0;

        // 10 секунд без кадров = рендер оборвался (reload вкладки, ошибка клиента).
        const STALE_MS = 10_000;

        function isStale(): boolean {
          if (!ffmpeg) return false;
          if (ffmpeg.exitCode !== null) return true;
          if (!startedAt) return false;
          const now = Date.now();
          const idleSince = lastFrameAt || startedAt;
          return now - idleSince > STALE_MS;
        }

        async function cancelActive(): Promise<void> {
          if (!ffmpeg) return;
          const proc = ffmpeg;
          ffmpeg = null;
          const removing = outputPath;
          outputPath = '';
          startedAt = 0;
          lastFrameAt = 0;
          proc.stdin?.end();
          proc.stderr?.removeAllListeners();
          try {
            proc.kill();
          } catch {}
          if (removing && existsSync(removing)) {
            try {
              rmSync(removing, { force: true });
            } catch {}
          }
        }

        // Уборка orphan-процессов при остановке dev-сервера.
        server.httpServer?.on('close', () => {
          void cancelActive();
        });

        // --- WebSocket-канал для потоковой передачи кадров в FFmpeg ---
        const wss = new WebSocketServer({ noServer: true });

        server.httpServer?.on('upgrade', (req, socket: Duplex, head) => {
          if (req.url === '/api/ffmpeg/ws') {
            wss.handleUpgrade(req, socket, head, (ws) => {
              wss.emit('connection', ws, req);
            });
          }
        });

        wss.on('connection', (ws) => {
          ws.on('message', async (data: Buffer, isBinary: boolean) => {
            try {
              if (isBinary || !data.toString().trimStart().startsWith('{')) {
                // Бинарный JPEG-кадр: пишем напрямую в stdin FFmpeg.
                if (ffmpeg?.stdin && !ffmpeg.stdin.destroyed) {
                  const canWrite = ffmpeg.stdin.write(data);
                  if (!canWrite) {
                    await new Promise<void>((resolve) => ffmpeg!.stdin!.once('drain', () => resolve()));
                  }
                  lastFrameAt = Date.now();
                }
                if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'ACK' }));
                return;
              }

              const msg = JSON.parse(data.toString()) as { type: string } & WsStartBody;

              if (msg.type === 'START') {
                if (ffmpeg && !isStale()) {
                  ws.send(JSON.stringify({ type: 'ERROR', error: 'Render already in progress' }));
                  return;
                }
                if (ffmpeg && isStale()) {
                  console.warn('[ffmpeg-render-api] stale render detected via WS, cancelling it');
                  await cancelActive();
                }

                const { width, height, fps, totalFrames } = msg;
                if (!width || !height || !fps || !totalFrames) {
                  ws.send(JSON.stringify({ type: 'ERROR', error: 'width/height/fps/totalFrames required' }));
                  return;
                }

                const crf = msg.crf ?? DEFAULT_CRF;
                const preset = msg.preset ?? DEFAULT_PRESET;
                const filename = msg.filename ?? `render-${Date.now()}.mp4`;

                const outDir = path.resolve(process.cwd(), 'render/out');
                if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
                outputPath = path.join(outDir, path.basename(filename));

                const args = [
                  '-hide_banner',
                  '-loglevel', 'error',
                  '-y',
                  '-f', 'image2pipe',
                  '-vcodec', 'mjpeg',
                  '-r', String(fps),
                  '-i', 'pipe:0',
                  '-fps_mode', 'cfr',
                  '-c:v', 'libx264',
                  '-preset', preset,
                  '-crf', String(crf),
                  '-pix_fmt', 'yuv420p',
                  '-movflags', '+faststart',
                  '-frames:v', String(totalFrames),
                  outputPath,
                ];

                ffmpeg = newFfmpegProcess(args);
                startedAt = Date.now();
                lastFrameAt = 0;
                ws.send(JSON.stringify({ type: 'STARTED' }));
              } else if (msg.type === 'FINISH') {
                const proc = ffmpeg;
                if (!proc) {
                  ws.send(JSON.stringify({ type: 'ERROR', error: 'no active process' }));
                  return;
                }
                const exitCode = await new Promise<number | null>((resolve) => {
                  proc.once('close', (code) => resolve(code));
                  proc.stdin!.end();
                });
                const finished = ffmpeg;
                ffmpeg = null;
                startedAt = 0;
                lastFrameAt = 0;

                if (exitCode === 0) {
                  ws.send(JSON.stringify({
                    type: 'DONE',
                    downloadUrl: `/api/ffmpeg/download?f=${path.basename(outputPath)}`,
                    code: 0,
                  }));
                } else {
                  ws.send(JSON.stringify({
                    type: 'ERROR',
                    error: `FFmpeg exit ${exitCode}:\n${stderrTail}`,
                    code: exitCode,
                  }));
                  if (finished && existsSync(outputPath)) {
                    try {
                      const { unlink } = await import('node:fs/promises');
                      await unlink(outputPath);
                    } catch {}
                  }
                }
              } else if (msg.type === 'CANCEL') {
                await cancelActive();
                ws.send(JSON.stringify({ type: 'CANCELLED' }));
              }
            } catch (error) {
              ws.send(JSON.stringify({ type: 'ERROR', error: (error as Error).message ?? String(error) }));
            }
          });

          // Обрыв сокета = клиент умер (reload вкладки, abort, краш).
          // Сразу убиваем FFmpeg, чтобы следующий START не возвращал 409.
          ws.on('close', () => {
            if (ffmpeg) {
              console.warn('[ffmpeg-render-api] WS closed during render, cancelling');
              void cancelActive();
            }
          });

          ws.on('error', () => {
            if (ffmpeg) {
              void cancelActive();
            }
          });
        });

        async function readBody(req: IncomingMessage): Promise<Buffer> {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(chunk as Buffer);
          return Buffer.concat(chunks);
        }

        function newFfmpegProcess(args: string[]): FfmpegProc {
          const proc = spawn('ffmpeg', args, {
            stdio: ['pipe', 'pipe', 'pipe'],
          }) as FfmpegProc;

          stderrTail = '';
          proc.stderr.on('data', (chunk: Buffer) => {
            stderrTail = (stderrTail + chunk.toString()).slice(-4000);
          });

          proc.on('error', (err) => {
            console.error('[ffmpeg-render-api] process error:', err);
          });

          return proc;
        }

        async function writeFrame(buffer: Buffer): Promise<void> {
          if (!ffmpeg?.stdin) {
            const error = new Error('FFmpeg process not active');
            (error as { code?: number }).code = 500;
            throw error;
          }
          const ok = ffmpeg.stdin.write(buffer);
          if (!ok) {
            await new Promise<void>((resolve) => ffmpeg!.stdin!.once('drain', () => resolve()));
          }
        }

        // 1. Старт FFmpeg процесса
        server.middlewares.use('/api/ffmpeg/start', async (req, res) => {
          if (req.method !== 'POST') {
            res.statusCode = 405;
            res.end('POST only');
            return;
          }
          if (ffmpeg && !isStale()) {
            res.statusCode = 409;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ status: 'busy', error: 'Render already in progress' }));
            return;
          }

          // Оборванный предыдущий рендер: убиваем процесс и начинаем заново.
          if (ffmpeg && isStale()) {
            console.warn('[ffmpeg-render-api] stale render detected, cancelling it');
            await cancelActive();
          }

          const body = JSON.parse((await readBody(req)).toString()) as Partial<FfmpegStartBody>;
          const { width, height, fps, totalFrames } = body;
          const crf = body.crf ?? DEFAULT_CRF;
          const preset = body.preset ?? DEFAULT_PRESET;
          const filename = body.filename ?? `render-${Date.now()}.mp4`;

          if (!width || !height || !fps || !totalFrames) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ status: 'error', error: 'width/height/fps/totalFrames required' }));
            return;
          }

          const outDir = path.resolve(process.cwd(), 'render/out');
          if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
          outputPath = path.join(outDir, path.basename(filename));

          const args = [
            '-hide_banner',
            '-loglevel', 'error',
            '-y',
            '-f', 'image2pipe',
            '-vcodec', 'mjpeg',
            '-r', String(fps),
            '-i', 'pipe:0',
            '-fps_mode', 'cfr',
            '-c:v', 'libx264',
            '-preset', preset,
            '-crf', String(crf),
            '-pix_fmt', 'yuv420p',
            '-movflags', '+faststart',
            '-frames:v', String(totalFrames),
            outputPath,
          ];

          ffmpeg = newFfmpegProcess(args);
          startedAt = Date.now();
          lastFrameAt = 0;

          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ status: 'started', outputFilePath: outputPath }));
        });

        // 2. Приём кадра из браузера
        server.middlewares.use('/api/ffmpeg/frame', async (req, res) => {
          if (req.method !== 'POST') {
            res.statusCode = 405;
            res.end('POST only');
            return;
          }
          try {
            const buffer = await readBody(req);
            await writeFrame(buffer);
            lastFrameAt = Date.now();
            res.end('ok');
          } catch (error) {
            const code = (error as { code?: number }).code ?? 500;
            res.statusCode = code;
            res.end((error as Error).message ?? String(error));
          }
        });

        // 3. Завершение рендера
        server.middlewares.use('/api/ffmpeg/finish', async (req, res) => {
          if (req.method !== 'POST') {
            res.statusCode = 405;
            res.end('POST only');
            return;
          }
          if (!ffmpeg) {
            res.statusCode = 409;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ status: 'error', error: 'no active process' }));
            return;
          }

          const exitCode = await new Promise<number | null>((resolve) => {
            ffmpeg!.once('close', (code) => resolve(code));
            ffmpeg!.stdin!.end();
          });

          const finished = ffmpeg;
          ffmpeg = null;
          startedAt = 0;
          lastFrameAt = 0;

          const success = exitCode === 0;
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify(
              success
                ? {
                    status: 'done',
                    downloadUrl: `/api/ffmpeg/download?f=${path.basename(outputPath)}`,
                  }
                : {
                    status: 'error',
                    error: `FFmpeg exit ${exitCode}:\n${stderrTail}`,
                    failedFile: outputPath,
                  },
            ),
          );

          if (!success && finished && existsSync(outputPath)) {
            try {
              const { unlink } = await import('node:fs/promises');
              await unlink(outputPath);
            } catch {}
          }
        });

        // 4. Отмена активного рендера (reload вкладки, abort клиента, ошибка).
        //    Идемпотентен: при отсутствии активного процесса возвращает 200.
        server.middlewares.use('/api/ffmpeg/cancel', async (req, res) => {
          if (req.method !== 'POST') {
            res.statusCode = 405;
            res.end('POST only');
            return;
          }
          if (ffmpeg) {
            console.warn('[ffmpeg-render-api] cancel render');
          }
          await cancelActive();
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ status: 'cancelled' }));
        });

        // 5. Скачивание готового MP4
        server.middlewares.use('/api/ffmpeg/download', (req, res: ServerResponse) => {
          const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
          const filename = url.searchParams.get('f');
          if (!filename) {
            res.statusCode = 400;
            res.end('File not found');
            return;
          }

          const target = path.resolve(process.cwd(), 'render/out', path.basename(filename));
          if (!existsSync(target)) {
            res.statusCode = 404;
            res.end('Not exists');
            return;
          }

          res.setHeader('Content-Type', 'video/mp4');
          res.setHeader('Content-Disposition', `attachment; filename="${path.basename(target)}"`);
          createReadStream(target).pipe(res);
        });
      },
    },
  ],
  build: {
    rollupOptions: {
      input: {
        index: page('index.html'),
        studio: page('studio.html'),
        ffmpeg: page('ffmpeg.html'),
      },
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('sucrase')) return 'vendor-sucrase';
          if (id.includes('remotion') && id.includes('player')) return 'vendor-remotion-player';
          if (id.includes('remotion')) return 'vendor-remotion-core';
          if (id.includes('lucide')) return 'vendor-lucide';
          if (id.includes('react')) return 'vendor-react';
          return 'vendor-utils';
        },
      },
    },
    onwarn(warning, warn) {
      if (typeof warning === 'object' && warning.message.includes('"use client"')) return;
      warn(warning);
    },
  },
});