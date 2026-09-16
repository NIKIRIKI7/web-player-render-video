export { PlayerSandbox } from './react/PlayerSandbox';
export type {
  PlayerSandboxConfig,
  PlayerSandboxProps,
  PlayerSandboxRef,
  CanvasControlsConfig,
} from './react/PlayerSandbox';

export { SafeZonesOverlay } from './react/guides/SafeZonesOverlay';
export type { SafeZonesOverlayProps, SafeZonePreset } from './react/guides/SafeZonesOverlay';

export { PlayerContext, usePlayerContext } from './react/headless/PlayerContext';
export type {
  PlayerContextValue,
  ExportState,
  ExportVideoOptions,
} from './react/headless/PlayerContext';
export {
  PlayPauseButton,
  TimeDisplay,
  TimelineBar,
  VolumeControl,
  ExportButton,
} from './react/headless/Primitives';
export type {
  PlayPauseButtonProps,
  PlayPauseButtonRenderProps,
  TimeDisplayProps,
  TimeDisplayRenderProps,
  TimelineBarProps,
  TimelineBarRenderProps,
  VolumeControlProps,
  VolumeControlRenderProps,
  ExportButtonProps,
  ExportButtonRenderProps,
} from './react/headless/Primitives';

export {
  exportBrowserVideo,
  downloadExportBlob,
  supportsBrowserExport,
  calculateBitrate,
} from './export/browser-export';
export type {
  BrowserExportOptions,
  BrowserExportCodec,
  ExportProgress,
  ExportQuality,
} from './export/browser-export';

export { exportViaFfmpegBackend } from './export/client-ffmpeg-export';
export type { ClientFfmpegExportOptions } from './export/client-ffmpeg-export';

export { configureLogger } from './core/logger';
export { extractSceneMetadata } from './core/scene-metadata';
export type { SceneMetadata } from './core/scene-metadata';

export { takeContainerSnapshot } from './sandbox/snapshot';
export type { SnapshotOptions } from './sandbox/snapshot';
export { createRemotionWatchdog } from './sandbox/watchdog';
export type { WatchdogResult, WatchdogHandleInfo } from './sandbox/watchdog';
export { cleanupCanvasWebGl } from './sandbox/webgl-guard';
