import { useState, useRef } from 'react';
import axios from 'axios';
import { FileUp, FolderOpen, FileSpreadsheet, ChevronDown, Sparkles } from 'lucide-react';

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
      const message = axios.isAxiosError(err)
        ? err.response?.data?.error || '텍스트 분석 중 오류가 발생했습니다.'
        : '텍스트 분석 중 오류가 발생했습니다.';
      setErrorMsg(message);
    } finally {
      setIsLoading(false);
    }
  };

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
      const message = axios.isAxiosError(err)
        ? err.response?.data?.error || '첨부된 주문 파일을 불러오지 못했습니다.'
        : '첨부된 주문 파일을 불러오지 못했습니다.';
      setErrorMsg(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <section className="bg-white rounded-2xl border border-slate-200/80 shadow-[0_1px_3px_rgba(15,23,42,0.03)] overflow-hidden">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-4 sm:px-6 py-3.5 sm:py-4 flex items-center justify-between gap-2 hover:bg-slate-50/60 transition"
      >
        <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center shrink-0">
            <FileSpreadsheet size={16} />
          </div>
          <div className="text-left min-w-0">
            <span className="font-semibold text-[14px] text-slate-900 block truncate">
              그립(Grip) 판매내역서 업로드
            </span>
            <p className="text-xs text-slate-400 mt-0.5 truncate">
              동일 고객 주문을 합포장으로 묶고 품목명을 자동 요약합니다
            </p>
          </div>
        </div>
        <ChevronDown
          size={18}
          className={`text-slate-400 shrink-0 transition-transform duration-200 ${
            isExpanded ? 'rotate-180' : ''
          }`}
        />
      </button>

      {isExpanded && (
        <div className="px-4 sm:px-6 pb-4 sm:pb-5 pt-3.5 space-y-3.5 border-t border-slate-100">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 sm:gap-3">
            <label className="flex items-center justify-center gap-2.5 border border-dashed border-slate-300 bg-slate-50/60 hover:bg-slate-100/70 text-slate-700 rounded-xl p-3.5 sm:p-4 cursor-pointer transition font-medium text-[13px]">
              <FileUp size={17} className="text-slate-500 shrink-0" />
              <span className="truncate">
                {selectedFileName
                  ? `${selectedFileName} (다시 선택)`
                  : '판매내역서 파일 선택 (.xlsx / .csv)'}
              </span>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv,.txt"
                onChange={handleFileChange}
                className="hidden"
              />
            </label>

            <button
              type="button"
              onClick={handleLoadSampleFile}
              disabled={isLoading}
              className="flex items-center justify-center gap-2 border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 rounded-xl p-3.5 sm:p-4 transition font-medium text-[13px]"
            >
              <FolderOpen size={17} className="text-slate-500 shrink-0" />
              <span>폴더 내 최신 주문서 불러오기</span>
            </button>
          </div>

          <div className="space-y-2">
            <textarea
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              placeholder="또는 그립 엑셀/CSV 시트 내용을 여기에 붙여넣으세요."
              className="w-full h-24 rounded-xl bg-slate-50/60 focus:bg-white border border-slate-200/90 p-3.5 text-base sm:text-xs font-mono resize-y focus:outline-none focus:border-slate-900 focus:ring-4 focus:ring-slate-900/5 transition placeholder:text-slate-400 placeholder:text-xs"
            />

            {csvText.trim() && (
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setCsvText('')}
                  className="bg-slate-100 hover:bg-slate-200/70 text-slate-600 px-3.5 py-2 rounded-xl transition text-xs font-medium"
                >
                  초기화
                </button>
                <button
                  type="button"
                  onClick={handleParseText}
                  disabled={isLoading}
                  className="bg-slate-900 hover:bg-slate-800 disabled:bg-slate-200 text-white font-semibold py-2 px-5 rounded-xl transition flex items-center gap-1.5 text-xs"
                >
                  <Sparkles size={14} />
                  {isLoading ? '분석 중...' : '시트 분석하기'}
                </button>
              </div>
            )}
          </div>

          {errorMsg && (
            <div className="text-xs font-medium text-rose-600 bg-rose-50 px-3.5 py-2.5 rounded-xl">
              {errorMsg}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
