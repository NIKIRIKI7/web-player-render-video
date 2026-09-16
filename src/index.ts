export { SandboxFacade } from './facade';
export type { SandboxFacadeOptions } from './facade';

export { useLiveSandbox } from './react/useLiveSandbox';
export type {
  UseLiveSandboxOptions,
  UseLiveSandboxResult,
  CompiledComponentInfo,
} from './react/useLiveSandbox';
export { Sandbox } from './react/Sandbox';
export type {
  SandboxConfig,
  SandboxProps,
  SandboxRenderContext,
  SandboxErrorContext,
} from './react/Sandbox';
export { SandboxErrorBoundary } from './react/ErrorBoundary';
export type { SandboxErrorBoundaryProps } from './react/ErrorBoundary';

export { ModuleCache } from './library-manager/cache';
export { loadMissingModules, defaultCdnResolver, defaultImporter } from './library-manager/loader';
export type { ModuleImporter, LoadModulesOptions } from './library-manager/loader';

export { diffFiles, buildImportsGraph, getDependents } from './core/hmr';
export {
  diffFilesWithHashes,
  buildDependencyGraph,
  getAffectedDependents,
} from './core/hmr';
export type { HmrChanges, DependencyGraph } from './core/hmr';

export {
  createTailwindPlugin,
  collectTailwindClasses,
  extractClassNamesFromSource,
  scopedTailwindCss,
  scopeCss,
  TAILWIND_VIRTUAL_MODULE,
} from './plugins/tailwind-plugin';
export type { TailwindJitPluginOptions } from './plugins/tailwind-plugin';

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

export { extractBareImports, scanImports, resolveVfsPath, stripComments } from './compiler/analyzer';
export type { ScanResult } from './compiler/analyzer';
export {
  resolveVirtualPath,
  normalizeCanonicalPath,
  getDirname,
  DEFAULT_EXTENSIONS,
} from './compiler/path';
export { compileTsx, SucraseCompilerAdapter, cleanMarkdownFences } from './compiler/transform';
export { injectLoopProtection } from './compiler/loop-protect';
export { getSandboxTypeDefinitions } from './compiler/types-helper';

export { executeComponent } from './sandbox/evaluator';
export type { EvaluatorContext } from './sandbox/evaluator';
export { createSandboxMembrane, getShadowedGlobals, FORBIDDEN_GLOBALS } from './sandbox/scope';

export { ChunkJoiner } from './core/joiner';
export { CancellationToken, RenderResourceManager } from './core/lifecycle';
export { PluginPipeline } from './core/plugin';
export type {
  SandboxPlugin,
  PluginBuild,
  OnResolveArgs,
  OnResolveResult,
  OnLoadArgs,
  OnLoadResult,
  ResolvedModuleData,
} from './core/plugin';
export { RawSourceMapConsumer, LineColumnTracker, remapStackTrace } from './core/diagnostics';

export { WorkerCompilerAdapter, createCompilerWorker } from './worker/WorkerCompilerAdapter';

export { createRemotionWatchdog } from './sandbox/watchdog';
export type { WatchdogResult, WatchdogHandleInfo } from './sandbox/watchdog';
export { cleanupCanvasWebGl } from './sandbox/webgl-guard';
export { takeContainerSnapshot } from './sandbox/snapshot';
export type { SnapshotOptions } from './sandbox/snapshot';
export { SafeZonesOverlay } from './react/guides/SafeZonesOverlay';
export type { SafeZonesOverlayProps, SafeZonePreset } from './react/guides/SafeZonesOverlay';
export { configureLogger } from './core/logger';
export { extractSceneMetadata } from './core/scene-metadata';
export type { SceneMetadata } from './core/scene-metadata';
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

export { extractAssetZip, createAssetUrlMap, releaseAssetUrls } from './assets/zip';
export type { AssetArchive } from './assets/zip';

export {
  useActiveCues,
  SFXLayer,
  MusicLayer,
  TrackLayer,
} from './timeline/index';
export type {
  Cue,
  AudioPayload,
  SFXPayload,
  SFXLayerProps,
  MusicLayerProps,
  TrackLayerProps,
} from './timeline/index';

export * from './core/types';
export * from './core/errors';
