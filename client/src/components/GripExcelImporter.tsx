import { useState, useRef } from 'react';
import axios from 'axios';
import { FileUp, ShoppingBag, Sparkles, FolderOpen, FileSpreadsheet } from 'lucide-react';

/**
 * 그립(Grip) 판매내역서에서 추출된 고객별 묶음 데이터 인터페이스
 */
export interface GripGroupedCustomer {
  order_number: string;
  name: string;
  phone: string;
  zipcode: string;
  address: string;
  detail_address: string;
  delivery_message?: string;
  products: string[];
  item_memo: string;
  quantity: number;
  foundInDb?: boolean;
}

interface GripExcelImporterProps {
  apiUrl: string;
  onImportCustomers: (customers: GripGroupedCustomer[]) => void;
}

export default function GripExcelImporter({ apiUrl, onImportCustomers }: GripExcelImporterProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [csvText, setCsvText] = useState('');
  const [selectedFileName, setSelectedFileName] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  /**
   * 엑셀(.xlsx) 또는 CSV(.csv) 파일 선택 시 처리
   * 왜: 사용자가 그립에서 다운로드한 원본 엑셀 파일을 별도 변환 없이 바로 업로드할 수 있도록 지원
   */
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSelectedFileName(file.name);
    setErrorMsg('');
    setIsLoading(true);

    try {
      const lowerName = file.name.toLowerCase();

      if (lowerName.endsWith('.csv') || lowerName.endsWith('.txt')) {
        const text = await file.text();
        const res = await axios.post(`${apiUrl}/grip/parse`, {
          csvText: text,
          visibleCount: 2,
        });
        if (res.data.success) {
          onImportCustomers(res.data.items);
        }
      } else {
        // .xlsx 파일을 Base64로 인코딩하여 백엔드 ExcelJS 파서로 전달
        const arrayBuffer = await file.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        const fileBase64 = window.btoa(binary);

        const res = await axios.post(`${apiUrl}/grip/parse`, {
          fileBase64,
          visibleCount: 2,
        });
        if (res.data.success) {
          onImportCustomers(res.data.items);
        }
      }
    } catch (err: unknown) {
      console.error(err);
      const message = axios.isAxiosError(err)
        ? err.response?.data?.error || '파일 분석 중 오류가 발생했습니다.'
        : '파일 분석 중 오류가 발생했습니다.';
      setErrorMsg(message);
    } finally {
      setIsLoading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  /**
   * 붙여넣은 CSV / 엑셀 시트 텍스트 분석 요청
   */
  const handleParseText = async () => {
    if (!csvText.trim()) return;
    setErrorMsg('');
    setIsLoading(true);

    try {
      const res = await axios.post(`${apiUrl}/grip/parse`, {
        csvText,
        visibleCount: 2,
      });
      if (res.data.success) {
        onImportCustomers(res.data.items);
        setCsvText('');
      }
    } catch (err: unknown) {
      console.error(err);
      const message = axios.isAxiosError(err)
        ? err.response?.data?.error || '텍스트 분석 중 오류가 발생했습니다.'
        : '텍스트 분석 중 오류가 발생했습니다.';
      setErrorMsg(message);
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * 프로젝트 폴더에 첨부된 그립 엑셀 파일 즉시 불러오기
   */
  const handleLoadSampleFile = async () => {
    setErrorMsg('');
    setIsLoading(true);

    try {
      const res = await axios.get(`${apiUrl}/grip/sample?visibleCount=2`);
      if (res.data.success) {
        setSelectedFileName(res.data.fileName);
        onImportCustomers(res.data.items);
      }
    } catch (err: unknown) {
      console.error(err);
      const message = axios.isAxiosError(err)
        ? err.response?.data?.error || '첨부된 주문 파일을 불러오지 못했습니다.'
        : '첨부된 주문 파일을 불러오지 못했습니다.';
      setErrorMsg(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl shadow-lg border border-slate-200 overflow-hidden">
      {/* 상단 아코디언 헤더 */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-5 py-3.5 flex items-center justify-between bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white hover:from-violet-700 hover:to-fuchsia-700 transition-all"
      >
        <div className="flex items-center gap-2.5">
          <ShoppingBag size={20} />
          <span className="font-bold text-sm tracking-tight">
            그립(Grip) 판매내역서 자동 묶기 & 추출
          </span>
          <span className="bg-white/20 text-white text-xs font-semibold px-2.5 py-0.5 rounded-full">
            동일고객 합포장 · H열 상품명(외 N개) · 주문번호 표시
          </span>
        </div>
        <span className="text-white/80 text-lg">{isExpanded ? '▲' : '▼'}</span>
      </button>

      {isExpanded && (
        <div className="p-5 space-y-4">
          {/* 파일 업로드 & 프로젝트 내 첨부파일 불러오기 영역 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* 엑셀/CSV 파일 직접 선택 */}
            <label className="flex items-center justify-center gap-2.5 border-2 border-dashed border-violet-300 bg-violet-50/50 hover:bg-violet-50 text-violet-700 rounded-xl p-4 cursor-pointer transition font-semibold text-sm">
              <FileUp size={20} className="text-violet-600 shrink-0" />
              <span>
                {selectedFileName
                  ? `선택됨: ${selectedFileName} (다시 선택)`
                  : '그립 판매내역서 파일 업로드 (.xlsx / .csv)'}
              </span>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv,.txt"
                onChange={handleFileChange}
                className="hidden"
              />
            </label>

            {/* 현재 폴더의 첨부 엑셀 파일 원클릭 로드 */}
            <button
              type="button"
              onClick={handleLoadSampleFile}
              disabled={isLoading}
              className="flex items-center justify-center gap-2 border border-fuchsia-200 bg-fuchsia-50 hover:bg-fuchsia-100 text-fuchsia-800 rounded-xl p-4 transition font-semibold text-sm"
            >
              <FolderOpen size={19} className="text-fuchsia-600 shrink-0" />
              <span>폴더 내 최신 그립 주문서 즉시 불러오기</span>
            </button>
          </div>

          {/* 시트 복사-붙여넣기 입력란 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
                <FileSpreadsheet size={14} className="text-violet-600" />
                또는 그립 엑셀/CSV 내용을 아래에 그대로 붙여넣기
              </span>
              <span className="text-xs text-slate-400">
                3개 이상 구매 시 앞 2개 상품명 + &apos;외 N개&apos;로 자동 요약됩니다
              </span>
            </div>

            <textarea
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              placeholder="주문번호,주문상품번호,주문/결제일시,주문상태,...,상품명,... 헤더를 포함한 그립 시트 전체 내용을 붙여넣으세요."
              className="w-full h-28 rounded-xl border border-slate-300 p-3 text-xs font-mono resize-y focus:border-violet-500 focus:ring-2 focus:ring-violet-200 transition placeholder:text-slate-400"
            />

            {csvText.trim() && (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleParseText}
                  disabled={isLoading}
                  className="flex-1 bg-violet-600 hover:bg-violet-700 disabled:bg-slate-300 text-white font-bold py-2.5 px-4 rounded-xl transition flex items-center justify-center gap-2 text-sm"
                >
                  <Sparkles size={16} />
                  {isLoading ? '분석 중...' : '시트 분석하여 주소입력 리스트 만들기'}
                </button>
                <button
                  type="button"
                  onClick={() => setCsvText('')}
                  className="bg-slate-100 hover:bg-slate-200 text-slate-600 px-4 py-2.5 rounded-xl transition text-sm"
                >
                  초기화
                </button>
              </div>
            )}
          </div>

          {errorMsg && (
            <div className="text-xs font-semibold text-red-600 bg-red-50 border border-red-200 rounded-lg px-3.5 py-2.5">
              ⚠️ {errorMsg}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

