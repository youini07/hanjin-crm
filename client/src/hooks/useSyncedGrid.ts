import { useState, useCallback, useEffect } from 'react';
import axios from 'axios';
import { API_URL, socket, type StatusMessage } from '../config/api';
import type { GridRow } from '../components/ShippingGrid';

export type GridChannel = 'kakao' | 'grip';

interface UseSyncedGridOptions {
  channel: GridChannel;
  onStatusChange: (status: StatusMessage) => void;
  onResetSelection: () => void;
}

/**
 * 페이지별(카카오톡 / 그립) 독립 그리드 상태 및 실시간 웹소켓 동기화 훅
 * 왜: 카카오톡 주문과 그립 엑셀 주문 페이지를 분리하면서,
 * 두 페이지의 배송 리스트가 서로 섞이지 않고 각각 독립적으로 동기화/내보내기 되도록 모듈화함
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

    // 페이지를 전환해 마운트될 때 서버에 보관된 해당 페이지의 최신 그리드 목록을 즉시 요청
    socket.emit(requestEmitEvent);

    return () => {
      socket.off(initEvent, handleSyncRows);
      socket.off(updatedEvent, handleSyncRows);
    };
  }, [initEvent, updatedEvent, requestEmitEvent]);

  /**
   * 로컬 그리드 상태를 변경함과 동시에 다른 접속 기기에도 해당 채널의 변경사항 전파
   */
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

  /** 개별 행 택배 수량 변경 */
  const handleQuantityChange = useCallback(
    (tempId: string, qty: number) => {
      setGridRowsAndSync((prev) =>
        prev.map((r) => (r._tempId === tempId ? { ...r, quantity: qty } : r))
      );
    },
    [setGridRowsAndSync]
  );

  /** 개별 체크박스 토글 */
  const handleCheckToggle = useCallback((tempId: string) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(tempId)) next.delete(tempId);
      else next.add(tempId);
      return next;
    });
  }, []);

  /** 전체 체크박스 선택/해제 */
  const handleCheckAll = useCallback(() => {
    setCheckedIds((prev) => {
      if (prev.size === gridRows.length && gridRows.length > 0) {
        return new Set();
      }
      return new Set(gridRows.map((r) => r._tempId));
    });
  }, [gridRows]);

  /**
   * DB 일괄 저장 및 한진택배 양식 엑셀 다운로드
   * 왜: 카카오톡 모드에서는 기존 방식 그대로 H열에 전화번호가 자동 기입되도록 item_memo를 보내지 않고,
   * 그립 모드에서만 추출된 구매상품 요약(item_memo)을 전달하여 각 페이지의 비즈니스 규칙을 명확히 분리함
   */
  const handleExport = useCallback(async () => {
    const validRows = gridRows.filter((r) => r.name && r.phone);

    if (validRows.length === 0) {
      onStatusChange({
        type: 'error',
        message: '내보내기할 유효한 데이터가 없습니다. 이름을 입력해주세요.',
      });
      return;
    }

    const incompleteRows = gridRows.filter((r) => r.phone && !r.name);
    if (incompleteRows.length > 0) {
      const proceed = window.confirm(
        `이름이 비어있는 행이 ${incompleteRows.length}건 있습니다.\n해당 행은 건너뛰고 나머지만 내보내기할까요?`
      );
      if (!proceed) return;
    }

    setIsExporting(true);
    onStatusChange({ type: '', message: '' });

    try {
      const customers = validRows.map((r) => ({
        name: r.name,
        phone: r.phone,
        zipcode: r.zipcode,
        address: r.address,
        detail_address: r.detail_address,
        item_memo: channel === 'grip' ? r.item_memo || '' : '',
        quantity: r.quantity || 1,
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

        // 내보내기 완료 후 현재 페이지 그리드 초기화
        setGridRowsAndSync([]);
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
    handleQuantityChange,
    handleCheckToggle,
    handleCheckAll,
    handleExport,
  };
}
