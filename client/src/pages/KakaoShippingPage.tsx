import { useState, useCallback, useMemo } from 'react';
import axios from 'axios';
import KakaoTextParser, { type AiParsedSummary } from '../components/KakaoTextParser';
import CustomerForm from '../components/CustomerForm';
import ShippingGrid, {
  type GridRow,
  type ReviewStatus,
  type AddressPendingType,
  type PrevDbCustomerInfo,
} from '../components/ShippingGrid';
import {
  API_URL,
  generateTempId,
  normalizeClientPhone,
  normalizeClientZipcode,
  type StatusMessage,
} from '../config/api';
import { useSyncedGrid } from '../hooks/useSyncedGrid';

interface BulkMatchResultItem {
  phone: string;
  found: boolean;
  customer: {
    name?: string;
    phone: string;
    zipcode?: string;
    address?: string;
    detail_address?: string;
  };
}

interface AiParsedItemFromServer {
  phone: string;
  name: string;
  zipcode: string;
  address: string;
  detail_address: string;
  quantity?: number;
  _fbName?: string;
  _fbUpdated?: boolean;
  _isNew: boolean;
  _reviewStatus: ReviewStatus;
  _namePending?: boolean;
  _addressPending?: AddressPendingType;
  _isConfirmed: boolean;
  _needsAddressCheck?: boolean;
  _zipcodeMissing?: boolean;
  _chatNameHint?: string;
  _aiNote?: string;
  _jibunAddress?: string;
  _prevDbInfo?: PrevDbCustomerInfo;
}

export default function KakaoShippingPage() {
  const [status, setStatus] = useState<StatusMessage>({ type: '', message: '' });
  const [isMatchLoading, setIsMatchLoading] = useState(false);
  const [activeRowId, setActiveRowId] = useState<string | null>(null);

  const handleResetSelection = useCallback(() => {
    setActiveRowId(null);
  }, []);

  const {
    gridRows,
    setGridRowsAndSync,
    checkedIds,
    isExporting,
    handleRowDelete,
    handleConfirmNameField,
    handleConfirmAddressField,
    handleConfirmRows,
    handleQuantityChange,
    handleCheckToggle,
    handleCheckAll,
    handleExport,
  } = useSyncedGrid({
    channel: 'kakao',
    onStatusChange: setStatus,
    onResetSelection: handleResetSelection,
  });

  const activeRow = useMemo(
    () => gridRows.find((r) => r._tempId === activeRowId) || null,
    [gridRows, activeRowId]
  );

  const existingPhones = useMemo(() => gridRows.map((r) => r.phone), [gridRows]);

  /** AI 대화 분석 후 셀 단위 변경 정보와 함께 그리드에 추가 (FB 아이디는 백그라운드 보관) */
  const handleAiParse = useCallback(
    async (rawText: string): Promise<AiParsedSummary | null> => {
      setIsMatchLoading(true);
      setStatus({ type: '', message: '' });

      try {
        const response = await axios.post(`${API_URL}/kakao/ai-parse`, { rawText });
        if (!response.data?.success) {
          setStatus({ type: 'error', message: 'AI 분석 결과를 받지 못했습니다.' });
          return null;
        }

        const items: AiParsedItemFromServer[] = response.data.items || [];
        const summary: AiParsedSummary = response.data.summary;

        if (items.length === 0) {
          setStatus({
            type: 'info',
            message: '붙여넣은 대화에서 인식된 고객 전화번호가 없습니다.',
          });
          return summary;
        }

        setGridRowsAndSync((prev) => {
          const existingSigSet = new Set(
            prev.map((r) => `${r.phone}::${r.address.replace(/\s+/g, '')}`)
          );

          const toAppend: GridRow[] = [];
          for (const item of items) {
            const normPhone = normalizeClientPhone(item.phone);
            const sig = `${normPhone}::${(item.address || '').replace(/\s+/g, '')}`;
            if (existingSigSet.has(sig)) continue;
            existingSigSet.add(sig);

            toAppend.push({
              _tempId: generateTempId('kakao'),
              _isNew: item._isNew,
              _isSelected: false,
              _isDirty: item._reviewStatus === 'MODIFIED',
              _reviewStatus: item._reviewStatus,
              _namePending: Boolean(item._namePending),
              _addressPending: item._addressPending ?? null,
              _isConfirmed: item._isConfirmed,
              _needsAddressCheck: Boolean(item._needsAddressCheck),
              _zipcodeMissing: Boolean(item._zipcodeMissing),
              _chatNameHint: item._chatNameHint || '',
              _aiNote: item._aiNote || '',
              _jibunAddress: item._jibunAddress || '',
              _fbName: item._fbName || '',
              _fbUpdated: Boolean(item._fbUpdated),
              _prevDbInfo: item._prevDbInfo,
              name: item.name || '',
              phone: normPhone,
              zipcode: normalizeClientZipcode(item.zipcode),
              address: item.address || '',
              detail_address: item.detail_address || '',
              quantity: item.quantity || 1,
            });
          }

          return [...prev, ...toAppend];
        });

        const missingZip = summary.zipcodeMissingCount || 0;
        if (missingZip > 0) {
          setStatus({
            type: 'error',
            message: `분석 완료 (${summary.total}건) — 우편번호가 검색되지 않는 의심 주소 ${missingZip}건이 있습니다! 아래 빨간색 항목을 반드시 확인하세요.`,
          });
        } else if (summary.modified > 0) {
          setStatus({
            type: 'info',
            message: `분석 완료 (${summary.total}건): 기존일치 ${summary.matched} · 주소/이름 변경 ${summary.modified}건(확인 필요) · 신규 ${summary.newCount}`,
          });
        } else {
          setStatus({
            type: 'success',
            message: `분석 완료 (${summary.total}건): 기존일치 ${summary.matched} · 정보변경 ${summary.modified} · 신규 ${summary.newCount} · 사진확인 ${summary.photoCheck}`,
          });
        }

        return summary;
      } catch (error: unknown) {
        console.error('AI parse error:', error);
        const msg = axios.isAxiosError(error)
          ? error.response?.data?.error || 'AI 채팅 분석 중 오류가 발생했습니다.'
          : 'AI 채팅 분석 중 오류가 발생했습니다.';
        setStatus({ type: 'error', message: msg });
        return null;
      } finally {
        setIsMatchLoading(false);
      }
    },
    [setGridRowsAndSync]
  );

  /** 비상용: 전화번호만 정규식 추출하여 기존 DB 매칭 */
  const handleBulkMatch = useCallback(
    async (phones: string[]) => {
      setIsMatchLoading(true);
      setStatus({ type: '', message: '' });

      try {
        const response = await axios.post(`${API_URL}/customers/bulk-match`, { phones });

        if (response.data.success) {
          const results: BulkMatchResultItem[] = response.data.results;
          const existingPhoneSet = new Set(gridRows.map((r) => r.phone));

          const newRows: GridRow[] = results
            .filter((r) => !existingPhoneSet.has(r.phone))
            .map((r) => ({
              _tempId: generateTempId('kakao'),
              _isNew: !r.found,
              _isSelected: false,
              _isDirty: false,
              _reviewStatus: r.found ? 'MATCHED' : 'NO_ADDRESS',
              _namePending: false,
              _addressPending: r.found ? null : 'NEW_PHOTO',
              _isConfirmed: r.found,
              name: r.customer.name || '',
              phone: normalizeClientPhone(r.customer.phone),
              zipcode: normalizeClientZipcode(r.customer.zipcode),
              address: r.customer.address || '',
              detail_address: r.customer.detail_address || '',
              quantity: 1,
            }));

          if (newRows.length === 0) {
            setStatus({ type: 'info', message: '모든 전화번호가 이미 그리드에 있습니다.' });
          } else {
            setGridRowsAndSync((prev) => [...prev, ...newRows]);
            const foundCount = newRows.filter((r) => !r._isNew).length;
            const newCount = newRows.filter((r) => r._isNew).length;
            setStatus({
              type: 'success',
              message: `${newRows.length}건 추가 (기존 ${foundCount}건, 신규 ${newCount}건)`,
            });
          }
        }
      } catch (error) {
        console.error('Bulk match error:', error);
        setStatus({ type: 'error', message: 'DB 매칭 중 오류가 발생했습니다.' });
      } finally {
        setIsMatchLoading(false);
      }
    },
    [gridRows, setGridRowsAndSync]
  );

  const handleRowSelect = useCallback((row: GridRow) => {
    setActiveRowId(row._tempId);
    setStatus({
      type: 'info',
      message: `[${row.phone}] 행 선택됨 — 수정 후 [그리드 수정 & 확인 완료]를 누르세요.`,
    });

    setTimeout(() => {
      document.getElementById('top-form')?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    }, 50);
  }, []);

  const handleAddNewRow = useCallback(
    (data: {
      phone: string;
      name: string;
      zipcode: string;
      address: string;
      detail_address: string;
      isExistingCustomer: boolean;
    }) => {
      const newRow: GridRow = {
        _tempId: generateTempId('kakao'),
        _isNew: !data.isExistingCustomer,
        _isSelected: false,
        _isDirty: true,
        _reviewStatus: data.isExistingCustomer ? 'MODIFIED' : 'NEW',
        _namePending: false,
        _addressPending: null,
        _isConfirmed: true,
        _needsAddressCheck: false,
        _zipcodeMissing: false,
        name: data.name,
        phone: normalizeClientPhone(data.phone),
        zipcode: normalizeClientZipcode(data.zipcode),
        address: data.address,
        detail_address: data.detail_address,
        quantity: 1,
      };
      setGridRowsAndSync((prev) => [...prev, newRow]);
    },
    [setGridRowsAndSync]
  );

  /** 상단 폼에서 수정 시 이름·주소 대기 플래그를 모두 해제하고 확인 완료 처리 */
  const handleUpdateRow = useCallback(
    (
      tempId: string,
      data: {
        phone: string;
        name: string;
        zipcode: string;
        address: string;
        detail_address: string;
      }
    ) => {
      setGridRowsAndSync((prev) =>
        prev.map((row) => {
          if (row._tempId !== tempId) return row;
          return {
            ...row,
            name: data.name,
            phone: normalizeClientPhone(data.phone),
            zipcode: normalizeClientZipcode(data.zipcode),
            address: data.address,
            detail_address: data.detail_address,
            _isDirty: true,
            _namePending: false,
            _addressPending: null,
            _isConfirmed: true,
            _needsAddressCheck: false,
            _zipcodeMissing: false,
          };
        })
      );
    },
    [setGridRowsAndSync]
  );

  return (
    <div className="space-y-4">
      <KakaoTextParser
        onAiParseRequest={handleAiParse}
        onMatchRequest={handleBulkMatch}
        isLoading={isMatchLoading}
      />

      <CustomerForm
        key={activeRow?._tempId ?? 'new-kakao'}
        activeRow={activeRow}
        existingPhones={existingPhones}
        status={status}
        onStatusChange={setStatus}
        onAddNewRow={handleAddNewRow}
        onUpdateRow={handleUpdateRow}
        onCancelEdit={handleResetSelection}
      />

      <ShippingGrid
        mode="kakao"
        rows={gridRows}
        activeRowId={activeRowId}
        onRowSelect={handleRowSelect}
        onRowDelete={(ids) => handleRowDelete(ids, activeRowId)}
        onConfirmNameField={handleConfirmNameField}
        onConfirmAddressField={handleConfirmAddressField}
        onConfirmRows={handleConfirmRows}
        onExport={handleExport}
        isExporting={isExporting}
        checkedIds={checkedIds}
        onCheckToggle={handleCheckToggle}
        onCheckAll={handleCheckAll}
        onQuantityChange={handleQuantityChange}
      />
    </div>
  );
}
