import { useState, useEffect } from 'react';
import { Package, ClipboardPaste, ShoppingBag } from 'lucide-react';
import KakaoShippingPage from './pages/KakaoShippingPage';
import GripShippingPage from './pages/GripShippingPage';
import { socket } from './config/api';
import type { GridRow } from './components/ShippingGrid';

type ActivePage = 'kakao' | 'grip';

/** 현재 브라우저 주소(URL 경로)로부터 초기 페이지 결정 */
const getPageFromPathname = (pathname: string): ActivePage => {
  return pathname.startsWith('/grip') ? 'grip' : 'kakao';
};

/**
 * App - 최상위 레이아웃 및 페이지 라우터
 *
 * 왜 URL 경로 기반 페이지 분리를 적용했는가:
 * 1. 카카오톡 텍스트 입력('/')과 그립 엑셀 변환('/grip')을 완전히 다른 페이지로 분리하여
 *    한 화면에 두 기능이 뒤섞이는 불편함을 해소함.
 * 2. 브라우저 뒤로가기·새로고침·즐겨찾기(북마크)에서도 선택한 페이지가 그대로 유지되도록 함.
 * 3. 전체 레이아웃 최대 폭을 기존 1152px(max-w-6xl)에서 1480px로 확장하여
 *    긴 주소와 상세주소가 말줄임(...) 없이 시원하게 한눈에 표시되도록 개선함.
 */
function App() {
  const [activePage, setActivePage] = useState<ActivePage>(() =>
    getPageFromPathname(window.location.pathname)
  );
  const [kakaoCount, setKakaoCount] = useState(0);
  const [gripCount, setGripCount] = useState(0);

  // 브라우저 뒤로가기 / 앞으로가기 지원
  useEffect(() => {
    const handlePopState = () => {
      setActivePage(getPageFromPathname(window.location.pathname));
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // 상단 탭에 각 페이지 대기 건수를 실시간 표시하기 위한 소켓 구독
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

  /** 페이지 이동 처리 (URL 변경 + 상태 전환) */
  const navigateTo = (page: ActivePage) => {
    const targetPath = page === 'grip' ? '/grip' : '/';
    if (window.location.pathname !== targetPath) {
      window.history.pushState({}, '', targetPath);
    }
    setActivePage(page);
  };

  return (
    <div className="min-h-screen bg-slate-100 py-6 px-4 sm:px-6">
      {/* 주소·상세주소 컬럼이 넉넉히 보이도록 컨테이너 최대 너비를 1480px로 확장 */}
      <div className="w-full max-w-[1480px] mx-auto space-y-4">
        {/* 상단 헤더 및 페이지 전환 네비게이션 */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-white rounded-2xl shadow-md px-5 py-3.5 border border-slate-200">
          {/* 좌측 타이틀 */}
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-50 rounded-xl">
              <Package size={26} className="text-blue-600" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-800 tracking-tight">
                한진택배 고객 배송지 입력기
              </h1>
              <p className="text-xs text-slate-500">
                {activePage === 'kakao'
                  ? '카카오톡 텍스트 인식 → 고객 배송지 확인 → 한진택배 엑셀 내보내기'
                  : '그립(Grip) 판매내역서 합포장 추출 → 배송지 확인 → 한진택배 엑셀 내보내기'}
              </p>
            </div>
          </div>

          {/* 우측 페이지 전환 탭 */}
          <div className="flex items-center gap-2 bg-slate-100 p-1.5 rounded-xl w-full sm:w-auto">
            <button
              type="button"
              onClick={() => navigateTo('kakao')}
              className={`flex-1 sm:flex-initial flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all ${
                activePage === 'kakao'
                  ? 'bg-amber-500 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
              }`}
            >
              <ClipboardPaste size={16} />
              <span>카카오톡 텍스트 입력</span>
              {kakaoCount > 0 && (
                <span
                  className={`text-xs px-2 py-0.5 rounded-full font-bold ${
                    activePage === 'kakao'
                      ? 'bg-white/25 text-white'
                      : 'bg-amber-100 text-amber-700'
                  }`}
                >
                  {kakaoCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => navigateTo('grip')}
              className={`flex-1 sm:flex-initial flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all ${
                activePage === 'grip'
                  ? 'bg-violet-600 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
              }`}
            >
              <ShoppingBag size={16} />
              <span>그립(Grip) 엑셀 파일</span>
              {gripCount > 0 && (
                <span
                  className={`text-xs px-2 py-0.5 rounded-full font-bold ${
                    activePage === 'grip'
                      ? 'bg-white/25 text-white'
                      : 'bg-violet-100 text-violet-700'
                  }`}
                >
                  {gripCount}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* 현재 선택된 전용 페이지 렌더링 */}
        {activePage === 'kakao' ? <KakaoShippingPage /> : <GripShippingPage />}
      </div>
    </div>
  );
}

export default App;
