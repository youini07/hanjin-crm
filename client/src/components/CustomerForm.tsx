import { useState } from 'react';
import axios from 'axios';
import { useKakaoPostcodePopup, type Address } from 'react-daum-postcode';
import { Search, Save, CheckCircle, MapPin, Plus, AlertCircle } from 'lucide-react';
import { API_URL, type StatusMessage } from '../config/api';
import type { GridRow } from './ShippingGrid';

interface CustomerFormProps {
  /** 현재 선택되어 수정 중인 그리드 행 (없으면 신규 입력 모드) */
  activeRow: GridRow | null;
  /** 중복 추가 검사용 현재 그리드 내 전화번호 목록 */
  existingPhones: string[];
  /** 상단 알림 상태 메시지 */
  status: StatusMessage;
  onStatusChange: (status: StatusMessage) => void;
  /** 신규 행 그리드 추가 콜백 */
  onAddNewRow: (data: {
    phone: string;
    name: string;
    zipcode: string;
    address: string;
    detail_address: string;
    isExistingCustomer: boolean;
  }) => void;
  /** 선택된 기존 행 수정 반영 콜백 */
  onUpdateRow: (
    tempId: string,
    data: {
      phone: string;
      name: string;
      zipcode: string;
      address: string;
      detail_address: string;
    }
  ) => void;
  /** 행 선택 해제 콜백 */
  onCancelEdit: () => void;
}

/**
 * CustomerForm - 고객 배송지 단건 입력 및 선택 행 수정 폼
 *
 * 왜 기존 UI 구조를 유지하는가:
 * 그립 연동 과정에서 추가되었던 불필요한 수동 입력칸(주문번호, 비고/H열 품목명)이
 * 일상적인 배송지 확인·입력 동선을 방해하므로, 직관적인 기존 2단 구조(전화번호·이름 / 주소·상세주소)를 유지함.
 * 또한 기본주소와 상세주소 입력칸 비율을 넓혀 긴 주소도 한눈에 확인하고 수정할 수 있도록 개선함.
 * (부모에서 activeRow._tempId를 key로 전달받아 불필요한 useEffect 재렌더링 없이 초기값을 설정함)
 */
export default function CustomerForm({
  activeRow,
  existingPhones,
  status,
  onStatusChange,
  onAddNewRow,
  onUpdateRow,
  onCancelEdit,
}: CustomerFormProps) {
  const [phone, setPhone] = useState(() => activeRow?.phone || '');
  const [name, setName] = useState(() => activeRow?.name || '');
  const [zipcode, setZipcode] = useState(() => activeRow?.zipcode || '');
  const [address, setAddress] = useState(() => activeRow?.address || '');
  const [detailAddress, setDetailAddress] = useState(() => activeRow?.detail_address || '');
  const [isLoading, setIsLoading] = useState(false);
  const [isExistingCustomer, setIsExistingCustomer] = useState(() =>
    activeRow ? !activeRow._isNew : false
  );

  // 카카오 우편번호 검색 팝업 훅
  // 왜: 기존 t1.daumcdn.net 도메인 종료에 대비해 공식 신규 도메인(t1.kakaocdn.net) 유지
  const openPostcode = useKakaoPostcodePopup(
    'https://t1.kakaocdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js'
  );

  /** 카카오 주소검색 완료 시 기본주소 및 건물명 자동 조합 */
  const handlePostcodeComplete = (data: Address) => {
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

  const handleOpenPostcode = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    openPostcode({ onComplete: handlePostcodeComplete });
  };

  /**
   * 전화번호로 기존 DB 고객 검색
   * 왜: 재주문 고객의 경우 전화번호만 입력하면 주소까지 자동 완성하여 반복 타이핑을 줄임.
   * 단, 그리드 행 수정 모드(activeRow 존재)에서 아직 DB에 없는 신규 고객을 편집 중일 때는
   * 이미 입력된 이름/주소가 덮어써져 날아가지 않도록 기존 입력값을 보호함.
   */
  const searchCustomer = async () => {
    const normalizedPhone = phone.replace(/[^0-9]/g, '');
    if (!normalizedPhone || normalizedPhone.length < 10) return;

    setIsLoading(true);
    onStatusChange({ type: '', message: '' });

    try {
      const response = await axios.get(`${API_URL}/customers/search?phone=${normalizedPhone}`);

      if (response.data.success && response.data.customer) {
        const c = response.data.customer;
        setName(c.name || '');
        setZipcode(c.zipcode || '');
        setAddress(c.address || '');
        setDetailAddress(c.detail_address || '');
        setIsExistingCustomer(true);
        onStatusChange({ type: 'success', message: '기존 고객 정보가 자동 완성되었습니다.' });
      } else {
        if (!activeRow) {
          setName('');
          setZipcode('');
          setAddress('');
          setDetailAddress('');
        }
        setIsExistingCustomer(false);
        onStatusChange({ type: 'info', message: '신규 고객입니다. 나머지 정보를 입력해주세요.' });
      }
    } catch (error) {
      console.error('Customer search error:', error);
      onStatusChange({ type: 'error', message: '고객 검색 중 오류가 발생했습니다.' });
    } finally {
      setIsLoading(false);
    }
  };

  /** 폼 초기화 및 선택 해제 */
  const resetFields = () => {
    setPhone('');
    setName('');
    setZipcode('');
    setAddress('');
    setDetailAddress('');
    setIsExistingCustomer(false);
    onCancelEdit();
  };

  /**
   * 폼 제출 시 DB 즉시 저장 후 그리드에 반영
   * 왜: 작업 도중 브라우저를 닫더라도 수정/입력한 고객 주소가 유실되지 않도록 즉시 DB에 반영함
   */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!phone || !name.trim()) {
      onStatusChange({ type: 'error', message: '전화번호와 이름은 필수 항목입니다.' });
      return;
    }

    const normalizedPhone = phone.replace(/[^0-9]/g, '');

    // 신규 추가일 때 중복 전화번호 사전 검증 (불필요한 DB 호출 방지)
    if (!activeRow && existingPhones.includes(normalizedPhone)) {
      onStatusChange({
        type: 'error',
        message: '이미 그리드에 같은 전화번호가 있습니다. 아래 목록에서 해당 행을 클릭하여 수정하세요.',
      });
      return;
    }

    const savedRowId = activeRow?._tempId || null;

    try {
      await axios.post(`${API_URL}/customers/save`, {
        phone: normalizedPhone,
        name: name.trim(),
        zipcode,
        address,
        detail_address: detailAddress,
      });
    } catch (error) {
      console.error('Immediate save error:', error);
      onStatusChange({ type: 'error', message: 'DB 즉시 저장 중 오류가 발생했습니다.' });
      return;
    }

    if (activeRow) {
      onUpdateRow(activeRow._tempId, {
        phone: normalizedPhone,
        name: name.trim(),
        zipcode,
        address,
        detail_address: detailAddress,
      });
      onStatusChange({ type: 'success', message: '그리드에 수정 사항이 반영되었습니다.' });
    } else {
      onAddNewRow({
        phone: normalizedPhone,
        name: name.trim(),
        zipcode,
        address,
        detail_address: detailAddress,
        isExistingCustomer,
      });
      onStatusChange({ type: 'success', message: '그리드에 새 고객이 추가되었습니다.' });
    }

    resetFields();

    // 행 수정 완료 후에는 방금 수정한 그리드 행 위치로 부드럽게 복귀
    if (savedRowId) {
      setTimeout(() => {
        document.getElementById(`row-${savedRowId}`)?.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        });
      }, 50);
    }
  };

  return (
    <div id="top-form" className="bg-white rounded-2xl shadow-lg border border-slate-200 overflow-hidden">
      {/* 폼 헤더 */}
      <div className="px-5 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Save size={18} />
          <span className="font-bold text-sm">
            {activeRow ? '📝 행 수정 모드' : '➕ 신규 입력'}
          </span>
        </div>
        {activeRow && (
          <button
            type="button"
            onClick={resetFields}
            className="text-xs bg-white/20 hover:bg-white/30 px-3 py-1 rounded-lg transition font-medium"
          >
            선택 해제 (신규 입력으로)
          </button>
        )}
      </div>

      {/* 상태 알림 메시지 */}
      {status.message && (
        <div
          className={`px-5 py-2.5 text-xs font-semibold flex items-center gap-2 ${
            status.type === 'success'
              ? 'bg-green-50 text-green-700'
              : status.type === 'error'
                ? 'bg-red-50 text-red-700'
                : 'bg-blue-50 text-blue-700'
          }`}
        >
          {status.type === 'error' ? <AlertCircle size={14} /> : <CheckCircle size={14} />}
          {status.message}
        </div>
      )}

      {/* 폼 본체 (기존 카카오톡 입력 UI 그대로 유지 + 주소/상세주소 입력폭 확대) */}
      <form onSubmit={handleSubmit} className="p-5 space-y-4">
        {/* 1행: 전화번호 + 이름 */}
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
                className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-2.5 rounded-lg font-medium flex items-center gap-1.5 transition text-sm whitespace-nowrap"
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

        {/* 2행: 주소 + 상세주소 (12그리드 비율로 기본주소와 상세주소 모두 넓게 표시) */}
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1.5">주소</label>
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
            {/* 좌측(7칸): 우편번호 + 기본 주소 + 검색 버튼 */}
            <div className="md:col-span-7 flex gap-2">
              <input
                type="text"
                value={zipcode}
                readOnly
                placeholder="우편번호"
                className="w-24 rounded-lg border-slate-300 shadow-sm bg-slate-50 border p-2.5 text-sm text-slate-600 shrink-0"
              />
              <input
                type="text"
                value={address}
                readOnly
                placeholder="기본 주소"
                className="flex-1 min-w-0 rounded-lg border-slate-300 shadow-sm bg-slate-50 border p-2.5 text-sm text-slate-700"
              />
              <button
                type="button"
                onClick={handleOpenPostcode}
                className="bg-blue-50 hover:bg-blue-100 text-blue-700 px-3.5 py-2.5 rounded-lg font-semibold flex items-center gap-1.5 transition border border-blue-200 text-sm whitespace-nowrap shrink-0"
              >
                <MapPin size={15} />
                검색
              </button>
            </div>

            {/* 우측(5칸): 상세 주소 입력 */}
            <div className="md:col-span-5">
              <input
                type="text"
                value={detailAddress}
                onChange={(e) => setDetailAddress(e.target.value)}
                placeholder="상세 주소 (동, 호수 등 직접 입력)"
                className="w-full rounded-lg border-slate-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 border p-2.5 text-sm"
              />
            </div>
          </div>
        </div>

        {/* 저장 / 수정 버튼 */}
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={isLoading}
            className={`flex-1 font-bold py-3 rounded-xl shadow-md transition flex justify-center items-center gap-2 text-sm ${
              activeRow
                ? 'bg-amber-500 hover:bg-amber-600 text-white shadow-amber-200'
                : 'bg-blue-600 hover:bg-blue-700 text-white shadow-blue-200'
            }`}
          >
            {activeRow ? (
              <>
                <Save size={18} /> 그리드 수정
              </>
            ) : (
              <>
                <Plus size={18} /> 그리드에 추가
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
