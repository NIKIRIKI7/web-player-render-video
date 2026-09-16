import { takeContainerSnapshot } from '../sandbox/snapshot';
import type { SnapshotOptions } from '../sandbox/snapshot';

/**
 * Принудительно синхронизирует все теги <video> на странице с точным временем кадра.
 * Гарантирует, что видеокарта декодировала именно тот кадр, который нужен,
 * исключая повторы и рывки B-Roll.
 *
 * Цикл: pause → requestVideoFrameCallback → resolving.
 */
async function syncVideosToFrame(
  container: HTMLElement,
  currentFrame: number,
  fps: number,
): Promise<void> {
  const videos = Array.from(container.querySelectorAll('video'));
  if (videos.length === 0) return;

  const syncPromises = videos.map((video) => {
    return new Promise<void>((resolve) => {
      video.pause();

      const targetTime = currentFrame / fps;

      if (Math.abs(video.currentTime - targetTime) < 0.001 && video.readyState >= 2) {
        resolve();
        return;
      }

      const videoEl = video as HTMLVideoElement;
      let timeoutId: ReturnType<typeof setTimeout>;

      const onFrameDecoded = () => {
        clearTimeout(timeoutId);
        resolve();
      };

      const supportsRvf =
        typeof (videoEl as { requestVideoFrameCallback?: unknown }).requestVideoFrameCallback ===
        'function';

      if (supportsRvf) {
        (videoEl as { requestVideoFrameCallback: (cb: () => void) => number }).requestVideoFrameCallback(
          () => {
            onFrameDecoded();
          },
        );
      } else {
        // HTMLVideoElement уже содержит rVFC в типизации, но в рантайме браузер
        // без его поддержки (старый Safari) попадает в эту ветку.
        videoEl.addEventListener('seeked', () => {
          requestAnimationFrame(() => onFrameDecoded());
        }, { once: true });
      }

      try {
        videoEl.currentTime = targetTime;
      } catch {
        resolve();
      }

      timeoutId = setTimeout(onFrameDecoded, 120);
    });
  });

  await Promise.all(syncPromises);
}

/**
 * Детерминированный тик: Пауза → Синхронизация B-Roll → Отрисовка → Снимок.
 *
 * Гарантирует, что каждый кадр уникален и соответствует ровно одному моменту таймлайна.
 */
export async function stepDeterministicTick(
  container: HTMLElement,
  frame: number,
  fps: number,
  width: number,
  height: number,
  seekTo: (frame: number) => void,
  snapshotOptions?: SnapshotOptions,
): Promise<Blob> {
  seekTo(frame);

  await syncVideosToFrame(container, frame, fps);

  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });

  const dataUrl = await takeContainerSnapshot(container, {
    format: 'image/jpeg',
    quality: 0.92,
    targetWidth: width,
    targetHeight: height,
    ...snapshotOptions,
  });

  const res = await fetch(dataUrl);
  return await res.blob();
}
