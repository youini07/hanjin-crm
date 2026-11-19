import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import {
  MessageSquareText,
  FileSpreadsheet,
  SlidersHorizontal,
  Download,
  ExternalLink,
  X,
} from 'lucide-react';
import KakaoShippingPage from './pages/KakaoShippingPage';
import GripShippingPage from './pages/GripShippingPage';
import ApiSettingsModal, { type PublicApiSettings } from './components/ApiSettingsModal';
import PwaInstallModal from './components/PwaInstallModal';
import {
  detectMobileBrowserEnv,
  openInExternalBrowser,
  type BeforeInstallPromptEvent,
} from './utils/pwaEnv';
import { API_URL, socket } from './config/api';
import type { GridRow } from './components/ShippingGrid';

type ActivePage = 'kakao' | 'grip';

const getPageFromPathname = (pathname: string): ActivePage => {
  return pathname.startsWith('/grip') ? 'grip' : 'kakao';
};

/**
 * App - 모바일/데스크탑 반응형 상단 네비게이션 및 PWA 설치 지원 레이아웃
 *
 * 왜 모바일 헤더를 2단으로 분리했는가:
 * 360px~430px 폭의 스마트폰 화면에서 브랜드명·탭·설정 버튼을 한 줄에 우겨넣으면
 * 탭 글자가 세로로 1글자씩 깨져 본문을 덮는 문제가 발생하므로,
 * 모바일에서는 [상단 브랜드+액션] / [하단 50:50 세그먼트 탭] 2단 구조로 정돈함.
 */
function App() {
  const [activePage, setActivePage] = useState<ActivePage>(() =>
    getPageFromPathname(window.location.pathname)
  );
  const [kakaoCount, setKakaoCount] = useState(0);
  const [gripCount, setGripCount] = useState(0);
  const [apiSettings, setApiSettings] = useState<PublicApiSettings | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // PWA 설치 상태 관리
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstallModalOpen, setIsInstallModalOpen] = useState(false);
  const [isStandalone, setIsStandalone] = useState(() => detectMobileBrowserEnv().isStandalone);
  const [hideInAppBanner, setHideInAppBanner] = useState(false);

  const browserEnv = detectMobileBrowserEnv();

  useEffect(() => {
    const handlePopState = () => {
      setActivePage(getPageFromPathname(window.location.pathname));
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // 브라우저의 PWA 설치 프롬프트 이벤트 캡처
  useEffect(() => {
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    const handleAppInstalled = () => {
      setDeferredPrompt(null);
      setIsStandalone(true);
      setIsInstallModalOpen(false);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const handleTriggerNativeInstall = useCallback(async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    if (choice.outcome === 'accepted') {
      setDeferredPrompt(null);
      setIsInstallModalOpen(false);
    }
  }, [deferredPrompt]);

  const handleInstallButtonClick = () => {
    // 일반 브라우저에서 네이티브 설치 팝업이 준비되어 있으면 즉시 실행
    if (!browserEnv.isInApp && deferredPrompt) {
      handleTriggerNativeInstall();
      return;
    }
    setIsInstallModalOpen(true);
  };

  // 서버에 저장된 API 키 상태 조회 (소켓 재연결 시 자동 동기화)
  useEffect(() => {
    const loadSettings = () => {
      axios
        .get(`${API_URL}/settings`)
        .then((res) => {
          if (res.data?.success && res.data.settings) {
            setApiSettings(res.data.settings);
          }
        })
        .catch(() => {});
    };

    loadSettings();
    socket.on('connect', loadSettings);
    return () => {
      socket.off('connect', loadSettings);
    };
  }, []);

  useEffect(() => {
    const updateKakaoCount = (rows: GridRow[]) =>
      setKakaoCount(Array.isArray(rows) ? rows.length : 0);
    const updateGripCount = (rows: GridRow[]) =>
      setGripCount(Array.isArray(rows) ? rows.length : 0);

    socket.on('init_kakao_grid', updateKakaoCount);
    socket.on('kakao_grid_updated', updateKakaoCount);
    socket.on('init_grip_grid', updateGripCount);
    socket.on('grip_grid_updated', updateGripCount);

    socket.emit('request_kakao_grid');
    socket.emit('request_grip_grid');

    return () => {
      socket.off('init_kakao_grid', updateKakaoCount);
      socket.off('kakao_grid_updated', updateKakaoCount);
      socket.off('init_grip_grid', updateGripCount);
      socket.off('grip_grid_updated', updateGripCount);
    };
  }, []);

  const navigateTo = (page: ActivePage) => {
    const targetPath = page === 'grip' ? '/grip' : '/';
    if (window.location.pathname !== targetPath) {
      window.history.pushState({}, '', targetPath);
    }
    setActivePage(page);
  };

  return (
    <div className="min-h-screen bg-[#F7F8FA] text-slate-900">
      {/* 카카오톡 인앱 브라우저 접속 시 외부 브라우저 전환 안내 배너 */}
      {browserEnv.isKakaoInApp && !hideInAppBanner && (
        <div className="bg-slate-900 text-white px-3.5 py-2 text-xs flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={openInExternalBrowser}
            className="flex items-center gap-1.5 text-left font-medium hover:underline min-w-0"
          >
            <ExternalLink size={13} className="text-sky-400 shrink-0" />
            <span className="truncate">
              카톡 브라우저입니다 · <strong>앱 다운로드 및 엑셀 저장은 외부 브라우저로 열기</strong>
            </span>
          </button>
          <button
            type="button"
            onClick={() => setHideInAppBanner(true)}
            className="p-1 text-slate-400 hover:text-white shrink-0"
            aria-label="배너 닫기"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* 모던 글래스 상단 헤더 (모바일 2단 / 데스크탑 1단 반응형) */}
      <header className="sticky top-0 z-30 bg-white/90 backdrop-blur-md border-b border-slate-200/80 pt-safe-top">
        <div className="w-full max-w-[1480px] mx-auto px-3.5 sm:px-6">
          {/* 1행: 브랜드 로고 + 우측 유틸 버튼 (데스크탑에서는 중앙/우측 탭 포함) */}
          <div className="h-14 md:h-16 flex items-center justify-between gap-2.5">
            {/* 브랜드 영역 */}
            <div className="flex items-center gap-2.5 min-w-0">
              <img
                src="/icon-96.png"
                alt="한진택배 스마트 송장"
                className="w-9 h-9 rounded-xl shadow-xs shrink-0 object-cover"
              />
              <div className="min-w-0">
                <h1 className="text-[15px] font-bold text-slate-900 tracking-tight leading-tight truncate">
                  한진택배 스마트 송장
                </h1>
                <p className="text-[11px] text-slate-400 hidden sm:block truncate">
                  {activePage === 'kakao'
                    ? '카톡 대화·스샷 AI 주소 분석 · DB 대조 · 엑셀 출력'
                    : '그립(Grip) 주문 합포장 추출 · 엑셀 출력'}
                </p>
              </div>
            </div>

            {/* 우측 컨트롤 영역 */}
            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
              {/* 데스크탑 전용 인라인 탭 (md 이상에서만 노출) */}
              <nav className="hidden md:flex items-center bg-slate-100/90 p-1 rounded-xl border border-slate-200/60">
                <button
                  type="button"
                  onClick={() => navigateTo('kakao')}
                  className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-[13px] font-semibold whitespace-nowrap transition-all ${
                    activePage === 'kakao'
                      ? 'bg-white text-slate-900 shadow-xs ring-1 ring-slate-900/5'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <MessageSquareText size={15} className="shrink-0" />
                  <span>카카오톡 주문</span>
                  {kakaoCount > 0 && (
                    <span
                      className={`text-[11px] px-1.5 py-0.2 rounded-md font-bold tabular-nums ${
                        activePage === 'kakao'
                          ? 'bg-slate-900 text-white'
                          : 'bg-slate-200/80 text-slate-600'
                      }`}
                    >
                      {kakaoCount}
                    </span>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => navigateTo('grip')}
                  className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-[13px] font-semibold whitespace-nowrap transition-all ${
                    activePage === 'grip'
                      ? 'bg-white text-slate-900 shadow-xs ring-1 ring-slate-900/5'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <FileSpreadsheet size={15} className="shrink-0" />
                  <span>그립(Grip) 시트</span>
                  {gripCount > 0 && (
                    <span
                      className={`text-[11px] px-1.5 py-0.2 rounded-md font-bold tabular-nums ${
                        activePage === 'grip'
                          ? 'bg-slate-900 text-white'
                          : 'bg-slate-200/80 text-slate-600'
                      }`}
                    >
                      {gripCount}
                    </span>
                  )}
                </button>
              </nav>

              {/* 한진택배 Focus 로그인 페이지 바로가기 (PC 웹 & 모바일 웹앱 공통) */}
              <a
                href="https://focus.hanjin.com/login"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 px-2.5 sm:px-3 py-2 rounded-xl text-xs font-semibold text-sky-700 bg-sky-50 hover:bg-sky-100/80 border border-sky-200/80 transition whitespace-nowrap shrink-0"
                title="한진택배 기업택배(Focus) 로그인 페이지 열기"
              >
                <span className="sm:hidden">한진로그인</span>
                <span className="hidden sm:inline">한진 Focus 로그인</span>
                <ExternalLink size={13} className="shrink-0" />
              </a>

              {/* 모바일/웹앱 다운로드 버튼 (이미 설치된 standalone 앱으로 실행 중일 때는 숨김) */}
              {!isStandalone && (
                <button
                  type="button"
                  onClick={handleInstallButtonClick}
                  className="flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3 py-2 rounded-xl text-xs font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100/80 border border-indigo-200/70 transition whitespace-nowrap shrink-0"
                  title="모바일 웹앱 다운로드 (홈 화면 설치)"
                >
                  <Download size={14} className="shrink-0" />
                  <span>앱 받기</span>
                </button>
              )}

              {/* API 설정 버튼 */}
              <button
                type="button"
                onClick={() => setIsSettingsOpen(true)}
                className="flex items-center gap-1.5 px-2.5 sm:px-3 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:text-slate-900 bg-white hover:bg-slate-50 border border-slate-200/90 shadow-2xs transition whitespace-nowrap shrink-0"
                title="AI 및 주소 API 설정"
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                    apiSettings?.hasGeminiKey ? 'bg-emerald-500' : 'bg-slate-300'
                  }`}
                />
                <SlidersHorizontal size={14} className="shrink-0" />
                <span className="hidden sm:inline">설정</span>
              </button>
            </div>
          </div>

          {/* 2행: 모바일 전용 50:50 풀와이드 탭 바 (md 미만에서만 노출, 글자 세로 깨짐 원천 차단) */}
          <div className="md:hidden pb-2.5">
            <nav className="grid grid-cols-2 gap-1 bg-slate-100/90 p-1 rounded-xl border border-slate-200/60">
              <button
                type="button"
                onClick={() => navigateTo('kakao')}
                className={`flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg text-[13px] font-semibold whitespace-nowrap transition-all ${
                  activePage === 'kakao'
                    ? 'bg-white text-slate-900 shadow-xs ring-1 ring-slate-900/5'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <MessageSquareText size={14} className="shrink-0" />
                <span>카카오톡 주문</span>
                {kakaoCount > 0 && (
                  <span
                    className={`text-[11px] px-1.5 py-0.2 rounded-md font-bold tabular-nums ${
                      activePage === 'kakao'
                        ? 'bg-slate-900 text-white'
                        : 'bg-slate-200/80 text-slate-600'
                    }`}
                  >
                    {kakaoCount}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => navigateTo('grip')}
                className={`flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg text-[13px] font-semibold whitespace-nowrap transition-all ${
                  activePage === 'grip'
                    ? 'bg-white text-slate-900 shadow-xs ring-1 ring-slate-900/5'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <FileSpreadsheet size={14} className="shrink-0" />
                <span>그립(Grip) 시트</span>
                {gripCount > 0 && (
                  <span
                    className={`text-[11px] px-1.5 py-0.2 rounded-md font-bold tabular-nums ${
                      activePage === 'grip'
                        ? 'bg-slate-900 text-white'
                        : 'bg-slate-200/80 text-slate-600'
                    }`}
                  >
                    {gripCount}
                  </span>
                )}
              </button>
            </nav>
          </div>
        </div>
      </header>

      {/* 메인 컨텐츠 영역 */}
      <main className="w-full max-w-[1480px] mx-auto px-3 sm:px-6 py-4 sm:py-6">
        {activePage === 'kakao' ? <KakaoShippingPage /> : <GripShippingPage />}
      </main>

      {isSettingsOpen && (
        <ApiSettingsModal
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          onSettingsUpdated={(updated) => setApiSettings(updated)}
        />
      )}

      <PwaInstallModal
        isOpen={isInstallModalOpen}
        onClose={() => setIsInstallModalOpen(false)}
        deferredPrompt={deferredPrompt}
        onTriggerNativeInstall={handleTriggerNativeInstall}
      />
    </div>
  );
}

export default App;
