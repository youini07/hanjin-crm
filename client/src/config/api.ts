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
 */
export const socket = isDev ? io(`http://${window.location.hostname}:3001`) : io();

/** 상태 알림 메시지 공통 타입 */
export interface StatusMessage {
  type: '' | 'info' | 'success' | 'error';
  message: string;
}

/**
 * 그리드 행 식별을 위한 클라이언트 전용 고유 임시 ID 생성기
 */
let tempIdCounter = 0;
export const generateTempId = (prefix: string = 'temp') =>
  `${prefix}_${Date.now()}_${++tempIdCounter}`;

/**
 * 프론트엔드 전화번호 정규화 헬퍼 (+82 국가번호 포함 지원)
 * 왜: '+821024644186', '+82 10-2464-4186' 등을 붙여넣었을 때 즉시 '01024644186'으로 변환하기 위함
 */
export const normalizeClientPhone = (raw: string): string => {
  if (!raw) return '';
  const trimmed = raw.trim().replace(/^'+/, '');
  let cleaned = trimmed.replace(/[^0-9+]/g, '');

  if (cleaned.startsWith('+82')) {
    const rest = cleaned.slice(3).replace(/[^0-9]/g, '');
    return rest.startsWith('0') ? rest : `0${rest}`;
  }

  cleaned = cleaned.replace(/[^0-9]/g, '');
  if (cleaned.startsWith('0082') && cleaned.length >= 12) {
    const rest = cleaned.slice(4);
    return rest.startsWith('0') ? rest : `0${rest}`;
  }
  if (cleaned.startsWith('8210') && cleaned.length === 12) {
    return `0${cleaned.slice(2)}`;
  }
  return cleaned;
};

/**
 * 프론트엔드 5자리 우편번호 보존 헬퍼 (서울 4자리 -> 0xxxx 복원)
 */
export const normalizeClientZipcode = (raw: string | number | undefined | null): string => {
  if (raw === undefined || raw === null) return '';
  const s = String(raw).trim().replace(/^'+/, '').trim();
  if (!s) return '';
  if (/^\d{4}$/.test(s)) return `0${s}`;
  return s;
};
