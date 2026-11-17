import { io } from 'socket.io-client';

/**
 * 로컬 개발 환경인지 판별 (localhost 또는 내부 사설 IP 대역)
 * 왜: 로컬 개발 시에는 백엔드 포트(3001)로 직접 연결하고,
 * Railway 배포 환경에서는 동일 도메인 상대 경로('/api')를 사용해 혼합 콘텐츠(HTTPS) 문제를 방지하기 위함
 */
const isDev =
  window.location.hostname === 'localhost' ||
  window.location.hostname.startsWith('192.168.') ||
  window.location.hostname.startsWith('10.');

export const API_URL = isDev ? `http://${window.location.hostname}:3001/api` : '/api';

/**
 * 앱 전체에서 단일 웹소켓 연결을 공유
 * 왜: 카카오톡 페이지와 그립 페이지를 오갈 때마다 소켓을 새로 연결/해제하면
 * 불필요한 재연결 비용과 이벤트 중복이 발생하므로 싱글톤으로 유지함
 */
export const socket = isDev ? io(`http://${window.location.hostname}:3001`) : io();

/** 상태 알림 메시지 공통 타입 */
export interface StatusMessage {
  type: '' | 'info' | 'success' | 'error';
  message: string;
}

/**
 * 그리드 행 식별을 위한 클라이언트 전용 고유 임시 ID 생성기
 * 왜: 엑셀 내보내기 전이거나 신규 고객인 경우 아직 DB ID가 없으므로 화면 렌더링/수정 타겟 식별용으로 사용
 */
let tempIdCounter = 0;
export const generateTempId = (prefix: string = 'temp') =>
  `${prefix}_${Date.now()}_${++tempIdCounter}`;
