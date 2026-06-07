// frontend/public/sw.js
// 서비스 워커: 백그라운드 푸시 알림 수신 및 알림 클릭 핸들링 + 백그라운드 타이머 관리

let timerId = null;

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data) return;

  if (data.type === 'START_TIMER') {
    // 기존 서비스 워커 내 타이머가 있다면 정리
    if (timerId) {
      clearTimeout(timerId);
      timerId = null;
    }

    const { label, endMs } = data;
    const delay = Math.max(0, endMs - Date.now());

    timerId = setTimeout(() => {
      // 타이머 완료 시 푸시 알림 발송
      self.registration.showNotification('대기 완료', {
        body: label || '타이머가 완료되었습니다.',
        tag: 'onstep-timer',
        requireInteraction: true,
        vibrate: [300, 100, 300, 100, 400],
        renotify: true
      });
      timerId = null;
    }, delay);
  }

  if (data.type === 'STOP_TIMER') {
    if (timerId) {
      clearTimeout(timerId);
      timerId = null;
    }
  }
});

// 사용자가 알림 배너를 탭(클릭)했을 때의 동작 정의
self.addEventListener('notificationclick', (event) => {
  event.notification.close(); // 알림 팝업창을 닫습니다.

  // 이미 열려 있는 탭이 있다면 포커스하고, 없으면 새로 앱을 엽니다.
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow('/');
      }
    })
  );
});
