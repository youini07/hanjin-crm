import { useState } from 'react';
import { ClipboardPaste, Sparkles, X, Phone } from 'lucide-react';

/**
 * KakaoTextParser - 카카오톡 대화 텍스트에서 전화번호를 추출하는 컴포넌트
 * 
 * 왜 이 컴포넌트가 필요한가:
 * 카카오톡으로 받은 고객 배송정보 텍스트에서 전화번호를 자동으로 인식하여
 * 수작업 입력 시간을 대폭 줄이기 위함.
 * 
 * 전화번호 패턴: 010-1234-5678, 01012345678, ☎010-12345678 등
 */

interface KakaoTextParserProps {
  /** 추출된 전화번호 목록과 함께 DB 매칭을 요청하는 콜백 */
  onMatchRequest: (phones: string[]) => void;
  /** 매칭 로딩 상태 */
  isLoading: boolean;
}

/**
 * 전화번호 추출 정규식
 * 왜 이 패턴인가:
 * - 0으로 시작하는 한국 전화번호 (010, 011, 016, 017, 018, 019 등)
 * - 하이픈(-), 점(.), 공백으로 구분된 번호도 매칭
 * - ☎, 📞, ☏ 등 기호 접두사 무시
 * - 10~11자리 숫자 (하이픈 제거 후)
 */
const PHONE_REGEX = /(?:☎|📞|☏|✆|전화|핸드폰|HP|hp|연락처)?[\s\u200B]*0[1-9][0-9](?:[^\d\na-zA-Z가-힣]{0,10}\d){7,8}/g;

/** 전화번호에서 숫자만 추출하여 정규화 */
const normalizePhone = (raw: string): string => {
  return raw.replace(/[^0-9]/g, '');
};

export default function KakaoTextParser({ onMatchRequest, isLoading }: KakaoTextParserProps) {
  const [rawText, setRawText] = useState('');
  const [extractedPhones, setExtractedPhones] = useState<string[]>([]);
  const [isExpanded, setIsExpanded] = useState(true);

  /** 텍스트에서 전화번호 추출 */
  const handleExtract = () => {
    if (!rawText.trim()) return;

    const matches = rawText.match(PHONE_REGEX);
    if (!matches || matches.length === 0) {
      setExtractedPhones([]);
      return;
    }

    // 숫자만 추출 → 중복 제거 → 10~11자리만 유효 처리
    const normalized = matches
      .map(normalizePhone)
      .filter(p => p.length >= 10 && p.length <= 11);

    const unique = [...new Set(normalized)];
    setExtractedPhones(unique);
  };

  /** 추출된 전화번호로 DB 매칭 요청 */
  const handleMatch = () => {
    if (extractedPhones.length === 0) return;
    onMatchRequest(extractedPhones);
    // 매칭 후 파서 접기 (그리드에 집중하도록)
    setIsExpanded(false);
  };

  /** 특정 전화번호를 목록에서 제거 (잘못 추출된 경우) */
  const removePhone = (phone: string) => {
    setExtractedPhones(prev => prev.filter(p => p !== phone));
  };

  /** 입력 초기화 */
  const handleClear = () => {
    setRawText('');
    setExtractedPhones([]);
  };

  return (
    <div className="bg-white rounded-2xl shadow-lg border border-slate-200 overflow-hidden">
      {/* 헤더 - 클릭으로 접기/펼치기 */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-5 py-3.5 flex items-center justify-between bg-gradient-to-r from-amber-500 to-orange-500 text-white hover:from-amber-600 hover:to-orange-600 transition-all"
      >
        <div className="flex items-center gap-2.5">
          <ClipboardPaste size={20} />
          <span className="font-bold text-sm tracking-tight">카카오톡 텍스트 붙여넣기</span>
          {extractedPhones.length > 0 && (
            <span className="bg-white/25 text-white text-xs font-bold px-2 py-0.5 rounded-full">
              {extractedPhones.length}건 추출됨
            </span>
          )}
        </div>
        <span className="text-white/80 text-lg">{isExpanded ? '▲' : '▼'}</span>
      </button>

      {isExpanded && (
        <div className="p-5 space-y-4">
          {/* 텍스트 입력 영역 */}
          <div>
            <textarea
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              placeholder={`카카오톡 대화 내용을 복사하여 붙여넣으세요.\n\n예시:\n앤니\n전라남도 여수시 신월로 561-8\n010-8286-6462\n\nKingprakan\n경기도 의정부시 의정부동 211-33\n☎010-65106668`}
              className="w-full h-36 rounded-xl border border-slate-300 p-3.5 text-sm resize-y focus:border-amber-500 focus:ring-2 focus:ring-amber-200 transition placeholder:text-slate-400"
            />
          </div>

          {/* 액션 버튼 */}
          <div className="flex gap-2">
            <button
              onClick={handleExtract}
              disabled={!rawText.trim()}
              className="flex-1 bg-amber-500 hover:bg-amber-600 disabled:bg-slate-300 text-white font-bold py-2.5 px-4 rounded-xl transition flex items-center justify-center gap-2 text-sm"
            >
              <Sparkles size={16} />
              전화번호 인식하기
            </button>
            {rawText && (
              <button
                onClick={handleClear}
                className="bg-slate-100 hover:bg-slate-200 text-slate-600 px-3 py-2.5 rounded-xl transition text-sm"
              >
                초기화
              </button>
            )}
          </div>

          {/* 추출 결과 미리보기 */}
          {extractedPhones.length > 0 && (
            <div className="space-y-3">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                인식된 전화번호 ({extractedPhones.length}건)
              </div>
              <div className="flex flex-wrap gap-2">
                {extractedPhones.map((phone) => (
                  <span
                    key={phone}
                    className="inline-flex items-center gap-1.5 bg-amber-50 text-amber-800 border border-amber-200 px-3 py-1.5 rounded-lg text-sm font-medium"
                  >
                    <Phone size={13} />
                    {phone.replace(/(\d{3})(\d{3,4})(\d{4})/, '$1-$2-$3')}
                    <button
                      onClick={() => removePhone(phone)}
                      className="ml-0.5 text-amber-400 hover:text-red-500 transition"
                    >
                      <X size={14} />
                    </button>
                  </span>
                ))}
              </div>

              {/* DB 매칭 버튼 */}
              <button
                onClick={handleMatch}
                disabled={isLoading}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white font-bold py-3 rounded-xl shadow-md shadow-blue-200 transition flex items-center justify-center gap-2 text-sm"
              >
                {isLoading ? (
                  <>
                    <span className="animate-spin">⏳</span>
                    DB 매칭 중...
                  </>
                ) : (
                  <>🔍 DB 매칭 + 그리드에 추가</>
                )}
              </button>
            </div>
          )}

          {/* 추출 결과가 0건일 때 안내 */}
          {rawText.trim() && extractedPhones.length === 0 && (
            <p className="text-xs text-slate-400 text-center py-1">
              [전화번호 인식하기] 버튼을 눌러 전화번호를 추출하세요
            </p>
          )}
        </div>
      )}
    </div>
  );
}
