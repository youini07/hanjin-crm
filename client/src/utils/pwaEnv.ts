/**
 * client/src/utils/pwaEnv.ts
 * 모바일 기기·인앱 브라우저 감지 및 외부 브라우저 실행 유틸리티
 *
 * 왜 별도 파일로 분리했는가:
 * 컴포넌트 파일(PwaInstallModal.tsx)과 순수 유틸 함수를 분리하여
 * Vite Fast Refresh 규칙을 준수하고 여러 화면에서 재사용하기 위함.
 */

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

/**
 * 현재 접속 브라우저 환경 감지 헬퍼
 */
export function detectMobileBrowserEnv() {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const isKakaoInApp = /KAKAOTALK/i.test(ua);
  const isOtherInApp = /NAVER|Instagram|FBAN|FBAV|Line/i.test(ua);
  const isIOS =
    /iPad|iPhone|iPod/.test(ua) ||
    (typeof navigator !== 'undefined' &&
      navigator.platform === 'MacIntel' &&
      navigator.maxTouchPoints > 1);
  const isAndroid = /Android/i.test(ua);
  const isStandalone =
    typeof window !== 'undefined' &&
    (window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true);

  return {
    isKakaoInApp,
    isInApp: isKakaoInApp || isOtherInApp,
    isIOS,
    isAndroid,
    isStandalone,
  };
}

/**
 * 카카오톡 인앱 브라우저 등에서 외부 기본 브라우저(Safari / Chrome)로 즉시 탈출
 */
export function openInExternalBrowser() {
  const currentUrl = window.location.href;
  const env = detectMobileBrowserEnv();

  if (env.isKakaoInApp) {
    window.location.href = `kakaotalk://web/openExternal?url=${encodeURIComponent(currentUrl)}`;
    return;
  }

  if (env.isAndroid) {
    const noProtocol = currentUrl.replace(/^https?:\/\//i, '');
    const scheme = currentUrl.startsWith('https') ? 'https' : 'http';
    window.location.href = `intent://${noProtocol}#Intent;scheme=${scheme};package=com.android.chrome;end`;
  }
}
