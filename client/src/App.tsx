import { useState, useCallback, useEffect } from 'react';
import axios from 'axios';
import { useDaumPostcodePopup } from 'react-daum-postcode';
import { Search, Save, CheckCircle, Package, MapPin, Plus, AlertCircle } from 'lucide-react';
import { io } from 'socket.io-client';
import KakaoTextParser from './components/KakaoTextParser';
import ShippingGrid, { type GridRow } from './components/ShippingGrid';

// 로컬 개발 환경인지 판별 (localhost 또는 내부 IP)
const isDev = window.location.hostname === 'localhost' || window.location.hostname.startsWith('192.168.') || window.location.hostname.startsWith('10.');
// 웹 서버(Railway) 환경에서는 상대 경로('/api')를 사용하여 포트 문제(3001) 및 HTTPS 혼합 콘텐츠 에러를 방지
const API_URL = isDev ? `http://${window.location.hostname}:3001/api` : '/api';
const socket = isDev ? io(`http://${window.location.hostname}:3001`) : io();

/**
 * 고유 임시 ID 생성기
 * 왜: 그리드 행을 식별하기 위한 클라이언트 전용 임시 ID
 * DB id와는 무관 (내보내기 전까지 DB에 저장하지 않으므로)
 */
let tempIdCounter = 0;
const generateTempId = () => `temp_${Date.now()}_${++tempIdCounter}`;

function App() {
  // ──────────────────────────────────────────────────────
  // [폼 상태] 상단 입력 폼의 각 필드
  // ──────────────────────────────────────────────────────
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [zipcode, setZipcode] = useState('');
  const [address, setAddress] = useState('');
  const [detailAddress, setDetailAddress] = useState('');

  // ──────────────────────────────────────────────────────
  // [UI 상태] 로딩, 메시지, 매칭 로딩
  // ──────────────────────────────────────────────────────
  const [status, setStatus] = useState({ type: '', message: '' });
  const [isLoading, setIsLoading] = useState(false);
  const [isMatchLoading, setIsMatchLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  // ──────────────────────────────────────────────────────
  // [그리드 상태] 행 데이터, 선택된 행, 체크된 행
  // ──────────────────────────────────────────────────────
  const [gridRows, setGridRows] = useState<GridRow[]>([]);
  const [activeRowId, setActiveRowId] = useState<string | null>(null);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [isExistingCustomer, setIsExistingCustomer] = useState(false);

  // ──────────────────────────────────────────────────────
  // [웹소켓 연동] 다른 기기와 그리드 동기화
  // ──────────────────────────────────────────────────────
  useEffect(() => {
    socket.on('init_grid', (rows: GridRow[]) => {
      setGridRows(rows);
    });

    socket.on('grid_updated', (rows: GridRow[]) => {
      setGridRows(rows);
    });

    return () => {
      socket.off('init_grid');
      socket.off('grid_updated');
    };
  }, []);

  /**
   * 내 그리드를 업데이트하면서 동시에 다른 기기에 변경사항 브로드캐스트
   */
  const setGridRowsAndSync = useCallback((updater: React.SetStateAction<GridRow[]>) => {
    setGridRows(prev => {
      const nextRows = typeof updater === 'function' ? updater(prev) : updater;
      socket.emit('update_grid', nextRows);
      return nextRows;
    });
  }, []);

  // 카카오 주소검색 훅
  const openPostcode = useDaumPostcodePopup('//t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js');

  /** 카카오 주소검색 완료 콜백 */
  const handlePostcodeComplete = (data: any) => {
    let fullAddress = data.address;
    let extraAddress = '';

    if (data.addressType === 'R') {
      if (data.bname !== '') extraAddress += data.bname;
      if (data.buildingName !== '') {
        extraAddress += extraAddress !== '' ? `, ${data.buildingName}` : data.buildingName;
      }
      fullAddress += extraAddress !== '' ? ` (${extraAddress})` : '';
    }

    setZipcode(data.zonecode);
    setAddress(fullAddress);
  };

  /** 카카오 주소검색 팝업 열기 */
  const handleOpenPostcode = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    openPostcode({ onComplete: handlePostcodeComplete });
  };

  // ──────────────────────────────────────────────────────
  // [폼 → 그리드] 기존 단건 전화번호 검색 (폼에서 직접 입력 시)
  // ──────────────────────────────────────────────────────
  const searchCustomer = async () => {
    if (!phone || phone.length < 10) return;

    setIsLoading(true);
    setStatus({ type: '', message: '' });

    try {
      const normalizedPhone = phone.replace(/[^0-9]/g, '');
      const response = await axios.get(`${API_URL}/customers/search?phone=${normalizedPhone}`);

      if (response.data.success && response.data.customer) {
        const c = response.data.customer;
        setName(c.name || '');
        setZipcode(c.zipcode || '');
        setAddress(c.address || '');
        setDetailAddress(c.detail_address || '');
        setIsExistingCustomer(true);
        setStatus({ type: 'success', message: '기존 고객 정보가 자동 완성되었습니다.' });
      } else {
        setName('');
        setZipcode('');
        setAddress('');
        setDetailAddress('');
        setIsExistingCustomer(false);
        setStatus({ type: 'info', message: '신규 고객입니다. 나머지 정보를 입력해주세요.' });
      }
    } catch (error) {
      console.error(error);
      setStatus({ type: 'error', message: '검색 중 오류가 발생했습니다.' });
    } finally {
      setIsLoading(false);
    }
  };

  // ──────────────────────────────────────────────────────
  // [카카오톡 파서 → 그리드] 전화번호 배열로 DB 매칭
  // ──────────────────────────────────────────────────────
  const handleBulkMatch = useCallback(async (phones: string[]) => {
    setIsMatchLoading(true);
    setStatus({ type: '', message: '' });

    try {
      const response = await axios.post(`${API_URL}/customers/bulk-match`, { phones });

      if (response.data.success) {
        const results = response.data.results;

        // 이미 그리드에 있는 전화번호는 중복 추가 방지
        const existingPhones = new Set(gridRows.map(r => r.phone));

        const newRows: GridRow[] = results
          .filter((r: any) => !existingPhones.has(r.phone))
          .map((r: any) => ({
            _tempId: generateTempId(),
            _isNew: !r.found,
            _isSelected: false,
            _isDirty: false,
            name: r.customer.name || '',
            phone: r.customer.phone,
            zipcode: r.customer.zipcode || '',
            address: r.customer.address || '',
            detail_address: r.customer.detail_address || '',
          }));

        if (newRows.length === 0) {
          setStatus({ type: 'info', message: '모든 전화번호가 이미 그리드에 있습니다.' });
        } else {
          setGridRowsAndSync(prev => [...prev, ...newRows]);
          const foundCount = newRows.filter(r => !r._isNew).length;
          const newCount = newRows.filter(r => r._isNew).length;
          setStatus({
            type: 'success',
            message: `${newRows.length}건 추가 (기존 ${foundCount}건, 신규 ${newCount}건)`
          });
        }
      }
    } catch (error) {
      console.error(error);
      setStatus({ type: 'error', message: 'DB 매칭 중 오류가 발생했습니다.' });
    } finally {
      setIsMatchLoading(false);
    }
  }, [gridRows]);

  // ──────────────────────────────────────────────────────
  // [그리드 → 폼] 행 클릭 시 데이터를 상단 폼에 로드
  // ──────────────────────────────────────────────────────
  const handleRowSelect = (row: GridRow) => {
    setActiveRowId(row._tempId);
    setPhone(row.phone);
    setName(row.name);
    setZipcode(row.zipcode);
    setAddress(row.address);
    setDetailAddress(row.detail_address);
    setIsExistingCustomer(!row._isNew);
    setStatus({ type: 'info', message: `[${row.phone}] 행이 선택됨 — 수정 후 [저장] 버튼을 누르세요.` });
    
    // 폼 업데이트 후 스크롤이 확실히 동작하도록 setTimeout 사용
    setTimeout(() => {
      document.getElementById('top-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  };

  // ──────────────────────────────────────────────────────
  // [폼 저장] 폼 데이터를 그리드에 반영
  // 왜 DB에 바로 안 저장하나: 사용자 요구 - 내보내기 시에만 일괄 저장
  // ──────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!phone) {
      setStatus({ type: 'error', message: '전화번호는 필수 항목입니다.' });
      return;
    }

    const normalizedPhone = phone.replace(/[^0-9]/g, '');
    const savedRowId = activeRowId; // 수정 완료 후 원래 위치로 스크롤하기 위해 임시 보관

    if (activeRowId) {
      // 기존 그리드 행 수정 (덮어쓰기)
      setGridRowsAndSync(prev => prev.map(row => {
        if (row._tempId === activeRowId) {
          return {
            ...row,
            name,
            phone: normalizedPhone,
            zipcode,
            address,
            detail_address: detailAddress,
            _isDirty: true, // 수정됨 표시
          };
        }
        return row;
      }));
      setStatus({ type: 'success', message: '그리드에 수정 사항이 반영되었습니다.' });
    } else {
      // 새 행 추가 (그리드에 없는 경우)
      // 중복 전화번호 체크
      const exists = gridRows.some(r => r.phone === normalizedPhone);
      if (exists) {
        setStatus({ type: 'error', message: '이미 그리드에 같은 전화번호가 있습니다. 해당 행을 클릭하여 수정하세요.' });
        return;
      }

      const newRow: GridRow = {
        _tempId: generateTempId(),
        _isNew: !isExistingCustomer,
        _isSelected: false,
        _isDirty: false,
        name,
        phone: normalizedPhone,
        zipcode,
        address,
        detail_address: detailAddress,
      };
      setGridRowsAndSync(prev => [...prev, newRow]);
      setStatus({ type: 'success', message: '그리드에 새 고객이 추가되었습니다.' });
    }

    // 폼 초기화 + 행 선택 해제
    resetForm();

    // 수정이었던 경우 원래 있던 행 위치로 다시 스크롤 이동
    if (savedRowId) {
      setTimeout(() => {
        document.getElementById(`row-${savedRowId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 50);
    }
  };

  /** 폼 입력 초기화 */
  const resetForm = () => {
    setPhone('');
    setName('');
    setZipcode('');
    setAddress('');
    setDetailAddress('');
    setActiveRowId(null);
    setIsExistingCustomer(false);
  };

  // ──────────────────────────────────────────────────────
  // [그리드 행 삭제]
  // ──────────────────────────────────────────────────────
  const handleRowDelete = (tempIds: string[]) => {
    setGridRowsAndSync(prev => prev.filter(r => !tempIds.includes(r._tempId)));
    setCheckedIds(prev => {
      const next = new Set(prev);
      tempIds.forEach(id => next.delete(id));
      return next;
    });
    // 삭제된 행이 현재 편집 중이면 폼 초기화
    if (activeRowId && tempIds.includes(activeRowId)) {
      resetForm();
    }
    setStatus({ type: 'info', message: `${tempIds.length}건이 삭제되었습니다.` });
  };

  // ──────────────────────────────────────────────────────
  // [체크박스 관리]
  // ──────────────────────────────────────────────────────
  const handleCheckToggle = (tempId: string) => {
    setCheckedIds(prev => {
      const next = new Set(prev);
      if (next.has(tempId)) next.delete(tempId);
      else next.add(tempId);
      return next;
    });
  };

  const handleCheckAll = () => {
    if (checkedIds.size === gridRows.length) {
      setCheckedIds(new Set());
    } else {
      setCheckedIds(new Set(gridRows.map(r => r._tempId)));
    }
  };

  // ──────────────────────────────────────────────────────
  // [엑셀 내보내기] DB 일괄 저장 + 한진택배 엑셀 생성
  // 왜 여기서 DB 저장: 사용자가 그리드 데이터를 최종 확인한 후에만 저장하여 입력 오류 방지
  // ──────────────────────────────────────────────────────
  const handleExport = async () => {
    // 유효한 행만 (이름 + 전화번호 있는 것)
    const validRows = gridRows.filter(r => r.name && r.phone);

    if (validRows.length === 0) {
      setStatus({ type: 'error', message: '내보내기할 유효한 데이터가 없습니다. 이름을 입력해주세요.' });
      return;
    }

    // 이름 미입력 행이 있으면 경고
    const incompleteRows = gridRows.filter(r => r.phone && !r.name);
    if (incompleteRows.length > 0) {
      const proceed = window.confirm(
        `이름이 비어있는 행이 ${incompleteRows.length}건 있습니다.\n해당 행은 건너뛰고 나머지만 내보내기할까요?`
      );
      if (!proceed) return;
    }

    setIsExporting(true);
    setStatus({ type: '', message: '' });

    try {
      const customers = validRows.map(r => ({
        name: r.name,
        phone: r.phone,
        zipcode: r.zipcode,
        address: r.address,
        detail_address: r.detail_address,
      }));

      const response = await axios.post(`${API_URL}/customers/bulk-save-and-export`, { customers });

      if (response.data.success) {
        setStatus({
          type: 'success',
          message: `✅ ${response.data.message} — 엑셀 파일 다운로드가 시작됩니다.`
        });

        // 엑셀 파일 다운로드 트리거
        if (response.data.excelPath) {
          window.location.href = `${API_URL}/download?path=${encodeURIComponent(response.data.excelPath)}`;
        }

        // 내보내기 성공 후 그리드 초기화
        setGridRowsAndSync([]);
        setCheckedIds(new Set());
        resetForm();
      }
    } catch (error: any) {
      console.error(error);
      const backendMsg = error.response?.data?.error || '일괄 저장/내보내기 실패.';
      setStatus({ type: 'error', message: backendMsg });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 py-6 px-4">
      <div className="w-full max-w-5xl mx-auto space-y-4">

        {/* ═══════════════════════════════════════════ */}
        {/* 헤더 */}
        {/* ═══════════════════════════════════════════ */}
        <div className="text-center">
          <div className="inline-flex items-center gap-3 bg-white rounded-2xl shadow-lg px-6 py-4 border border-slate-200">
            <Package size={32} className="text-blue-600" />
            <div className="text-left">
              <h1 className="text-xl font-bold text-slate-800 tracking-tight">한진택배 고객 배송지 입력기</h1>
              <p className="text-xs text-slate-500">카카오톡 텍스트 → 자동 인식 → 확인 → 엑셀 내보내기</p>
            </div>
          </div>
        </div>

        {/* ═══════════════════════════════════════════ */}
        {/* 1단계: 카카오톡 텍스트 파서 */}
        {/* ═══════════════════════════════════════════ */}
        <KakaoTextParser
          onMatchRequest={handleBulkMatch}
          isLoading={isMatchLoading}
        />

        {/* ═══════════════════════════════════════════ */}
        {/* 2단계: 고객 정보 입력 폼 */}
        {/* ═══════════════════════════════════════════ */}
        <div id="top-form" className="bg-white rounded-2xl shadow-lg border border-slate-200 overflow-hidden">
          {/* 폼 헤더 */}
          <div className="px-5 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Save size={18} />
              <span className="font-bold text-sm">
                {activeRowId ? '📝 행 수정 모드' : '➕ 신규 입력'}
              </span>
            </div>
            {activeRowId && (
              <button
                onClick={resetForm}
                className="text-xs bg-white/20 hover:bg-white/30 px-3 py-1 rounded-lg transition font-medium"
              >
                선택 해제 (신규 입력으로)
              </button>
            )}
          </div>

          {/* 상태 메시지 */}
          {status.message && (
            <div className={`px-5 py-2.5 text-xs font-semibold flex items-center gap-2 ${
              status.type === 'success' ? 'bg-green-50 text-green-700' :
              status.type === 'error' ? 'bg-red-50 text-red-700' :
              'bg-blue-50 text-blue-700'
            }`}>
              {status.type === 'error' ? <AlertCircle size={14} /> : <CheckCircle size={14} />}
              {status.message}
            </div>
          )}

          {/* 폼 본체 */}
          <form onSubmit={handleSubmit} className="p-5 space-y-4">
            {/* 전화번호 + 이름 (한 줄) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                  전화번호 <span className="text-red-500">*</span>
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={phone}
                    onChange={(e) => {
                      setPhone(e.target.value.replace(/[^0-9-]/g, ''));
                      setIsExistingCustomer(false);
                    }}
                    placeholder="010-0000-0000"
                    className="flex-1 rounded-lg border-slate-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 border p-2.5 text-sm"
                    onBlur={searchCustomer}
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), searchCustomer())}
                    required
                  />
                  <button
                    type="button"
                    onClick={searchCustomer}
                    disabled={isLoading}
                    className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-2.5 rounded-lg font-medium flex items-center gap-1.5 transition text-sm"
                  >
                    <Search size={15} />
                    검색
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                  이름 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="고객명 (태국어/영문/한글)"
                  className="w-full rounded-lg border-slate-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 border p-2.5 text-sm"
                />
              </div>
            </div>

            {/* 주소 검색 */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">주소</label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {/* 좌측: 기본 주소 검색 */}
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={zipcode}
                    readOnly
                    placeholder="우편번호"
                    className="w-20 rounded-lg border-slate-300 shadow-sm bg-slate-50 border p-2.5 text-sm text-slate-600"
                  />
                  <input
                    type="text"
                    value={address}
                    readOnly
                    placeholder="기본 주소"
                    className="flex-1 rounded-lg border-slate-300 shadow-sm bg-slate-50 border p-2.5 text-sm text-slate-600"
                  />
                  <button
                    onClick={handleOpenPostcode}
                    className="bg-blue-50 hover:bg-blue-100 text-blue-700 px-3 py-2.5 rounded-lg font-semibold flex items-center gap-1.5 transition border border-blue-200 text-sm whitespace-nowrap"
                  >
                    <MapPin size={15} />
                    검색
                  </button>
                </div>
                {/* 우측: 상세 주소 입력 */}
                <input
                  type="text"
                  value={detailAddress}
                  onChange={(e) => setDetailAddress(e.target.value)}
                  placeholder="상세 주소 (동, 호수 등 직접 입력)"
                  className="w-full rounded-lg border-slate-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 border p-2.5 text-sm"
                />
              </div>
            </div>

            {/* 저장 버튼 */}
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={isLoading}
                className={`flex-1 font-bold py-3 rounded-xl shadow-md transition flex justify-center items-center gap-2 text-sm ${
                  activeRowId
                    ? 'bg-amber-500 hover:bg-amber-600 text-white shadow-amber-200'
                    : 'bg-blue-600 hover:bg-blue-700 text-white shadow-blue-200'
                }`}
              >
                {activeRowId ? (
                  <><Save size={18} /> 그리드 수정</>
                ) : (
                  <><Plus size={18} /> 그리드에 추가</>
                )}
              </button>
            </div>
          </form>
        </div>

        {/* ═══════════════════════════════════════════ */}
        {/* 3단계: 인라인 엑셀 그리드 (데이터 확인 + 내보내기) */}
        {/* ═══════════════════════════════════════════ */}
        <ShippingGrid
          rows={gridRows}
          activeRowId={activeRowId}
          onRowSelect={handleRowSelect}
          onRowDelete={handleRowDelete}
          onExport={handleExport}
          isExporting={isExporting}
          checkedIds={checkedIds}
          onCheckToggle={handleCheckToggle}
          onCheckAll={handleCheckAll}
        />
      </div>
    </div>
  );
}

export default App;
