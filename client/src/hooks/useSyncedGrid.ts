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

  /**
   * [주소 칸] 단독 수정/확인 승인 또는 기존 DB 주소 유지
   * 왜 5자리 우편번호 검사를 추가했는가:
   * 고객이 없는 번지(예: 29 대신 27)를 보내 우편번호가 검색되지 않았는데
   * 무심코 [수정]을 눌러 한진택배 오류행이 발생하고 기존 DB 정상 주소까지 망가지는 사고를 원천 방지하기 위함.
   */
  const handleConfirmAddressField = useCallback(
    (tempId: string, keepOldDb = false) => {
      const targetRow = gridRows.find((r) => r._tempId === tempId);
      if (targetRow && !keepOldDb) {
        const nextZip = normalizeClientZipcode(targetRow.zipcode);
        if (!/^\d{5}$/.test(nextZip)) {
          const warnMsg =
            '🚨 우편번호가 검색되지 않는 주소입니다! (없는 번지이거나 오타일 수 있습니다)\n\n• 고객 오타라면 [기존 DB 유지] 버튼을 누르시거나,\n• 실제 새 주소라면 해당 행을 클릭해 상단 [주소검색]으로 정확한 5자리 우편번호를 선택해주세요.';
          onStatusChange({
            type: 'error',
            message:
              '우편번호가 없는 미검증 주소입니다. [기존 DB 유지] 또는 상단 [주소검색]을 이용해주세요.',
          });
          window.alert(warnMsg);
          return;
        }
      }

      setGridRowsAndSync((prev) =>
        prev.map((row) => {
          if (row._tempId !== tempId) return row;
          const usePrev = keepOldDb && row._prevDbInfo?.address;
          const resolvedZip = usePrev
            ? normalizeClientZipcode(row._prevDbInfo!.zipcode)
            : normalizeClientZipcode(row.zipcode);
          const stillHasNamePending = Boolean(row._namePending);
          return {
            ...row,
            zipcode: resolvedZip,
            address: usePrev ? row._prevDbInfo!.address : row.address,
            detail_address: usePrev ? row._prevDbInfo!.detail_address : row.detail_address,
            _isDirty: usePrev ? Boolean(row._namePending) : row._isDirty,
            _addressPending: null,
            _needsAddressCheck: false,
            _zipcodeMissing: !/^\d{5}$/.test(resolvedZip),
            _isConfirmed: !stillHasNamePending,
          };
        })
      );
    },
    [gridRows, setGridRowsAndSync, onStatusChange]
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

      const targetId = unconfirmedWithAddr[0]._tempId;
      const mobileCard = document.getElementById(`card-${targetId}`);
      const desktopRow = document.getElementById(`row-${targetId}`);
      const firstTarget =
        mobileCard && mobileCard.offsetParent !== null ? mobileCard : desktopRow;
      firstTarget?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    // 2단계 검증: 주소는 입력되어 있으나 5자리 우편번호가 없는 오류 주소 행 점검
    const missingZipRows = gridRows.filter(
      (r) =>
        r.address.trim() !== '' &&
        !/^\d{5}$/.test(normalizeClientZipcode(r.zipcode))
    );

    if (missingZipRows.length > 0) {
      const targetId = missingZipRows[0]._tempId;
      const mobileCard = document.getElementById(`card-${targetId}`);
      const desktopRow = document.getElementById(`row-${targetId}`);
      const firstTarget =
        mobileCard && mobileCard.offsetParent !== null ? mobileCard : desktopRow;
      firstTarget?.scrollIntoView({ behavior: 'smooth', block: 'center' });

      const readyWithZipCount = gridRows.filter(
        (r) =>
          r.name.trim() &&
          r.phone.trim() &&
          r.address.trim() &&
          /^\d{5}$/.test(normalizeClientZipcode(r.zipcode)) &&
          !hasRowPendingAction(r)
      ).length;

      if (readyWithZipCount === 0) {
        const errMsg = `🚨 5자리 우편번호가 없는 주소가 ${missingZipRows.length}건 있습니다!\n(한진택배 업로드 시 오류행이 발생합니다. 빨간색 행을 눌러 [주소검색] 또는 [기존 DB 유지]로 해결해주세요.)`;
        onStatusChange({ type: 'error', message: errMsg.replace('\n', ' ') });
        window.alert(errMsg);
        return;
      }

      const skipMissingZip = window.confirm(
        `🚨 우편번호가 없는 의심 주소가 ${missingZipRows.length}건 있습니다! (그대로 출력하면 한진택배에서 오류행이 됩니다)\n\n우편번호 없는 ${missingZipRows.length}건은 목록에 남겨두고, 정상 확인된 ${readyWithZipCount}건만 먼저 엑셀로 출력할까요?`
      );
      if (!skipMissingZip) {
        onStatusChange({
          type: 'error',
          message: '빨간색으로 표시된 우편번호 미검색 행을 먼저 확인·수정해주세요.',
        });
        return;
      }
    }

    const validRows = gridRows.filter(
      (r) =>
        r.name.trim() &&
        r.phone.trim() &&
        r.address.trim() &&
        /^\d{5}$/.test(normalizeClientZipcode(r.zipcode)) &&
        !hasRowPendingAction(r)
    );

    if (validRows.length === 0) {
      onStatusChange({
        type: 'error',
        message: '내보내기할 유효한 배송 데이터(우편번호·주소 필수)가 없습니다.',
      });
      return;
    }

    const noAddressRows = gridRows.filter((r) => !r.name.trim() || !r.address.trim());
    if (noAddressRows.length > 0) {
      const proceed = window.confirm(
        `주소가 비어있는 신규 사진 주문 등이 ${noAddressRows.length}건 있습니다.\n해당 행은 남겨두고 확인 완료된 ${validRows.length}건만 먼저 내보내기할까요?`
      );
      if (!proceed) return;
    }

    setIsExporting(true);
    onStatusChange({ type: '', message: '' });

    try {
      const exportedIdSet = new Set(validRows.map((r) => r._tempId));
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
          prev.filter((r) => !exportedIdSet.has(r._tempId))
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
