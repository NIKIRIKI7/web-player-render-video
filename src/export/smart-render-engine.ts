import path from 'node:path';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { detectHardwareAndProfile } from './hardware-detect';
import { FfmpegSmartPipe } from './ffmpeg-smart-pipeline';
import { BROLL_SYNC_INJECT_SCRIPT } from './broll-sync';
import { logger } from '../core/logger';

export interface SmartRenderJobOptions {
  sceneHtml: string;
  outputPath: string;
  width: number;
  height: number;
  fps: number;
  totalFrames: number;
  forceConcurrency?: number;
  onOverallProgress?: (frame: number, total: number, curFps: number) => void;
}

interface ChunkTask {
  start: number;
  end: number;
  tempPath: string;
}

export async function executeSmartRender(
  options: SmartRenderJobOptions
): Promise<{ durationSec: number }> {
  const t0 = performance.now();
  const profile = detectHardwareAndProfile(options.width, options.height);
  const concurrency = options.forceConcurrency ?? profile.availableConcurrency;

  logger.info(
    `Запуск Smart Render Engine: ${options.totalFrames} кадров на ${concurrency} параллельных потоках`
  );

  const outDir = path.dirname(path.resolve(options.outputPath));
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  // Playwright импортируется динамически — не добавляет зависимость для
  // потребителей, которые используют только FFmpeg API (./ffmpeg subpath).
  const { chromium } = await import('playwright');

  // 1. Запуск браузера с максимальной производительностью
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--disable-web-security',
      '--allow-file-access-from-files',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--enable-gpu-rasterization',
      '--enable-accelerated-video-decode',
      '--ignore-gpu-blocklist',
    ],
  });

  // 2. Распределение кадров по сегментам
  const chunkSize = Math.ceil(options.totalFrames / concurrency);
  const chunkTasks: ChunkTask[] = [];

  for (let i = 0; i < concurrency; i++) {
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, options.totalFrames);
    if (start >= end) continue;
    chunkTasks.push({
      start,
      end,
      tempPath: path.join(outDir, `_part_${i}_${Date.now()}.mp4`),
    });
  }

  let totalFramesRendered = 0;

  // 3. Функция рендеринга одного изолированного сегмента
  const renderChunk = async (task: ChunkTask) => {
    const chunkFrames = task.end - task.start;
    const page = await browser.newPage({
      viewport: { width: options.width, height: options.height },
      deviceScaleFactor: 1,
    });

    try {
      await page.setContent(options.sceneHtml);
      await page.addScriptTag({ content: BROLL_SYNC_INJECT_SCRIPT });

// Ждём полной загрузки сцены (модуль + Remotion + React)
      await page.waitForFunction(
        () => typeof (window as any).__remotion_seekTo === 'function',
        null,
        { timeout: 60_000 }
      );

      const cdp = await page.context().newCDPSession(page);

      const pipe = new FfmpegSmartPipe({
        outputPath: task.tempPath,
        width: options.width,
        height: options.height,
        fps: options.fps,
        totalFrames: chunkFrames,
        hardwareProfile: profile,
      });
      await pipe.start();

      try {
        for (let f = task.start; f < task.end; f++) {
          // Устанавливаем кадр
          await page.evaluate(
            (target: number) => {
              (window as any).__remotion_seekTo(target);
            },
            f
          );

          // БАРЬЕР СИНХРОНИЗАЦИИ B-ROLL: ждём декодирования видео
          await page.evaluate(
            ({ frame, fps }: { frame: number; fps: number }) =>
              (window as any).__brollWaitSync(frame, fps),
            { frame: f, fps: options.fps }
          );

          // Ожидаем коммита кадра React в DOM (двойной rAF до захвата)
          await page.evaluate(
            () =>
              new Promise<void>((resolve) =>
                requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
              )
          );

          // Захватываем кадр в JPEG напрямую из памяти GPU через CDP
          const screenshot = await cdp.send('Page.captureScreenshot', {
            format: 'jpeg',
            quality: 98,
            captureBeyondViewport: false,
          });

          const buf = Buffer.from(screenshot.data as string, 'base64');
          await pipe.writeFrame(buf);

          totalFramesRendered++;
          if (options.onOverallProgress && totalFramesRendered % 10 === 0) {
            const curElapsed = (performance.now() - t0) / 1000;
            options.onOverallProgress(
              totalFramesRendered,
              options.totalFrames,
              totalFramesRendered / curElapsed
            );
          }
        }

        await pipe.finish();
      } finally {
        await cdp.detach().catch(() => {});
      }
    } finally {
      await page.close();
    }
  };

  // 4. Параллельный запуск всех сегментов
  try {
    await Promise.all(chunkTasks.map(renderChunk));

    // 5. Мгновенная сшивка без перекодирования
    logger.info('Все сегменты готовы, выполняется склейка FFmpeg...');
    const segmentFiles = chunkTasks.map((t) => t.tempPath);
    await FfmpegSmartPipe.concatSegments(segmentFiles, options.outputPath);

    // Удаляем временные кусочки
    segmentFiles.forEach((file) => rmSync(file, { force: true }));
  } finally {
    await browser.close();
  }

  const durationSec = (performance.now() - t0) / 1000;
  return { durationSec };
}