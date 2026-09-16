import { performance } from 'node:perf_hooks';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { renderWithFfmpeg, RawRgbaFrameSource, toEvenFrameSize } from '../export/ffmpeg-renderer';
import { logger } from '../core/logger';

export interface BenchmarkConfig {
  resolutions: Array<{ label: string; width: number; height: number }>;
  totalFrames: number;
  fps: number;
  iterations: number;
  warmup: number;
  crf: number;
  preset: string;
  outputDir?: string;
}

export interface BenchmarkMeasurement {
  resolution: string;
  width: number;
  height: number;
  iteration: number;
  totalFrames: number;
  fps: number;
  elapsedMs: number;
  fpsActual: number;
  realtimeMultiplier: number;
  megapixelsPerSec: number;
  status: 'ok' | 'failed';
  error?: string;
}

export type BenchmarkMetrics = BenchmarkMeasurement;

export interface BenchmarkSummary {
  resolution: string;
  width: number;
  height: number;
  avgFps: number;
  avgRealtimeMultiplier: number;
  avgMegapixelsPerSec: number;
  minElapsedMs: number;
  maxElapsedMs: number;
  iterations: number;
}

export interface BenchmarkReport {
  config: BenchmarkConfig;
  measurements: BenchmarkMeasurement[];
  summaries: BenchmarkSummary[];
  totalElapsedMs: number;
}

const DEFAULT_RESOLUTIONS: Array<{ label: string; width: number; height: number }> = [
  { label: '720p', width: 1280, height: 720 },
  { label: '1080p', width: 1920, height: 1080 },
  { label: '4k', width: 3840, height: 2160 },
];

export function createBenchmarkConfig(
  overrides: Partial<BenchmarkConfig> = {},
): BenchmarkConfig {
  return {
    resolutions: overrides.resolutions ?? DEFAULT_RESOLUTIONS,
    totalFrames: overrides.totalFrames ?? 60,
    fps: overrides.fps ?? 30,
    iterations: overrides.iterations ?? 3,
    warmup: overrides.warmup ?? 1,
    crf: overrides.crf ?? 23,
    preset: overrides.preset ?? 'ultrafast',
    outputDir: overrides.outputDir,
  };
}

function generateSyntheticFrame(
  width: number,
  height: number,
  frame: number,
): Uint8Array {
  const size = width * height * 4;
  const rgba = new Uint8Array(size);
  const t = frame / 60;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      const nx = x / width;
      const ny = y / height;

      rgba[offset] = Math.round(128 + 127 * Math.sin(nx * 6.28 + t));
      rgba[offset + 1] = Math.round(128 + 127 * Math.sin(ny * 6.28 + t * 1.3));
      rgba[offset + 2] = Math.round(128 + 127 * Math.sin((nx + ny) * 3.14 + t * 0.7));
      rgba[offset + 3] = 255;
    }
  }

  return rgba;
}

async function runSingleMeasurement(
  config: BenchmarkConfig,
  resolution: { label: string; width: number; height: number },
  iteration: number,
  outputDir: string,
): Promise<BenchmarkMeasurement> {
  const width = toEvenFrameSize(resolution.width);
  const height = toEvenFrameSize(resolution.height);
  const outputFile = resolve(
    outputDir,
    `benchmark-${resolution.label}-${iteration}.mp4`,
  );

  const frameSource = new RawRgbaFrameSource({
    generateFrame: (frame) =>
      Promise.resolve(generateSyntheticFrame(width, height, frame)),
    width,
    height,
    totalFrames: config.totalFrames,
  });

  const start = performance.now();

  try {
    await renderWithFfmpeg(outputFile, frameSource, {
      width,
      height,
      fps: config.fps,
      totalFrames: config.totalFrames,
      crf: config.crf,
      preset: config.preset,
      overwrite: true,
    });

    const elapsedMs = performance.now() - start;
    const fpsActual = config.totalFrames / (elapsedMs / 1000);
    const realtimeMultiplier = fpsActual / config.fps;
    const megapixelsPerSec =
      (width * height * config.totalFrames) / (elapsedMs / 1000) / 1e6;

    return {
      resolution: resolution.label,
      width,
      height,
      iteration,
      totalFrames: config.totalFrames,
      fps: config.fps,
      elapsedMs,
      fpsActual,
      realtimeMultiplier,
      megapixelsPerSec,
      status: 'ok',
    };
  } catch (error) {
    const elapsedMs = performance.now() - start;
    return {
      resolution: resolution.label,
      width,
      height,
      iteration,
      totalFrames: config.totalFrames,
      fps: config.fps,
      elapsedMs,
      fpsActual: 0,
      realtimeMultiplier: 0,
      megapixelsPerSec: 0,
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function summarizeMeasurements(
  measurements: BenchmarkMeasurement[],
): BenchmarkSummary[] {
  const byResolution = new Map<string, BenchmarkMeasurement[]>();

  for (const m of measurements) {
    const key = m.resolution;
    const list = byResolution.get(key) ?? [];
    list.push(m);
    byResolution.set(key, list);
  }

  const summaries: BenchmarkSummary[] = [];
  for (const [resolution, items] of byResolution) {
    const ok = items.filter((m) => m.status === 'ok');
    if (ok.length === 0) continue;

    const avgFps = ok.reduce((s, m) => s + m.fpsActual, 0) / ok.length;
    const avgRealtime =
      ok.reduce((s, m) => s + m.realtimeMultiplier, 0) / ok.length;
    const avgMp =
      ok.reduce((s, m) => s + m.megapixelsPerSec, 0) / ok.length;
    const elapsed = ok.map((m) => m.elapsedMs);

    summaries.push({
      resolution,
      width: ok[0]?.width ?? 0,
      height: ok[0]?.height ?? 0,
      avgFps,
      avgRealtimeMultiplier: avgRealtime,
      avgMegapixelsPerSec: avgMp,
      minElapsedMs: Math.min(...elapsed),
      maxElapsedMs: Math.max(...elapsed),
      iterations: ok.length,
    });
  }

  return summaries.sort((a, b) => b.width - a.width);
}

export async function runBenchmark(
  config: BenchmarkConfig,
  onProgress?: (measurement: BenchmarkMeasurement) => void,
): Promise<BenchmarkReport> {
  const outputDir = resolve(config.outputDir ?? 'benchmark-results');
  await mkdir(outputDir, { recursive: true });

  const measurements: BenchmarkMeasurement[] = [];

  const overallStart = performance.now();

  for (const resolution of config.resolutions) {
    for (let w = 0; w < config.warmup; w++) {
      const m = await runSingleMeasurement(config, resolution, -w, outputDir);
      logger.info(
        `Benchmark warmup ${resolution.label} #${w + 1}: ${m.elapsedMs.toFixed(0)}ms`,
      );
    }

    for (let i = 0; i < config.iterations; i++) {
      const m = await runSingleMeasurement(config, resolution, i, outputDir);
      measurements.push(m);

      logger.info(
        `Benchmark ${resolution.label} #${i + 1}/${config.iterations}: ` +
        `${m.fpsActual.toFixed(1)} fps, ${m.realtimeMultiplier.toFixed(2)}x RT, ` +
        `${m.megapixelsPerSec.toFixed(1)} Mp/s, ${m.elapsedMs.toFixed(0)}ms`,
      );

      onProgress?.(m);
    }
  }

  const totalElapsedMs = performance.now() - overallStart;
  const summaries = summarizeMeasurements(measurements);

  const report: BenchmarkReport = {
    config,
    measurements,
    summaries,
    totalElapsedMs,
  };

  const reportPath = resolve(outputDir, 'report.json');
  await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');

  const mdPath = resolve(outputDir, 'report.md');
  const md = formatBenchmarkReport(report);
  await writeFile(mdPath, md, 'utf8');

  logger.info(`Benchmark report saved: ${reportPath}, ${mdPath}`);

  return report;
}

export function formatBenchmarkReport(report: BenchmarkReport): string {
  const lines: string[] = [
    '# FFmpeg Benchmark Report',
    '',
    `Config: ${report.config.totalFrames} frames @ ${report.config.fps} fps, ` +
    `CRF ${report.config.crf}, preset ${report.config.preset}`,
    '',
    '| Resolution | Avg FPS | Realtime | Mp/s | Min (ms) | Max (ms) | Iterations |',
    '|------------|---------|----------|------|----------|----------|------------|',
  ];

  for (const s of report.summaries) {
    lines.push(
      `| ${s.resolution} (${s.width}x${s.height}) | ` +
      `${s.avgFps.toFixed(1)} | ${s.avgRealtimeMultiplier.toFixed(2)}x | ` +
      `${s.avgMegapixelsPerSec.toFixed(1)} | ${s.minElapsedMs.toFixed(0)} | ` +
      `${s.maxElapsedMs.toFixed(0)} | ${s.iterations} |`,
    );
  }

  lines.push('');
  lines.push(
    `Total elapsed: ${(report.totalElapsedMs / 1000).toFixed(1)}s`,
  );

  return lines.join('\n');
}
