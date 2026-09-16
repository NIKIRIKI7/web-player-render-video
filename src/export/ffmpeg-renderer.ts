import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, basename, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { logger } from '../core/logger';
import {
  cueToAudioTrack,
  buildFfmpegAudioFilter,
  type AudioTrackConfig,
} from './cue-to-ffmpeg';
import type { Cue, AudioPayload } from '../timeline/index';

export interface FfmpegRenderOptions {
  ffmpegPath?: string;
  width: number;
  height: number;
  fps: number;
  totalFrames: number;
  crf?: number;
  preset?: string;
  pixelFormat?: string;
  outputFormat?: 'mp4' | 'mkv' | 'webm';
  overwrite?: boolean;
  signal?: AbortSignal;
  onProgress?: (progress: FfmpegRenderProgress) => void;
  audioCues?: ReadonlyArray<Cue<AudioPayload>>;
  audioSampleRate?: number;
  background?: string;
  keepTemporary?: boolean;
}

export interface FfmpegRenderProgress {
  phase: 'starting' | 'encoding' | 'finalizing' | 'done';
  frame: number;
  totalFrames: number;
  progress: number;
  fps?: number;
}

interface ResolvedFfmpegOptions {
  ffmpegPath: string;
  width: number;
  height: number;
  fps: number;
  totalFrames: number;
  crf: number;
  preset: string;
  pixelFormat: string;
  outputFormat: 'mp4' | 'mkv' | 'webm';
  overwrite: boolean;
  signal: AbortSignal | undefined;
  onProgress: ((progress: FfmpegRenderProgress) => void) | undefined;
  audioTracks: AudioTrackConfig[];
  audioSampleRate: number;
  background: string;
  keepTemporary: boolean;
}

function resolveOptions(raw: FfmpegRenderOptions): ResolvedFfmpegOptions {
  const fps = raw.fps;
  const audioTracks = raw.audioCues
    ? raw.audioCues.map((cue) => cueToAudioTrack(cue, fps))
    : [];

  return {
    ffmpegPath: raw.ffmpegPath ?? 'ffmpeg',
    width: raw.width,
    height: raw.height,
    fps,
    totalFrames: raw.totalFrames,
    crf: raw.crf ?? 18,
    preset: raw.preset ?? 'medium',
    pixelFormat: raw.pixelFormat ?? 'yuv420p',
    outputFormat: raw.outputFormat ?? 'mp4',
    overwrite: raw.overwrite ?? true,
    signal: raw.signal,
    onProgress: raw.onProgress,
    audioTracks,
    audioSampleRate: raw.audioSampleRate ?? 48000,
    background: raw.background ?? '#000000',
    keepTemporary: raw.keepTemporary ?? false,
  };
}

function extensionForFormat(format: string): string {
  switch (format) {
    case 'mkv': return '.mkv';
    case 'webm': return '.webm';
    default: return '.mp4';
  }
}

function createTemporaryOutput(output: string, ext: string): string {
  const dir = dirname(output);
  const stem = basename(output, extname(output));
  return join(dir, `.${stem}.${crypto.randomUUID()}.rendering${ext}`);
}

function buildFilterComplex(opts: ResolvedFfmpegOptions): string {
  const lines: string[] = [];

  lines.push(
    `[0:v]trim=end_frame=${opts.totalFrames},setpts=PTS-STARTPTS[canvas]`,
  );

  let currentLabel = 'canvas';

  if (opts.audioTracks.length > 0) {
    lines.push(
      `[1:a]atrim=end=${(opts.totalFrames / opts.fps).toFixed(6)},` +
      `asetpts=PTS-STARTPTS,aresample=${opts.audioSampleRate}[silence]`,
    );

    const audioLabels: string[] = ['[silence]'];

    for (let i = 0; i < opts.audioTracks.length; i++) {
      const track = opts.audioTracks[i];
      if (!track) continue;
      const filter = buildFfmpegAudioFilter(track, opts.fps);
      const label = `audio_${i}`;
      if (filter.length > 0) {
        lines.push(
          `[${i + 2}:a]${filter}[${label}]`,
        );
      } else {
        lines.push(
          `[${i + 2}:a]acopy[${label}]`,
        );
      }
      audioLabels.push(`[${label}]`);
    }

    const mixCount = audioLabels.length;
    lines.push(
      `${audioLabels.join('')}amix=inputs=${mixCount}:duration=longest:` +
      `dropout_transition=0:normalize=0,` +
      `atrim=end=${(opts.totalFrames / opts.fps).toFixed(6)},` +
      `asetpts=N/SR/TB[aout]`,
    );
  } else {
    lines.push(
      `[1:a]atrim=end=${(opts.totalFrames / opts.fps).toFixed(6)},` +
      `asetpts=PTS-STARTPTS[aout]`,
    );
  }

  lines.push(`[${currentLabel}]format=yuv420p[vout]`);

  return lines.join(';\n');
}

function buildFfmpegArgs(
  output: string,
  tempOutput: string,
  filterPath: string,
  opts: ResolvedFfmpegOptions,
): string[] {
  const args: string[] = [
    '-hide_banner',
    '-loglevel', 'warning',
    '-y',
    '-f', 'lavfi',
    '-i',
    `color=c=${opts.background}:s=${opts.width}x${opts.height}:r=${opts.fps},format=rgba`,
    '-f', 'lavfi',
    '-i',
    `anullsrc=r=${opts.audioSampleRate}:cl=stereo`,
  ];

  for (const track of opts.audioTracks) {
    args.push('-i', track.src);
  }

  args.push(
    '-filter_complex_script', filterPath,
    '-map', '[vout]',
    '-map', '[aout]',
    '-frames:v', String(opts.totalFrames),
    '-c:v', 'libx264',
    '-preset', opts.preset,
    '-crf', String(opts.crf),
    '-pix_fmt', opts.pixelFormat,
    '-color_primaries', 'bt709',
    '-color_trc', 'iec61966-2-1',
    '-colorspace', 'bt709',
    '-c:a', 'aac',
    '-ar', String(opts.audioSampleRate),
    '-map_metadata', '-1',
    '-movflags', '+faststart',
    '-progress', 'pipe:1',
    '-nostats',
    tempOutput,
  );

  return args;
}

function consumeProgress(
  stream: NodeJS.ReadableStream,
  totalFrames: number,
  onProgress?: (progress: FfmpegRenderProgress) => void,
): Promise<void> {
  return new Promise((resolve) => {
    let buffer = '';

    stream.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('frame=')) continue;
        const match = line.match(/frame=\s*(\d+)/);
        if (!match?.[1]) continue;
        const frame = Number(match[1]);
        if (!Number.isFinite(frame)) continue;

        onProgress?.({
          phase: 'encoding',
          frame,
          totalFrames,
          progress: Math.min(1, frame / Math.max(1, totalFrames)),
        });
      }
    });

    stream.on('end', resolve);
    stream.on('close', resolve);
  });
}

function consumeStderr(stream: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    stream.on('data', (chunk: Buffer) => {
      data += chunk.toString();
    });
    stream.on('end', () => resolve(data));
    stream.on('close', () => resolve(data));
  });
}

export async function renderWithFfmpeg(
  outputPath: string,
  frameSource: FrameSource,
  options: FfmpegRenderOptions,
): Promise<string> {
  const opts = resolveOptions(options);
  const ext = extensionForFormat(opts.outputFormat);
  const output = resolve(outputPath);

  if (opts.overwrite && existsSync(output)) {
    await rm(output, { force: true });
  } else if (existsSync(output)) {
    throw new Error(`Файл уже существует: ${output}`);
  }

  await mkdir(dirname(output), { recursive: true });

  const tempOutput = createTemporaryOutput(output, ext);
  const tempDir = dirname(tempOutput);
  const filterPath = join(tempDir, 'filter-complex.txt');

  const filterGraph = buildFilterComplex(opts);
  await writeFile(filterPath, filterGraph, 'utf8');

  const args = buildFfmpegArgs(output, tempOutput, filterPath, opts);

  logger.info('FFmpeg render: старт пайплайна', {
    output,
    width: opts.width,
    height: opts.height,
    fps: opts.fps,
    frames: opts.totalFrames,
    crf: opts.crf,
    preset: opts.preset,
    audioTracks: opts.audioTracks.length,
  });

  opts.onProgress?.({
    phase: 'starting',
    frame: 0,
    totalFrames: opts.totalFrames,
    progress: 0,
  });

  const proc = spawn(opts.ffmpegPath, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  if (!proc.stdin || !proc.stdout || !proc.stderr) {
    throw new Error('Не удалось запустить FFmpeg: stdin/stdout/stderr недоступны');
  }

  if (opts.signal) {
    opts.signal.addEventListener('abort', () => {
      proc.kill('SIGTERM');
    }, { once: true });
  }

  proc.stdin.on('error', () => {});

  const stderrPromise = consumeStderr(proc.stderr);
  const progressPromise = consumeProgress(
    proc.stdout,
    opts.totalFrames,
    opts.onProgress,
  );

  const exitPromise = new Promise<number>((resolve, reject) => {
    proc.on('error', reject);
    proc.on('close', (code) => resolve(code ?? 1));
  });

  await frameSource.pipe(proc.stdin);

  if (!proc.stdin.destroyed) {
    proc.stdin.end();
  }

  const [exitCode, stderr] = await Promise.all([exitPromise, stderrPromise]);
  await progressPromise;

  if (exitCode !== 0) {
    if (existsSync(tempOutput)) {
      await rm(tempOutput, { force: true }).catch(() => {});
    }
    throw new Error(
      `FFmpeg завершился с кодом ${exitCode}:\n${stderr.trim().slice(-4000)}`,
    );
  }

  if (!existsSync(tempOutput)) {
    throw new Error('FFmpeg завершился успешно, но файл не создан');
  }

  await rename(tempOutput, output);

  if (!opts.keepTemporary) {
    await rm(filterPath, { force: true }).catch(() => {});
  }

  opts.onProgress?.({
    phase: 'done',
    frame: opts.totalFrames,
    totalFrames: opts.totalFrames,
    progress: 1,
  });

  logger.info('FFmpeg render: завершено', { output });

  return output;
}

export interface FrameSource {
  pipe(writable: NodeJS.WritableStream): Promise<void>;
}

export class RawRgbaFrameSource implements FrameSource {
  private readonly generateFrame: (frame: number) => Promise<Uint8Array>;
  private readonly totalFrames: number;

  constructor(options: {
    generateFrame: (frame: number) => Promise<Uint8Array>;
    width: number;
    height: number;
    totalFrames: number;
  }) {
    this.generateFrame = options.generateFrame;
    this.totalFrames = options.totalFrames;
  }

  async pipe(writable: NodeJS.WritableStream): Promise<void> {
    for (let frame = 0; frame < this.totalFrames; frame++) {
      const rgba = await this.generateFrame(frame);
      const ok = writable.write(Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength));
      if (!ok) {
        await new Promise<void>((resolve) => {
          writable.once('drain', resolve);
        });
      }
    }
  }
}

export class PipeFrameSource implements FrameSource {
  private readonly read: (writable: NodeJS.WritableStream) => Promise<void>;

  constructor(read: (writable: NodeJS.WritableStream) => Promise<void>) {
    this.read = read;
  }

  async pipe(writable: NodeJS.WritableStream): Promise<void> {
    return this.read(writable);
  }
}

export function toEvenFrameSize(value: number): number {
  return Math.max(2, value - (value % 2));
}

export interface BRollLayerConfig {
  src: string;
  startFrame: number;
  totalFrames: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  opacity?: number;
}

export type FfmpegVideoPipeFrameFormat = 'rgba' | 'png';

export interface FfmpegVideoPipeOptions {
  outputPath: string;
  width: number;
  height: number;
  fps: number;
  totalFrames: number;
  crf?: number;
  preset?: string;
  pixelFormat?: string;
  ffmpegPath?: string;
  frameFormat?: FfmpegVideoPipeFrameFormat;
  audioSampleRate?: number;
  onProgress?: (frame: number, totalFrames: number, currentFps: number) => void;
  signal?: AbortSignal;
}

interface PipeProgress {
  frame: number;
  framesTotal: number;
  fps: number;
}

function consumePipeProgress(
  stream: NodeJS.ReadableStream,
  progress: PipeProgress,
  onProgress?: (frame: number, totalFrames: number, currentFps: number) => void,
): void {
  let buffer = '';
  stream.on('data', (chunk: Buffer) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line.startsWith('frame=')) {
        const frame = Number(line.slice('frame='.length).trim());
        if (Number.isFinite(frame)) progress.frame = frame;
      } else if (line.startsWith('fps=')) {
        const fps = Number(line.slice('fps='.length).trim());
        if (Number.isFinite(fps)) progress.fps = fps;
        onProgress?.(progress.frame, progress.framesTotal, fps);
      }
    }
  });
}

export class FfmpegVideoPipe {
  private readonly options: Required<
    Pick<
      FfmpegVideoPipeOptions,
      'height' | 'fps' | 'totalFrames'
    >
  > &
    FfmpegVideoPipeOptions & {
      crf: number;
      preset: string;
      pixelFormat: string;
      ffmpegPath: string;
      frameFormat: FfmpegVideoPipeFrameFormat;
      audioSampleRate: number;
    };

  private proc: ReturnType<typeof spawn> | null = null;
  private writeCount = 0;
  private startedAt = 0;
  private finishPromise: Promise<void> | null = null;
  private stderrText = '';

  constructor(options: FfmpegVideoPipeOptions) {
    this.options = {
      ...options,
      crf: options.crf ?? 18,
      preset: options.preset ?? 'medium',
      pixelFormat: options.pixelFormat ?? 'yuv420p',
      ffmpegPath: options.ffmpegPath ?? 'ffmpeg',
      frameFormat: options.frameFormat ?? 'rgba',
      audioSampleRate: options.audioSampleRate ?? 48000,
    };
  }

  get framesWritten(): number {
    return this.writeCount;
  }

  private buildArgs(output: string): string[] {
    const { width, height, fps, audioSampleRate } = this.options;
    const totalSeconds = (this.options.totalFrames / fps).toFixed(6);

    const args: string[] = [
      '-hide_banner',
      '-loglevel', 'warning',
      '-y',
    ];

    if (this.options.frameFormat === 'png') {
      args.push(
        '-framerate', String(fps),
        '-f', 'image2pipe',
        '-c:v', 'png',
        '-i', 'pipe:0',
      );
    } else {
      args.push(
        '-f', 'rawvideo',
        '-pix_fmt', 'rgba',
        '-s', `${width}x${height}`,
        '-r', String(fps),
        '-i', 'pipe:0',
      );
    }

    args.push(
      '-f', 'lavfi',
      '-i', `anullsrc=r=${audioSampleRate}:cl=stereo`,
      '-map', '0:v',
      '-map', '1:a',
      '-c:v', 'libx264',
      '-preset', this.options.preset,
      '-crf', String(this.options.crf),
      '-pix_fmt', this.options.pixelFormat,
      '-color_primaries', 'bt709',
      '-color_trc', 'iec61966-2-1',
      '-colorspace', 'bt709',
      '-c:a', 'aac',
      '-ar', String(audioSampleRate),
      '-map_metadata', '-1',
      '-movflags', '+faststart',
      '-t', totalSeconds,
      '-progress', 'pipe:1',
      '-nostats',
      output,
    );

    return args;
  }

  start(): Promise<void> {
    if (this.proc) throw new Error('FFmpeg pipe уже запущен.');

    const output = resolve(this.options.outputPath);
    const args = this.buildArgs(output);

    logger.info('FfmpegVideoPipe: старт', {
      output,
      width: this.options.width,
      height: this.options.height,
      fps: this.options.fps,
      frames: this.options.totalFrames,
      crf: this.options.crf,
      preset: this.options.preset,
      frameFormat: this.options.frameFormat,
    });

    const proc = spawn(this.options.ffmpegPath, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    if (!proc.stdin || !proc.stdout || !proc.stderr) {
      throw new Error('Не удалось запустить FFmpeg: stdin/stdout/stderr недоступны');
    }

    this.proc = proc;
    this.startedAt = performance.now();
    this.writeCount = 0;

    proc.stdin.on('error', () => {});

    proc.stderr.on('data', (chunk: Buffer) => {
      this.stderrText += chunk.toString();
    });

    const progress: PipeProgress = {
      frame: 0,
      framesTotal: this.options.totalFrames,
      fps: 0,
    };

    consumePipeProgress(proc.stdout, progress, this.options.onProgress);

    if (this.options.signal) {
      this.options.signal.addEventListener('abort', () => {
        proc.kill('SIGTERM');
      }, { once: true });
    }

    return Promise.resolve();
  }

  writeFrame(frame: Uint8Array): Promise<void> {
    const proc = this.proc;
    if (!proc?.stdin) throw new Error('FFmpeg pipe не запущен (start()).');

    if (this.options.frameFormat === 'rgba') {
      const expected = this.options.width * this.options.height * 4;
      if (frame.byteLength !== expected) {
        throw new Error(
          `Кадр RGBA неверного размера: ${frame.byteLength} байт, ожидалось ${expected}`,
        );
      }
    }

    const ok = proc.stdin.write(
      Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength),
    );

    this.writeCount++;

    if (ok) return Promise.resolve();

    return new Promise<void>((resolve) => {
      proc.stdin?.once('drain', () => resolve());
    });
  }

  finish(): Promise<void> {
    if (this.finishPromise) return this.finishPromise;

    const proc = this.proc;
    if (!proc) throw new Error('FFmpeg pipe не запущен (start()).');

    this.finishPromise = new Promise<void>((resolvePromise, rejectPromise) => {
      const cleanup = () => {
        proc.removeListener('close', onClose);
        proc.removeListener('error', onError);
      };
      const onClose = (code: number | null) => {
        cleanup();
        if (code !== 0) {
          rejectPromise(
            new Error(
              `FFmpeg завершился с кодом ${code}:\n${this.stderrText.trim().slice(-4000)}`,
            ),
          );
          return;
        }
        const output = resolve(this.options.outputPath);
        if (!existsSync(output)) {
          rejectPromise(new Error('FFmpeg завершился успешно, но файл не создан'));
          return;
        }
        const elapsedSec = (performance.now() - this.startedAt) / 1000 || 1;
        console.log(
          `[FfmpegVideoPipe] готово: ${output} ` +
          `(${this.writeCount} кадров, ${elapsedSec.toFixed(2)}s)`,
        );
        resolvePromise();
      };
      const onError = (error: Error) => {
        cleanup();
        rejectPromise(error);
      };

      proc.on('close', onClose);
      proc.on('error', onError);

      if (!proc.stdin?.destroyed) {
        proc.stdin?.end();
      } else {
        onClose(proc.exitCode ?? 1);
      }
    });

    return this.finishPromise;
  }
}
