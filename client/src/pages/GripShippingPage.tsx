import { useState, useCallback, useMemo } from 'react';
import GripExcelImporter, { type GripGroupedCustomer } from '../components/GripExcelImporter';
import CustomerForm from '../components/CustomerForm';
import ShippingGrid, { type GridRow } from '../components/ShippingGrid';
import { API_URL, generateTempId, type StatusMessage } from '../config/api';
import { useSyncedGrid } from '../hooks/useSyncedGrid';

/**
 * GripShippingPage - 그립(Grip) 판매내역서 엑셀 변환 전용 페이지
 *
 * 왜 별도 페이지로 구성했는가:
 * 그립 판매내역서 파일 업로드 및 동일 고객 합포장 추출 작업을 전용 공간에서 수행하여,
 * 카카오톡 주문 처리와 데이터가 섞이지 않도록 하고 입력 폼 UI도 동일하게 간결하게 유지함.
 */
export default function GripShippingPage() {
  const [status, setStatus] = useState<StatusMessage>({ type: '', message: '' });
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
    channel: 'grip',
    onStatusChange: setStatus,
    onResetSelection: handleResetSelection,
  });

  const activeRow = useMemo(
    () => gridRows.find((r) => r._tempId === activeRowId) || null,
    [gridRows, activeRowId]
  );

  const existingPhones = useMemo(() => gridRows.map((r) => r.phone), [gridRows]);

  /**
   * 그립 판매내역서에서 추출된 합포장 고객 리스트를 그리드에 반영
   * 왜: 이미 그리드에 동일 연락처가 있으면 중복 행을 만들지 않고 최신 주문 정보로 병합하여 이중 발송을 방지함
   */
  const handleImportGripCustomers = useCallback(
    (imported: GripGroupedCustomer[]) => {
      if (!imported || imported.length === 0) {
        setStatus({
          type: 'error',
          message: '추출된 고객 데이터가 없습니다. 파일 양식을 확인해주세요.',
        });
        return;
      }

      setGridRowsAndSync((prev) => {
        const updated = [...prev];
        const phoneIndexMap = new Map<string, number>();
        updated.forEach((r, idx) => {
          if (r.phone) phoneIndexMap.set(r.phone, idx);
        });

        for (const c of imported) {
          const existingIdx = c.phone ? phoneIndexMap.get(c.phone) : undefined;
          if (existingIdx !== undefined) {
            const prevRow = updated[existingIdx];
            updated[existingIdx] = {
              ...prevRow,
              order_number: c.order_number || prevRow.order_number,
              name: c.name || prevRow.name,
              zipcode: c.zipcode || prevRow.zipcode,
              address: c.address || prevRow.address,
              detail_address: c.detail_address || prevRow.detail_address,
              item_memo: c.item_memo || prevRow.item_memo,
              products: c.products || prevRow.products,
              _isDirty: true,
            };
          } else {
            const newRow: GridRow = {
              _tempId: generateTempId('grip'),
              _isNew: !c.foundInDb,
              _isSelected: false,
              _isDirty: false,
              order_number: c.order_number,
              name: c.name,
              phone: c.phone,
              zipcode: c.zipcode,
              address: c.address,
              detail_address: c.detail_address,
              item_memo: c.item_memo,
              products: c.products,
              quantity: c.quantity || 1,
            };
            updated.push(newRow);
            if (c.phone) phoneIndexMap.set(c.phone, updated.length - 1);
          }
        }

        return updated;
      });

      setStatus({
        type: 'success',
        message: `그립 판매내역서에서 동일 고객을 묶어 총 ${imported.length}건의 배송 리스트를 불러왔습니다.`,
      });
    },
    [setGridRowsAndSync]
  );

  /** 그리드 행 클릭 시 상단 폼 로드 */
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

  /** 상단 폼에서 신규 행 수동 추가 */
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
        _tempId: generateTempId('grip'),
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

  /** 상단 폼에서 기존 행 수정 (그립에서 추출된 주문번호/상품요약은 그대로 보존) */
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
      {/* 1단계: 그립 판매내역서 엑셀/CSV 업로더 */}
      <GripExcelImporter apiUrl={API_URL} onImportCustomers={handleImportGripCustomers} />

      {/* 2단계: 고객 배송지 수정/입력 폼 (불필요한 주문번호/비고 입력란 없이 깔끔한 기존 UI 유지) */}
      <CustomerForm
        key={activeRow?._tempId ?? 'new-grip'}
        activeRow={activeRow}
        existingPhones={existingPhones}
        status={status}
        onStatusChange={setStatus}
        onAddNewRow={handleAddNewRow}
        onUpdateRow={handleUpdateRow}
        onCancelEdit={handleResetSelection}
      />

      {/* 3단계: 그립 배송 데이터 확인 및 엑셀 내보내기 */}
      <ShippingGrid
        mode="grip"
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
