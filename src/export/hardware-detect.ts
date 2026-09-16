import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { logger } from '../core/logger';

export interface HardwareProfile {
  cpuModel: string;
  logicalCores: number;
  totalMemoryGb: number;
  availableConcurrency: number;
  selectedCodec: 'h264_nvenc' | 'h264_videotoolbox' | 'h264_qsv' | 'libx264';
  preset: string;
  recommendedCrf: number;
  extraFfmpegFlags: string[];
}

let cachedProfile: HardwareProfile | null = null;

function validateEncoder(
  ffmpegPath: string,
  codec: HardwareProfile['selectedCodec'],
  preset: string,
  extraFfmpegFlags: string[]
): boolean {
  const isHardware = codec !== 'libx264';
  const args = [
    '-hide_banner',
    '-loglevel', 'error',
    '-y',
    '-f', 'lavfi',
    '-i', 'color=c=black:s=320x180:d=0.2',
    '-frames:v', '1',
    '-c:v', codec,
    '-preset', preset,
    ...extraFfmpegFlags,
    ...(isHardware ? ['-b:v', '2000k', '-maxrate', '4000k', '-bufsize', '8000k'] : []),
    '-f', 'null',
    '-',
  ];
  const res = spawnSync(ffmpegPath, args, { encoding: 'utf8' });
  return res.status === 0;
}

export function detectHardwareAndProfile(
  targetWidth = 1920,
  targetHeight = 1080,
  ffmpegPath = 'ffmpeg'
): HardwareProfile {
  if (cachedProfile) return cachedProfile;

  const logicalCores = os.cpus().length || 4;
  const totalMemoryGb = Math.round(os.totalmem() / (1024 * 1024 * 1024));
  const cpuModel = os.cpus()[0]?.model || 'Unknown CPU';

  let availableEncoders = '';
  try {
    const res = spawnSync(ffmpegPath, ['-hide_banner', '-encoders'], {
      encoding: 'utf8',
    });
    availableEncoders = res.stdout || '';
  } catch {
    logger.warn('Не удалось вызвать ffmpeg для проверки энкодеров, используется libx264');
  }

  const candidates: Array<{
    codec: HardwareProfile['selectedCodec'];
    preset: string;
    extraFfmpegFlags: string[];
  }> = [];

  const isWindows = process.platform === 'win32';
  const isMac = process.platform === 'darwin';
  const isLinux = process.platform === 'linux';

  if (availableEncoders.includes('h264_nvenc') && (isWindows || isLinux)) {
    candidates.push({
      codec: 'h264_nvenc',
      preset: 'p4',
      extraFfmpegFlags: ['-tune', 'hq', '-rc:v', 'vbr'],
    });
  }
  if (availableEncoders.includes('h264_videotoolbox') && isMac) {
    candidates.push({
      codec: 'h264_videotoolbox',
      preset: 'fast',
      extraFfmpegFlags: ['-realtime', 'false'],
    });
  }
  if (availableEncoders.includes('h264_qsv')) {
    candidates.push({
      codec: 'h264_qsv',
      preset: 'veryfast',
      extraFfmpegFlags: [],
    });
  }

  let selected: { codec: HardwareProfile['selectedCodec']; preset: string; extraFfmpegFlags: string[] } | null =
    candidates.find((c) => validateEncoder(ffmpegPath, c.codec, c.preset, c.extraFfmpegFlags)) ?? null;

  if (!selected) {
    const preset = logicalCores >= 8 ? 'fast' : 'veryfast';
    selected = {
      codec: 'libx264',
      preset,
      extraFfmpegFlags: ['-threads', String(Math.min(logicalCores, 16))],
    };
    if (candidates.length > 0) {
      logger.warn(
        `Аппаратный энкодер не прошёл проверочное кодирование, фолбэк на ${selected.codec}`
      );
    }
  }

  const is4K = targetWidth >= 3840 || targetHeight >= 2160;
  const ramPerWorkerGb = is4K ? 2.0 : 0.8;
  const maxWorkersByRam = Math.max(1, Math.floor((totalMemoryGb * 0.7) / ramPerWorkerGb));
  const maxWorkersByCpu = Math.max(1, Math.floor(logicalCores * 0.75));

  const availableConcurrency = Math.min(maxWorkersByCpu, maxWorkersByRam, is4K ? 4 : 8);

  const cachedProfileResult: HardwareProfile = {
    cpuModel,
    logicalCores,
    totalMemoryGb,
    availableConcurrency,
    selectedCodec: selected.codec,
    preset: selected.preset,
    recommendedCrf: selected.codec === 'libx264' ? 18 : 20,
    extraFfmpegFlags: selected.extraFfmpegFlags,
  };

  cachedProfile = cachedProfileResult;

  logger.info('Автоопределение железа завершено:', cachedProfileResult);
  return cachedProfileResult;
}

export function resetHardwareProfileCache(): void {
  cachedProfile = null;
}