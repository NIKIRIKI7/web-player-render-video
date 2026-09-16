/**
 * Скрипт барьера синхронизации B-Roll кадров для выполнения внутри Chromium.
 * Инжектируется в страницу и перехватывает все теги <video>, запрещая им
 * самовольно проигрываться и гарантируя, что каждый видеокадр физически
 * декодирован перед тем, как браузер отдаст скриншот.
 */
export const BROLL_SYNC_INJECT_SCRIPT = `
(function() {
  window.__brollWaitSync = async function(expectedFrame, fps) {
    const expectedTime = expectedFrame / fps;
    const videos = Array.from(document.querySelectorAll('video'));
    if (videos.length === 0) return true;

    const waitPromises = videos.map(video => {
      return new Promise((resolve) => {
        // Запрещаем тегу видео крутиться в реальном времени
        video.pause();

        // Проверяем готовность буфера
        const checkReady = () => {
          // Если видео готово к отрисовке текущего кадра
          if ('requestVideoFrameCallback' in video) {
            video.requestVideoFrameCallback(() => {
              resolve(true);
            });
          } else {
            // Фолбэк через двойной RAF для гарантии отрисовки в буфер композитора
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                resolve(true);
              });
            });
          }
        };

        if (video.readyState >= 2 && !video.seeking) {
          checkReady();
        } else {
          let timeoutId;
          const onSeeked = () => {
            clearTimeout(timeoutId);
            video.removeEventListener('seeked', onSeeked);
            video.removeEventListener('canplay', onSeeked);
            checkReady();
          };

          video.addEventListener('seeked', onSeeked, { once: true });
          video.addEventListener('canplay', onSeeked, { once: true });

          // Защита от зависания битого медиа-файла (максимум 400 мс)
          timeoutId = setTimeout(() => {
            video.removeEventListener('seeked', onSeeked);
            video.removeEventListener('canplay', onSeeked);
            resolve(false);
          }, 400);
        }
      });
    });

    await Promise.all(waitPromises);
    return true;
  };
})();
`;