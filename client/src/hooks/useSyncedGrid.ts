import { useState, useCallback, useEffect } from 'react';
import axios from 'axios';
import {
  API_URL,
  socket,
  normalizeClientPhone,
  normalizeClientZipcode,
  type StatusMessage,
} from '../config/api';
import type { GridRow } from '../components/ShippingGrid';

export type GridChannel = 'kakao' | 'grip';

interface UseSyncedGridOptions {
  channel: GridChannel;
  onStatusChange: (status: StatusMessage) => void;
  onResetSelection: () => void;
}

const hasRowPendingAction = (row: GridRow): boolean =>
  Boolean(row._namePending || row._addressPending || row._isConfirmed === false);

/**
 * 페이지별 독립 그리드 상태, 셀 단위(이름/주소) 수정 승인 및 실시간 웹소켓 동기화 훅
 */
export function useSyncedGrid({
  channel,
  onStatusChange,
  onResetSelection,
}: UseSyncedGridOptions) {
  const [gridRows, setGridRows] = useState<GridRow[]>([]);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [isExporting, setIsExporting] = useState(false);

  const initEvent = channel === 'kakao' ? 'init_kakao_grid' : 'init_grip_grid';
  const updatedEvent = channel === 'kakao' ? 'kakao_grid_updated' : 'grip_grid_updated';
  const updateEmitEvent = channel === 'kakao' ? 'update_kakao_grid' : 'update_grip_grid';
  const requestEmitEvent = channel === 'kakao' ? 'request_kakao_grid' : 'request_grip_grid';

  useEffect(() => {
    const handleSyncRows = (rows: GridRow[]) => {
      setGridRows(Array.isArray(rows) ? rows : []);
    };

    socket.on(initEvent, handleSyncRows);
    socket.on(updatedEvent, handleSyncRows);
    socket.emit(requestEmitEvent);

    return () => {
      socket.off(initEvent, handleSyncRows);
      socket.off(updatedEvent, handleSyncRows);
    };
  }, [initEvent, updatedEvent, requestEmitEvent]);

  const setGridRowsAndSync = useCallback(
    (updater: React.SetStateAction<GridRow[]>) => {
      setGridRows((prev) => {
        const nextRows = typeof updater === 'function' ? updater(prev) : updater;
        socket.emit(updateEmitEvent, nextRows);
        return nextRows;
      });
    },
    [updateEmitEvent]
  );

  /** 선택된 행들을 그리드에서 제거 */
  const handleRowDelete = useCallback(
    (tempIds: string[], activeRowId: string | null) => {
      setGridRowsAndSync((prev) => prev.filter((r) => !tempIds.includes(r._tempId)));
      setCheckedIds((prev) => {
        const next = new Set(prev);
        tempIds.forEach((id) => next.delete(id));
        return next;
      });

      if (activeRowId && tempIds.includes(activeRowId)) {
        onResetSelection();
      }
      onStatusChange({ type: 'info', message: `${tempIds.length}건이 삭제되었습니다.` });
    },
    [setGridRowsAndSync, onResetSelection, onStatusChange]
  );

  /** [이름 칸] 단독 수정 승인 또는 기존 이름 유지 */
  const handleConfirmNameField = useCallback(
    (tempId: string, keepOldDb = false) => {
      setGridRowsAndSync((prev) =>
        prev.map((row) => {
          if (row._tempId !== tempId) return row;
          const nextName =
            keepOldDb && row._prevDbInfo?.name ? row._prevDbInfo.name : row.name;
          const stillHasAddrPending = Boolean(row._addressPending);
          return {
            ...row,
            name: nextName,
            _isDirty: keepOldDb ? row._isDirty : true,
            _namePending: false,
            _isConfirmed: !stillHasAddrPending,
          };
        })
      );
    },
    [setGridRowsAndSync]
  );

  /** [주소 칸] 단독 수정/확인 승인 또는 기존 DB 주소 유지 */
  const handleConfirmAddressField = useCallback(
    (tempId: string, keepOldDb = false) => {
      setGridRowsAndSync((prev) =>
        prev.map((row) => {
          if (row._tempId !== tempId) return row;
          const usePrev = keepOldDb && row._prevDbInfo?.address;
          const stillHasNamePending = Boolean(row._namePending);
          return {
            ...row,
            zipcode: usePrev
              ? normalizeClientZipcode(row._prevDbInfo!.zipcode)
              : row.zipcode,
            address: usePrev ? row._prevDbInfo!.address : row.address,
            detail_address: usePrev ? row._prevDbInfo!.detail_address : row.detail_address,
            _isDirty: usePrev ? Boolean(row._namePending) : row._isDirty,
            _addressPending: null,
            _needsAddressCheck: false,
            _isConfirmed: !stillHasNamePending,
          };
        })
      );
    },
    [setGridRowsAndSync]
  );

  /** 여러 행 한꺼번에 확인(승인) 처리 */
  const handleConfirmRows = useCallback(
    (tempIds: string[]) => {
      if (!tempIds || tempIds.length === 0) return;
      const targetSet = new Set(tempIds);
      setGridRowsAndSync((prev) =>
        prev.map((row) =>
          targetSet.has(row._tempId)
            ? {
                ...row,
                _namePending: false,
                _addressPending: null,
                _isConfirmed: true,
                _needsAddressCheck: false,
              }
            : row
        )
      );
      onStatusChange({
        type: 'success',
        message: `✅ ${tempIds.length}건이 확인 완료되었습니다.`,
      });
    },
    [setGridRowsAndSync, onStatusChange]
  );

  /** 개별 행 택배 수량 변경 */
  const handleQuantityChange = useCallback(
    (tempId: string, qty: number) => {
      setGridRowsAndSync((prev) =>
        prev.map((r) => (r._tempId === tempId ? { ...r, quantity: qty } : r))
      );
    },
    [setGridRowsAndSync]
  );

  const handleCheckToggle = useCallback((tempId: string) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(tempId)) next.delete(tempId);
      else next.add(tempId);
      return next;
    });
  }, []);

  const handleCheckAll = useCallback(() => {
    setCheckedIds((prev) => {
      if (prev.size === gridRows.length && gridRows.length > 0) {
        return new Set();
      }
      return new Set(gridRows.map((r) => r._tempId));
    });
  }, [gridRows]);

  /**
   * 모든 [수정]/[확인] 승인 검증 후 DB·구글시트(F열 FB 아이디 포함) 일괄 반영 및 한진 엑셀 내보내기
   */
  const handleExport = useCallback(async () => {
    const unconfirmedWithAddr = gridRows.filter(
      (r) => r.address.trim() !== '' && hasRowPendingAction(r)
    );

    if (unconfirmedWithAddr.length > 0) {
      const msg = `아직 [수정] 또는 [확인] 버튼을 누르지 않은 항목이 ${unconfirmedWithAddr.length}건 있습니다.\n바뀐 칸의 버튼을 눌러 확인하신 뒤 내보내기 해주세요.`;
      onStatusChange({ type: 'error', message: msg.replace('\n', ' ') });
      window.alert(msg);

      const firstTarget = document.getElementById(`row-${unconfirmedWithAddr[0]._tempId}`);
      firstTarget?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    const validRows = gridRows.filter(
      (r) => r.name.trim() && r.phone.trim() && r.address.trim() && !hasRowPendingAction(r)
    );

    if (validRows.length === 0) {
      onStatusChange({
        type: 'error',
        message: '내보내기할 유효한 배송 데이터가 없습니다. 이름과 주소를 확인해주세요.',
      });
      return;
    }

    const incompleteRows = gridRows.filter((r) => !r.name.trim() || !r.address.trim());
    if (incompleteRows.length > 0) {
      const proceed = window.confirm(
        `주소가 비어있는 신규 사진 주문 등이 ${incompleteRows.length}건 있습니다.\n해당 행은 남겨두고 확인 완료된 ${validRows.length}건만 먼저 내보내기할까요?`
      );
      if (!proceed) return;
    }

    setIsExporting(true);
    onStatusChange({ type: '', message: '' });

    try {
      const customers = validRows.map((r) => ({
        name: r.name.trim(),
        phone: normalizeClientPhone(r.phone),
        zipcode: normalizeClientZipcode(r.zipcode),
        address: r.address.trim(),
        detail_address: r.detail_address.trim(),
        fb_name: r._fbName || '',
        item_memo: channel === 'grip' ? r.item_memo || '' : '',
        quantity: r.quantity || 1,
        // 신규/수정되었거나 페이스북 아이디가 새로 갱신된 고객은 구글 시트(F열 포함)에 저장
        _shouldSaveToDb:
          channel === 'grip'
            ? true
            : Boolean(
                r._isNew ||
                  r._isDirty ||
                  r._fbUpdated ||
                  r._reviewStatus === 'NEW' ||
                  r._reviewStatus === 'MODIFIED'
              ),
      }));

      const response = await axios.post(`${API_URL}/customers/bulk-save-and-export`, {
        customers,
      });

      if (response.data.success) {
        onStatusChange({
          type: 'success',
          message: `✅ ${response.data.message} — 엑셀 파일 다운로드가 시작됩니다.`,
        });

        if (response.data.excelPath) {
          window.location.href = `${API_URL}/download?path=${encodeURIComponent(
            response.data.excelPath
          )}`;
        }

        setGridRowsAndSync((prev) =>
          prev.filter((r) => !r.name.trim() || !r.address.trim())
        );
        setCheckedIds(new Set());
        onResetSelection();
      }
    } catch (error: unknown) {
      console.error('Export Error:', error);
      const backendMsg = axios.isAxiosError(error)
        ? error.response?.data?.error || '일괄 저장/내보내기 중 오류가 발생했습니다.'
        : '일괄 저장/내보내기 중 오류가 발생했습니다.';
      onStatusChange({ type: 'error', message: backendMsg });
    } finally {
      setIsExporting(false);
    }
  }, [gridRows, channel, onStatusChange, setGridRowsAndSync, onResetSelection]);

  return {
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
  };
}
