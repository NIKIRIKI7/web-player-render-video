import { spawn, ChildProcess } from 'node:child_process';
import path from 'node:path';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { detectHardwareAndProfile, HardwareProfile } from './hardware-detect';
import { logger } from '../core/logger';

export interface SmartPipelineOptions {
  outputPath: string;
  width: number;
  height: number;
  fps: number;
  totalFrames: number;
  hardwareProfile?: HardwareProfile;
  onProgress?: (frame: number, total: number, fps: number) => void;
}

export class FfmpegSmartPipe {
  private process: ChildProcess | null = null;
  private framesWritten = 0;
  private startTime = 0;
  private profile: HardwareProfile;

  constructor(private readonly options: SmartPipelineOptions) {
    this.profile =
      options.hardwareProfile ||
      detectHardwareAndProfile(options.width, options.height);
  }

  public async start(): Promise<void> {
    const { outputPath, width, height, fps, totalFrames } = this.options;
    const outDir = path.dirname(path.resolve(outputPath));
    if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

    const args: string[] = [
      '-hide_banner',
      '-loglevel', 'error',
      '-y',
      // Входной поток из Chromium: mjpeg pipe
      '-f', 'image2pipe',
      '-vcodec', 'mjpeg',
      '-r', String(fps),
      '-i', 'pipe:0',

      // Жесткий контроль таймингов (устраняет дёргание и пропуски кадров)
      '-fps_mode', 'cfr',
      '-c:v', this.profile.selectedCodec,
      '-preset', this.profile.preset,
      ...this.profile.extraFfmpegFlags,

      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-frames:v', String(totalFrames),
      outputPath,
    ];

    if (this.profile.selectedCodec === 'libx264') {
      args.splice(args.indexOf('-c:v') + 2, 0, '-crf', String(this.profile.recommendedCrf));
    }

    logger.info('Запуск FFmpeg Smart Pipe:', {
      codec: this.profile.selectedCodec,
      preset: this.profile.preset,
      outputPath,
      width,
      height,
      fps,
      totalFrames,
    });

    this.startTime = performance.now();
    this.process = spawn('ffmpeg', args, { stdio: ['pipe', 'inherit', 'pipe'] });

    this.process.stderr?.on('data', (buf) => {
      const msg = buf.toString();
      if (msg.includes('Error') || msg.includes('error')) {
        logger.error('[FFmpeg stderr]:', msg);
      }
    });
  }

  public async writeFrame(jpegBuffer: Uint8Array): Promise<void> {
    if (!this.process?.stdin) throw new Error('FFmpeg stdin не инициализирован');

    const ok = this.process.stdin.write(jpegBuffer);
    this.framesWritten++;

    if (!ok) {
      await new Promise<void>((resolve) => this.process!.stdin!.once('drain', resolve));
    }

    if (
      this.options.onProgress &&
      (this.framesWritten % 15 === 0 || this.framesWritten === this.options.totalFrames)
    ) {
      const elapsedSec = (performance.now() - this.startTime) / 1000;
      const currentFps = this.framesWritten / (elapsedSec || 0.001);
      this.options.onProgress(this.framesWritten, this.options.totalFrames, currentFps);
    }
  }

  public async finish(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.process) return resolve();
      const proc = this.process;
      const stdin = proc.stdin;
      if (!stdin) {
        reject(new Error('FFmpeg stdin не инициализирован'));
        return;
      }

      stdin.end();

      proc.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`FFmpeg завершился с кодом ошибки: ${code}`));
        }
      });
    });
  }

  public static async concatSegments(
    segmentPaths: string[],
    finalOutputPath: string
  ): Promise<void> {
    const outDir = path.dirname(path.resolve(finalOutputPath));
    if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

    const listFile = path.join(outDir, `concat_${Date.now()}.txt`);
    const fileContent = segmentPaths
      .map((p) => {
        // На Windows конкат-демультиплексор некорректно парсит слэши и пробелы
        const normalized = path.resolve(p).replace(/\\/g, '/');
        return `file '${normalized}'`;
      })
      .join('\n');
    writeFileSync(listFile, fileContent, 'utf8');

    return new Promise((resolve, reject) => {
      const p = spawn(
        'ffmpeg',
        [
          '-hide_banner',
          '-loglevel', 'error',
          '-y',
          '-f', 'concat',
          '-safe', '0',
          '-i', listFile,
          '-c', 'copy',
          finalOutputPath,
        ],
        { stdio: 'inherit' }
      );

      p.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Склейка сегментов завершилась с ошибкой: ${code}`));
      });
    });
  }
}