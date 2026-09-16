import path from 'node:path';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const distEntry = path.join(root, 'dist', 'ffmpeg.js');

if (!existsSync(distEntry)) {
  console.error('[render-fast] Сборка не найдена. Сначала: npm run build');
  process.exit(1);
}

const { FfmpegVideoPipe } = await import(pathToFileURL(distEntry).href);

function parseArgs(argv) {
  const opts = {
    url: null,
    out: path.join(here, 'out', 'fast-render.mp4'),
    width: 1280,
    height: 720,
    fps: 30,
    frames: 120,
    advance: undefined,
    preset: 'medium',
    crf: 18,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--url': opts.url = argv[++i] ?? null; break;
      case '--out': opts.out = argv[++i] ?? opts.out; break;
      case '--width': opts.width = Number(argv[++i]); break;
      case '--height': opts.height = Number(argv[++i]); break;
      case '--fps': opts.fps = Number(argv[++i]); break;
      case '--frames': opts.frames = Number(argv[++i]); break;
      case '--advance-js': opts.advance = argv[++i]; break;
      case '--preset': opts.preset = argv[++i]; break;
      case '--crf': opts.crf = Number(argv[++i]); break;
      default:
        console.error(`[render-fast] неизвестный аргумент: ${arg}`);
        process.exit(1);
    }
  }

  return opts;
}

function createFrameGenerator(width, height) {
  const size = width * height * 4;
  const rgba = new Uint8Array(size);
  const BAR = 48;

  return function generate(frame) {
    const barX = (frame * 10) % width;
    const wave = frame * 3;
    for (let p = 0; p < size; p += 4) {
      const pix = p >> 2;
      const x = pix % width;
      const inBar = Math.abs(x - barX) < BAR;
      rgba[p] = inBar ? 255 : (x + wave) & 255;
      rgba[p + 1] = inBar ? 255 : (pix >> 10) & 255;
      rgba[p + 2] = inBar ? 255 : (pix >> 18) & 255;
      rgba[p + 3] = 255;
    }
    return rgba;
  };
}

async function runSynthetic(opts) {
  console.log(
    '[render-fast] виртуальный демо-рендер (playwright не используется)',
  );
  const { width, height, fps, frames, preset, crf } = opts;
  const generate = createFrameGenerator(width, height);
  const pipe = new FfmpegVideoPipe({
    outputPath: opts.out,
    width,
    height,
    fps,
    totalFrames: frames,
    preset,
    crf,
  });

  const start = performance.now();
  await pipe.start();
  for (let f = 0; f < frames; f++) {
    await pipe.writeFrame(generate(f));
    if (f % 30 === 0) {
      process.stdout.write(`\r[render-fast] frame ${f}/${frames}`);
    }
  }
  process.stdout.write(`\r[render-fast] frame ${frames}/${frames}\n`);
  await pipe.finish();

  const elapsedSec = ((performance.now() - start) / 1000).toFixed(2);
  const bytes = statSync(opts.out).size;
  console.log(
    `[render-fast] готово: ${opts.out} (${(bytes / 1024 / 1024).toFixed(2)} MB, ${elapsedSec}s)`,
  );
}

async function runChrome(opts) {
  let playwright;
  try {
    playwright = await import('playwright');
  } catch {
    return 'missing';
  }

  const chromePath = [
    process.env.RENDER_FAST_CHROME,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ].find((candidate) => candidate && existsSync(candidate));

  if (!chromePath) {
    throw new Error(
      'Chrome не найден. Укажите RENDER_FAST_CHROME или установите Chrome/Edge.',
    );
  }

  const browser = await playwright.chromium.launch({
    headless: true,
    executablePath: chromePath,
  });
  const context = await browser.newContext({
    viewport: { width: opts.width, height: opts.height },
    deviceScaleFactor: 1,
  });

  try {
    const page = await context.newPage();
    await page.goto(opts.url, { waitUntil: 'networkidle' });

    const pipe = new FfmpegVideoPipe({
      outputPath: opts.out,
      width: opts.width,
      height: opts.height,
      fps: opts.fps,
      totalFrames: opts.frames,
      preset: opts.preset,
      crf: opts.crf,
      frameFormat: 'png',
    });

    await pipe.start();
    for (let f = 0; f < opts.frames; f++) {
      if (opts.advance) {
        const code = opts.advance.replaceAll('__FRAME__', String(f));
        await page.evaluate(`(() => { ${code}; })()`);
      }
      await page.waitForTimeout(16);
      const shot = await page.screenshot({ type: 'png' });
      await pipe.writeFrame(shot);
      if (f % 30 === 0) {
        process.stdout.write(`\r[render-fast] frame ${f}/${opts.frames}`);
      }
    }
    process.stdout.write(`\r[render-fast] frame ${opts.frames}/${opts.frames}\n`);
    await pipe.finish();
  } finally {
    await browser.close();
  }

  return 'ok';
}

void (async () => {
  let ffmpegOk = false;
  try {
    execSync('ffmpeg -version', { stdio: 'ignore' });
    ffmpegOk = true;
  } catch {}

  if (!ffmpegOk) {
    console.error('[render-fast] ffmpeg не найден в PATH.');
    process.exit(1);
  }

  const opts = parseArgs(process.argv.slice(2));
  mkdirSync(path.dirname(opts.out), { recursive: true });

  if (opts.url) {
    try {
      const status = await runChrome(opts);
      if (status === 'missing') {
        console.warn(
          '[render-fast] playwright не установлен. Установка: npm i -D playwright && npx playwright install chromium',
        );
        console.warn('[render-fast] переход на виртуальный режим...');
        await runSynthetic(opts);
      }
    } catch (error) {
      console.error('[render-fast] ошибка:', error);
      process.exit(1);
    }
  } else {
    await runSynthetic(opts);
  }
})();