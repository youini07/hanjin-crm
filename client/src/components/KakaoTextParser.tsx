import { useState } from 'react';
import {
  ClipboardPaste,
  Sparkles,
  X,
  Phone,
  Bot,
  CheckCircle2,
} from 'lucide-react';
import { normalizeClientPhone } from '../config/api';

export interface AiParsedSummary {
  total: number;
  matched: number;
  modified: number;
  newCount: number;
  photoCheck: number;
  typoWarning: number;
}

interface KakaoTextParserProps {
  /** AI 전체 대화 분석 요청 콜백 (팝업 없이 즉시 서버 분석 호출) */
  onAiParseRequest: (rawText: string) => Promise<AiParsedSummary | null>;
  /** 비상용 기존 전화번호만 추출 매칭 콜백 */
  onMatchRequest: (phones: string[]) => void;
  /** 매칭/분석 로딩 상태 */
  isLoading: boolean;
}

const PHONE_REGEX =
  /(?:☎|📞|☏|✆|전화|핸드폰|HP|hp|연락처)?[\s\u200B]*(?:\+?82[-\s.]?0?1[0-9]|0[1-9][0-9])(?:[^\d\na-zA-Z가-힣\u0E00-\u0E7F]{0,6}\d){7,8}/g;

export default function KakaoTextParser({
  onAiParseRequest,
  onMatchRequest,
  isLoading,
}: KakaoTextParserProps) {
  const [rawText, setRawText] = useState('');
  const [extractedPhones, setExtractedPhones] = useState<string[]>([]);
  const [lastAiSummary, setLastAiSummary] = useState<AiParsedSummary | null>(null);
  const [isExpanded, setIsExpanded] = useState(true);

  /** AI 스마트 분석 실행 (설정창 팝업 없이 즉시 백엔드로 분석 요청) */
  const handleAiAnalyze = async () => {
    if (!rawText.trim() || isLoading) return;
    setExtractedPhones([]);
    const summary = await onAiParseRequest(rawText);
    if (summary) {
      setLastAiSummary(summary);
      setIsExpanded(false);
    }
  };

  /** 비상용: 기존 정규식 전화번호만 추출 */
  const handleFallbackExtract = () => {
    if (!rawText.trim()) return;
    setLastAiSummary(null);

    const matches = rawText.match(PHONE_REGEX);
    if (!matches || matches.length === 0) {
      setExtractedPhones([]);
      return;
    }

    const normalized = matches
      .map((m) => normalizeClientPhone(m))
      .filter((p) => p.length >= 10 && p.length <= 12);

    const unique = [...new Set(normalized)];
    setExtractedPhones(unique);
  };

  const handleFallbackMatch = () => {
    if (extractedPhones.length === 0) return;
    onMatchRequest(extractedPhones);
    setIsExpanded(false);
  };

  const removePhone = (phone: string) => {
    setExtractedPhones((prev) => prev.filter((p) => p !== phone));
  };

  const handleClear = () => {
    setRawText('');
    setExtractedPhones([]);
    setLastAiSummary(null);
  };

  return (
    <div className="bg-white rounded-2xl shadow-lg border border-slate-200 overflow-hidden">
      {/* 심플 헤더 (클릭으로 접기/펼치기) */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-5 py-3.5 flex items-center justify-between bg-gradient-to-r from-amber-500 to-orange-500 text-white hover:from-amber-600 hover:to-orange-600 transition"
      >
        <div className="flex items-center gap-2.5">
          <ClipboardPaste size={20} />
          <span className="font-bold text-sm tracking-tight">카카오톡 텍스트 붙여넣기</span>
          {lastAiSummary && (
            <span className="bg-white/25 text-white text-xs font-bold px-2.5 py-0.5 rounded-full">
              최근 {lastAiSummary.total}건 분석됨
            </span>
          )}
        </div>
        <span className="text-white/90 text-sm font-bold">{isExpanded ? '▲' : '▼'}</span>
      </button>

      {/* 접혀 있을 때 요약 표시 */}
      {!isExpanded && lastAiSummary && (
        <div className="px-5 py-2.5 bg-amber-50/50 border-t border-amber-100 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-700">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-bold text-slate-800 flex items-center gap-1">
              <CheckCircle2 size={14} className="text-emerald-600" />
              총 {lastAiSummary.total}건:
            </span>
            <span>기존일치 {lastAiSummary.matched}</span>
            <span className="text-indigo-700 font-semibold">수정 {lastAiSummary.modified}</span>
            <span className="text-emerald-700 font-semibold">신규 {lastAiSummary.newCount}</span>
            {lastAiSummary.photoCheck > 0 && (
              <span className="text-amber-700 font-semibold">
                사진확인 {lastAiSummary.photoCheck}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => setIsExpanded(true)}
            className="text-amber-700 hover:underline font-semibold"
          >
            채팅창 펼치기 ▼
          </button>
        </div>
      )}

      {isExpanded && (
        <div className="p-5 space-y-4">
          <div>
            <textarea
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              placeholder={`카카오톡 PC 대화 내용을 그대로 드래그하여 붙여넣으세요.\n(날짜, FB 아이디, 사진 표시가 섞여 있어도 자동 구분합니다)`}
              className="w-full h-40 rounded-xl border border-slate-300 p-3.5 text-sm resize-y focus:border-amber-500 focus:ring-2 focus:ring-amber-200 transition placeholder:text-slate-400"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleAiAnalyze}
              disabled={!rawText.trim() || isLoading}
              className="flex-1 min-w-[220px] bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 disabled:from-slate-300 disabled:to-slate-300 text-white font-bold py-3 px-5 rounded-xl shadow-md shadow-indigo-200 transition flex items-center justify-center gap-2 text-sm"
            >
              {isLoading ? (
                <>
                  <span className="animate-spin">⏳</span>
                  AI 분석 및 DB 대조 중...
                </>
              ) : (
                <>
                  <Bot size={18} />
                  AI 스마트 분석 + 그리드 추가
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleFallbackExtract}
              disabled={!rawText.trim() || isLoading}
              className="bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 font-semibold py-3 px-3.5 rounded-xl transition flex items-center gap-1.5 text-xs"
              title="AI 없이 전화번호만 빠르게 추출합니다"
            >
              <Sparkles size={14} />
              번호만 추출
            </button>

            {rawText && (
              <button
                type="button"
                onClick={handleClear}
                disabled={isLoading}
                className="bg-slate-100 hover:bg-slate-200 text-slate-600 px-3.5 py-3 rounded-xl transition text-xs font-semibold"
              >
                초기화
              </button>
            )}
          </div>

          {extractedPhones.length > 0 && (
            <div className="space-y-3 pt-2 border-t border-slate-100">
              <div className="text-xs font-semibold text-slate-500">
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
                      type="button"
                      onClick={() => removePhone(phone)}
                      className="ml-0.5 text-amber-400 hover:text-red-500 transition"
                    >
                      <X size={14} />
                    </button>
                  </span>
                ))}
              </div>

              <button
                type="button"
                onClick={handleFallbackMatch}
                disabled={isLoading}
                className="w-full bg-amber-500 hover:bg-amber-600 disabled:bg-slate-400 text-white font-bold py-2.5 rounded-xl transition flex items-center justify-center gap-2 text-sm"
              >
                🔍 전화번호 기준 DB 매칭 + 그리드 추가
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
