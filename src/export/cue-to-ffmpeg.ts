import type { Cue, AudioPayload } from '../timeline/index';

export interface AudioTrackConfig {
  src: string;
  startFrame: number;
  durationInFrames?: number;
  volume: number;
  playbackRate?: number;
  ducking?: {
    targetVolume: number;
    attackFrames: number;
    releaseFrames: number;
  };
}

export interface ConvertedAudioTracks {
  tracks: AudioTrackConfig[];
  totalDurationFrames: number;
  fps: number;
}

function resolveVolume(payload: AudioPayload): number {
  return payload.volume ?? 1.0;
}

function resolvePlaybackRate(payload: AudioPayload): number | undefined {
  return payload.playbackRate !== undefined && payload.playbackRate !== 1
    ? payload.playbackRate
    : undefined;
}

export function cueToAudioTrack(
  cue: Cue<AudioPayload>,
  fps: number,
): AudioTrackConfig {
  return {
    src: cue.payload.src,
    startFrame: cue.startFrame,
    durationInFrames: cue.durationInFrames,
    volume: resolveVolume(cue.payload),
    playbackRate: resolvePlaybackRate(cue.payload),
  };
}

export function cuesToAudioTracks(
  cues: ReadonlyArray<Cue<AudioPayload>>,
  fps: number,
): ConvertedAudioTracks {
  const tracks = cues.map((cue) => cueToAudioTrack(cue, fps));

  let maxEnd = 0;
  for (const cue of cues) {
    const end = cue.startFrame + (cue.durationInFrames ?? 0);
    if (end > maxEnd) maxEnd = end;
  }

  return {
    tracks,
    totalDurationFrames: maxEnd,
    fps,
  };
}

export function addDuckingToTrack(
  track: AudioTrackConfig,
  ducking: NonNullable<AudioTrackConfig['ducking']>,
): AudioTrackConfig {
  return { ...track, ducking };
}

export function buildFfmpegAudioFilter(track: AudioTrackConfig, fps: number): string {
  const filters: string[] = [];
  const delayMs = Math.round((track.startFrame / fps) * 1000);

  if (track.volume !== 1.0) {
    filters.push(`volume=${track.volume}`);
  }

  if (track.playbackRate !== undefined && track.playbackRate !== 1.0) {
    const rate = track.playbackRate;
    if (rate > 2.0) {
      filters.push(`atempo=${rate}`);
    } else {
      filters.push(`atempo=${rate}`);
    }
  }

  if (track.durationInFrames !== undefined) {
    const durSec = track.durationInFrames / fps;
    filters.push(`atrim=end=${durSec.toFixed(6)}`);
    filters.push('asetpts=PTS-STARTPTS');
  }

  if (delayMs > 0) {
    filters.push(`adelay=delays=${delayMs}|${delayMs}`);
  }

  return filters.join(',');
}

export const convertCuesToFfmpegAudio = cuesToAudioTracks;
