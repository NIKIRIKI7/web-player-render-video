export {
  renderWithFfmpeg,
  RawRgbaFrameSource,
  PipeFrameSource,
  toEvenFrameSize,
  FfmpegVideoPipe,
} from './export/ffmpeg-renderer';
export type {
  FfmpegRenderOptions,
  FfmpegRenderProgress,
  FrameSource,
  FfmpegVideoPipeOptions,
  FfmpegVideoPipeFrameFormat,
  BRollLayerConfig,
} from './export/ffmpeg-renderer';

export { detectHardwareAndProfile, resetHardwareProfileCache } from './export/hardware-detect';
export type { HardwareProfile } from './export/hardware-detect';

export { BROLL_SYNC_INJECT_SCRIPT } from './export/broll-sync';

export { FfmpegSmartPipe } from './export/ffmpeg-smart-pipeline';
export type { SmartPipelineOptions } from './export/ffmpeg-smart-pipeline';

export { executeSmartRender } from './export/smart-render-engine';
export type { SmartRenderJobOptions } from './export/smart-render-engine';

export {
  cueToAudioTrack,
  cuesToAudioTracks,
  convertCuesToFfmpegAudio,
  addDuckingToTrack,
  buildFfmpegAudioFilter,
} from './export/cue-to-ffmpeg';
export type { AudioTrackConfig, ConvertedAudioTracks } from './export/cue-to-ffmpeg';

export {
  normalizeMediaPath,
  normalizeMediaPaths,
  assertMediaExists,
  resolveMediaForFfmpeg,
  createUniversalMediaResolver,
} from './compiler/media-normalizer';
export type { NormalizedMedia } from './compiler/media-normalizer';

export {
  runBenchmark,
  createBenchmarkConfig,
  formatBenchmarkReport,
} from './benchmark/benchmark';
export type {
  BenchmarkConfig,
  BenchmarkMeasurement,
  BenchmarkSummary,
  BenchmarkReport,
  BenchmarkMetrics,
} from './benchmark/benchmark';