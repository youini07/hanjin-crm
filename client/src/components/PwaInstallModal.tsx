import { useState } from 'react';
import {
  X,
  Download,
  ExternalLink,
  Share,
  PlusSquare,
  Copy,
  Check,
  Smartphone,
} from 'lucide-react';
import {
  detectMobileBrowserEnv,
  openInExternalBrowser,
  type BeforeInstallPromptEvent,
} from '../utils/pwaEnv';

interface PwaInstallModalProps {
  isOpen: boolean;
  onClose: () => void;
  deferredPrompt: BeforeInstallPromptEvent | null;
  onTriggerNativeInstall: () => Promise<void>;
}

export default function PwaInstallModal({
  isOpen,
  onClose,
  deferredPrompt,
  onTriggerNativeInstall,
}: PwaInstallModalProps) {
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const env = detectMobileBrowserEnv();

  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // 클립보드 권한 제한 시 무시
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/45 backdrop-blur-xs p-0 sm:p-4">
      <div className="bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl border border-slate-200/80 w-full max-w-md overflow-hidden pb-safe-bottom">
        {/* 헤더 */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img
              src="/icon-192.png"
              alt="한진송장 앱 아이콘"
              className="w-11 h-11 rounded-xl shadow-xs shrink-0"
            />
            <div>
              <h2 className="font-bold text-[15px] text-slate-900">한진송장 모바일 앱 설치</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                홈 화면에 앱으로 내려받아 전체 화면으로 사용하세요
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-800 hover:bg-slate-100 transition"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* 케이스 1: 카카오톡 등 인앱 브라우저에서 접속한 경우 */}
          {env.isInApp ? (
            <div className="space-y-3.5">
              <div className="p-3.5 rounded-2xl bg-amber-50/90 border border-amber-200/70 text-xs text-amber-900 leading-relaxed">
                <strong className="font-semibold block mb-1">
                  현재 카카오톡 내부 브라우저로 접속 중입니다
                </strong>
                카카오톡 창 안에서는 앱 다운로드(홈 화면 설치)와 엑셀 파일 저장이 제한될 수 있습니다.
                아래 버튼을 눌러 기본 브라우저(Chrome / Safari)로 열어주세요.
              </div>

              {env.isKakaoInApp || env.isAndroid ? (
                <button
                  type="button"
                  onClick={openInExternalBrowser}
                  className="w-full py-3.5 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-semibold text-sm flex items-center justify-center gap-2 shadow-xs transition"
                >
                  <ExternalLink size={16} />
                  <span>외부 브라우저(Safari / Chrome)로 바로 열기</span>
                </button>
              ) : null}

              <button
                type="button"
                onClick={handleCopyUrl}
                className="w-full py-3 px-4 rounded-xl bg-slate-100 hover:bg-slate-200/80 text-slate-700 font-medium text-xs flex items-center justify-center gap-1.5 transition"
              >
                {copied ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
                <span>
                  {copied
                    ? '주소가 복사되었습니다! Safari/Chrome에 붙여넣으세요'
                    : '현재 페이지 주소 복사하기'}
                </span>
              </button>
            </div>
          ) : deferredPrompt ? (
            /* 케이스 2: Android Chrome / Edge / PC 등 원클릭 네이티브 설치 지원 환경 */
            <div className="space-y-3.5">
              <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/70 text-xs text-slate-600 leading-relaxed">
                별도 스토어 이동 없이 휴대폰 바탕화면에 <strong>한진송장</strong> 아이콘이 즉시 생성되며,
                주소창 없는 깔끔한 전용 앱 화면으로 실행됩니다.
              </div>
              <button
                type="button"
                onClick={onTriggerNativeInstall}
                className="w-full py-3.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm flex items-center justify-center gap-2 shadow-xs transition"
              >
                <Download size={17} />
                <span>지금 바로 앱 다운로드 (설치)</span>
              </button>
            </div>
          ) : env.isIOS ? (
            /* 케이스 3: 아이폰 / 아이패드 Safari 안내 */
            <div className="space-y-3">
              <p className="text-xs text-slate-500 leading-relaxed">
                아이폰(Safari)에서는 아래 2단계로 바탕화면에 전용 앱을 바로 설치할 수 있습니다.
              </p>

              <div className="space-y-2.5">
                <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 border border-slate-200/70">
                  <div className="w-8 h-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-indigo-600 shrink-0">
                    <Share size={16} />
                  </div>
                  <div className="text-xs text-slate-700">
                    <span className="font-bold text-slate-900">1단계.</span> 화면 하단 중앙의{' '}
                    <strong className="text-indigo-600">공유 버튼(네모 위 화살표)</strong>을 누르세요.
                  </div>
                </div>

                <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 border border-slate-200/70">
                  <div className="w-8 h-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-indigo-600 shrink-0">
                    <PlusSquare size={16} />
                  </div>
                  <div className="text-xs text-slate-700">
                    <span className="font-bold text-slate-900">2단계.</span> 메뉴를 조금 내려{' '}
                    <strong className="text-indigo-600">홈 화면에 추가</strong>를 누르면 앱 설치 완료!
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* 케이스 4: 이미 설치되었거나 수동 메뉴 설치가 필요한 브라우저 */
            <div className="space-y-3">
              <div className="flex items-start gap-3 p-3.5 rounded-xl bg-slate-50 border border-slate-200/70">
                <Smartphone size={18} className="text-indigo-600 shrink-0 mt-0.5" />
                <div className="text-xs text-slate-600 leading-relaxed">
                  브라우저 우측 상단(또는 하단)의 <strong className="text-slate-900">메뉴 [⋮]</strong> 버튼을 누른 뒤{' '}
                  <strong className="text-indigo-600">[앱 설치]</strong> 또는{' '}
                  <strong className="text-indigo-600">[홈 화면에 추가]</strong>를 선택하면 바탕화면에 앱이 설치됩니다.
                </div>
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={onClose}
            className="w-full py-2.5 rounded-xl text-xs font-semibold text-slate-500 hover:bg-slate-100 transition"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
