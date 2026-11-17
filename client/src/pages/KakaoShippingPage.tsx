import { useState, useCallback, useMemo } from 'react';
import axios from 'axios';
import KakaoTextParser from '../components/KakaoTextParser';
import CustomerForm from '../components/CustomerForm';
import ShippingGrid, { type GridRow } from '../components/ShippingGrid';
import { API_URL, generateTempId, type StatusMessage } from '../config/api';
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

/**
 * KakaoShippingPage - 카카오톡 텍스트 붙여넣기 전용 배송지 입력 페이지
 *
 * 왜 그립 페이지와 분리했는가:
 * 카카오톡 대화 복사로 주문을 처리할 때 그립 전용 UI(판매내역서 업로더, 주문번호, H열 품목명 등)가
 * 화면을 복잡하게 만들고 주소 확인 영역을 좁히는 문제를 해결하기 위해 독립 페이지로 구성함.
 */
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
    handleQuantityChange,
    handleCheckToggle,
    handleCheckAll,
    handleExport,
  } = useSyncedGrid({
    channel: 'kakao',
    onStatusChange: setStatus,
    onResetSelection: handleResetSelection,
  });

  // 현재 수정 중인 행 객체 조회
  const activeRow = useMemo(
    () => gridRows.find((r) => r._tempId === activeRowId) || null,
    [gridRows, activeRowId]
  );

  // 중복 전화번호 검사용 배열
  const existingPhones = useMemo(() => gridRows.map((r) => r.phone), [gridRows]);

  /**
   * 카카오톡 텍스트에서 추출한 전화번호 목록으로 DB 일괄 매칭 후 그리드에 추가
   */
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
              name: r.customer.name || '',
              phone: r.customer.phone,
              zipcode: r.customer.zipcode || '',
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

  /** 그리드 행 클릭 시 상단 폼으로 로드 및 스크롤 이동 */
  const handleRowSelect = useCallback((row: GridRow) => {
    setActiveRowId(row._tempId);
    setStatus({
      type: 'info',
      message: `[${row.phone}] 행이 선택됨 — 수정 후 [그리드 수정] 버튼을 누르세요.`,
    });

    setTimeout(() => {
      document.getElementById('top-form')?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    }, 50);
  }, []);

  /** 상단 폼에서 신규 고객 행 추가 */
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
        _isDirty: false,
        name: data.name,
        phone: data.phone,
        zipcode: data.zipcode,
        address: data.address,
        detail_address: data.detail_address,
        quantity: 1,
      };
      setGridRowsAndSync((prev) => [...prev, newRow]);
    },
    [setGridRowsAndSync]
  );

  /** 상단 폼에서 선택된 기존 행 수정 */
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
        prev.map((row) =>
          row._tempId === tempId
            ? {
                ...row,
                name: data.name,
                phone: data.phone,
                zipcode: data.zipcode,
                address: data.address,
                detail_address: data.detail_address,
                _isDirty: true,
              }
            : row
        )
      );
    },
    [setGridRowsAndSync]
  );

  return (
    <div className="space-y-4">
      {/* 1단계: 카카오톡 텍스트 붙여넣기 */}
      <KakaoTextParser onMatchRequest={handleBulkMatch} isLoading={isMatchLoading} />

      {/* 2단계: 고객 배송지 입력/수정 폼 (기존 카카오톡 UI 그대로 유지) */}
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

      {/* 3단계: 배송 데이터 확인 및 엑셀 내보내기 */}
      <ShippingGrid
        mode="kakao"
        rows={gridRows}
        activeRowId={activeRowId}
        onRowSelect={handleRowSelect}
        onRowDelete={(ids) => handleRowDelete(ids, activeRowId)}
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
