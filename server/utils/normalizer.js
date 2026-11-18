/**
 * server/utils/normalizer.js
 * 전화번호, 5자리 우편번호, 한국 주소 및 고객명 비교를 위한 정규화 유틸리티
 *
 * 왜 별도 모듈로 분리했는가:
 * 카카오톡 AI 파서, DB 입출력, 구글 시트 동기화, 엑셀 내보내기 등 모든 계층에서
 * 동일한 기준으로 전화번호(+82 변환)와 우편번호(서울 0xxxx 보존)를 처리하여 데이터 불일치를 원천 차단하기 위함.
 */

/**
 * 한국 전화번호 정규화
 * 왜 필요한가:
 * 외국인 고객 특성상 '+821024644186', '+82 10-2464-4186', '010 - 26018073',
 * '010-759-39711', 또는 앞자리 '010'을 생략한 '3938-1544' 등 다양한 형태로 번호를 전송함.
 * 이를 모두 DB 표준 키인 '010xxxxxxxx' 숫자 문자열로 일원화함.
 *
 * @param {string} raw 원본 전화번호 문자열
 * @param {{ allowEightDigit?: boolean }} options AI 문맥상 전화번호임이 확실할 때 8자리(xxxx-xxxx)에 010 자동 부여 여부
 * @returns {{ phone: string, wasCountryCodeConverted: boolean, wasZeroTenPrefixed: boolean }}
 */
function normalizeKoreanPhoneDetail(raw, options = {}) {
    const { allowEightDigit = false } = options;
    if (!raw) {
        return { phone: '', wasCountryCodeConverted: false, wasZeroTenPrefixed: false };
    }

    const trimmed = String(raw).trim().replace(/^'+/, '');
    let wasCountryCodeConverted = false;
    let wasZeroTenPrefixed = false;

    // 1. 국제전화 국가번호(+82, 0082, 82) 처리
    // 왜: '+821024644186' 또는 '+82 010-2464-4186'에서 숫자만 먼저 빼면 '8210...'이 되어
    // 일반 번호와 혼동될 수 있으므로 선두 국가번호 패턴을 먼저 판별하여 '0'으로 치환함
    let digits = trimmed.replace(/[^0-9+]/g, '');

    if (digits.startsWith('+82')) {
        wasCountryCodeConverted = true;
        let rest = digits.slice(3).replace(/[^0-9]/g, '');
        if (rest.startsWith('0')) {
            digits = rest; // +82 010... -> 010...
        } else {
            digits = '0' + rest; // +82 10... -> 010...
        }
    } else {
        digits = digits.replace(/[^0-9]/g, '');
        if (digits.startsWith('0082') && digits.length >= 12) {
            wasCountryCodeConverted = true;
            const rest = digits.slice(4);
            digits = rest.startsWith('0') ? rest : '0' + rest;
        } else if (digits.startsWith('8210') && digits.length === 12) {
            // '+' 기호 없이 '821024644186'(12자리)으로 보낸 경우
            wasCountryCodeConverted = true;
            digits = '0' + digits.slice(2);
        }
    }

    // 2. '010'이 생략된 8자리 휴대폰 번호(예: '3938-1544') 복원
    // 왜: 우편번호(5자리)나 현관비번(4자리)과 섞이지 않도록 정확히 8자리이면서 allowEightDigit일 때만 복원
    if (allowEightDigit && digits.length === 8 && /^[2-9]\d{7}$/.test(digits)) {
        digits = '010' + digits;
        wasZeroTenPrefixed = true;
    }

    return {
        phone: digits,
        wasCountryCodeConverted,
        wasZeroTenPrefixed,
    };
}

/**
 * 단순 전화번호 문자열 반환 래퍼 (기존 DB/시트 코드 호환용)
 */
function normalizeKoreanPhone(raw, options = {}) {
    return normalizeKoreanPhoneDetail(raw, options).phone;
}

/**
 * 대한민국 5자리 우편번호 정규화 (선행 0 보존)
 * 왜 필요한가:
 * 서울(01xxx~08xxx) 등 0으로 시작하는 우편번호가 과거 엑셀/스프레드시트 숫자 서식 때문에
 * '8760'처럼 4자리로 잘려 저장된 데이터를 모두 '08760' 5자리 문자열로 복구하기 위함.
 *
 * @param {string|number} raw 원본 우편번호
 * @returns {string} 5자리 문자열 우편번호 (또는 빈 문자열)
 */
function normalizeZipcode(raw) {
    if (raw === null || raw === undefined) return '';
    const cleaned = String(raw).trim().replace(/^'+/, '').trim();
    if (!cleaned) return '';

    // 숫자 4자리인 경우 한국 5자리 기초구역번호 체계상 앞의 '0'이 생략된 것임 (서울 01000~08866)
    if (/^\d{4}$/.test(cleaned)) {
        return '0' + cleaned;
    }
    if (/^\d{5}$/.test(cleaned)) {
        return cleaned;
    }
    return cleaned;
}

/**
 * 주소 문자열에서 시/도 표준 약칭 추출
 * 왜: 고객은 '전라남도', '경상북도', '대구시'라고 쓰고 DB에는 '전남광주통합특별시', '경북', '대구'로
 * 저장되어 있어도 동일 광역권으로 비교할 수 있도록 통합 코드로 매핑함.
 * (특히 전남·광주는 통합특별시 표기 혼용이 있으므로 호남권 비교 시 충돌로 오판하지 않게 그룹화)
 */
function extractSidoGroup(addr) {
    if (!addr) return null;
    const s = addr.trim();
    if (/^(서울특별시|서울시|서울)/.test(s)) return 'SEOUL';
    if (/^(부산광역시|부산시|부산)/.test(s)) return 'BUSAN';
    if (/^(대구광역시|대구시|대구)/.test(s)) return 'DAEGU';
    if (/^(인천광역시|인천시|인천)/.test(s)) return 'INCHEON';
    if (/^(대전광역시|대전시|대전)|\((?:\s*)대전(?:\s*)\)/.test(s)) return 'DAEJEON';
    if (/^(울산광역시|울산시|울산)/.test(s)) return 'ULSAN';
    if (/^(세종특별자치시|세종시|세종)/.test(s)) return 'SEJONG';
    if (/^(경기도|경기)/.test(s)) return 'GYEONGGI';
    if (/^(강원특별자치도|강원도|강원)/.test(s)) return 'GANGWON';
    if (/^(충청북도|충북)/.test(s)) return 'CHUNGBUK';
    if (/^(충청남도|충남)/.test(s)) return 'CHUNGNAM';
    if (/^(전북특별자치도|전라북도|전북)/.test(s)) return 'JEONBUK';
    // 전남·광주는 '전남광주통합특별시'와 '전라남도/전남/광주광역시'가 혼용되므로 동일 권역 코드로 묶고 시/군/구로 세밀 판별
    if (/^(전남광주통합특별시|전라남도|전남|광주광역시|광주시(?!\s*오포|\s*초월|\s*곤지암|\s*퇴촌|\s*남한산성|\s*신현|\s*능평|\s*경안|\s*태전|\s*역동|\s*송정|\s*목현|\s*쌍령|\s*탄벌|\s*회덕|\s*삼동|\s*중대|\s*직동|\s*새말길))/.test(s)) {
        if (/경기도\s*광주시|경기\s*광주시/.test(s)) return 'GYEONGGI';
        return 'JEONNAM_GWANGJU';
    }
    if (/^(경상북도|경북)/.test(s)) return 'GYEONGBUK';
    if (/^(경상남도|경남)/.test(s)) return 'GYEONGNAM';
    if (/^(제주특별자치도|제주도|제주)/.test(s)) return 'JEJU';
    return null;
}

/**
 * 주소에서 주요 시/군 이름 추출 (예: '평택시', '포천시', '파주시', '순천시', '천안시' 등)
 * 왜: 우연히 다른 도시에 같은 도로명/번지가 있을 때 다른 도시로의 이사를 놓치지 않기 위함
 */
function extractCityToken(addr) {
    if (!addr) return null;
    // 광역시/특별시는 구·군 단위가 핵심이고, 도 지역은 시·군 단위가 핵심
    const match = addr.match(/([가-힣]{2,4}(?:시|군))(?!\s*청)/);
    if (!match) return null;
    const token = match[1];
    // 특별시/광역시는 시/도 레벨이므로 제외
    if (['서울시', '부산시', '대구시', '인천시', '광주시', '대전시', '울산시', '세종시', '특별시', '광역시'].includes(token)) {
        // 대신 구 이름을 반환 (예: 팔달구 vs 권선구)
        const guMatch = addr.match(/([가-힣]{1,4}구)\b/);
        return guMatch ? guMatch[1] : null;
    }
    return token.replace(/시$|군$/, ''); // '평택시'/'평택' 모두 '평택'으로 통일
}

/**
 * 주소에서 '도로명+건물번호' 및 '동/읍/면/리+지번' 핵심 식별 토큰 배열 추출
 * 왜: 행정구역 표기('대소면' vs '대소읍', 시/군/구 생략 등)나 상세주소 표기가 조금 달라도
 * 실제 대표주소(건물 본번-부번)가 같은지 정확히 비교하기 위함.
 */
function extractCoreAddressTokens(addrText) {
    if (!addrText) return [];
    const tokens = new Set();

    // 공백 정규화 및 괄호 풀기 (괄호 안의 지번/동이름도 토큰으로 추출하기 위함)
    const normalized = String(addrText)
        .replace(/[\[\]().,]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    // 1. 도로명 + 건물번호 패턴 (예: '새말길 280-30', '정왕천로 357번길 7', '고덕중앙2로77-6', '한국관광 1번로 11')
    // 도로명 중간에 불필요한 띄어쓰기가 들어간 경우를 대비해 번길/로/길 앞 공백 붙이기
    const roadCompact = normalized
        .replace(/([가-힣0-9]+)\s+(로|길|번길|번로)/g, '$1$2')
        .replace(/(로|길)\s*(\d+)\s*(번길|길)/g, '$1$2$3');

    const roadRegex = /([가-힣]+(?:\d+(?:번|가)?)?(?:대로|로|길)(?:\d+번길|\d+길)?)\s*(\d+(?:-\d+)?)(?!\s*(?:동|호|층|차))/g;
    let m;
    while ((m = roadRegex.exec(roadCompact)) !== null) {
        const roadName = m[1].replace(/\s+/g, '');
        const bldgNo = m[2];
        tokens.add(`ROAD:${roadName}:${bldgNo}`);
    }

    // 2. 읍/면/동/리/가 + 지번 패턴 (예: '계양동 786', '문덕리 275-12', '정왕동 1567-4', '남자리477')
    const lotRegex = /([가-힣0-9]{1,8}(?:동|읍|면|리|가))\s*(\d+(?:-\d+)?)(?:번지)?(?!\s*(?:동|호|층|번길|길|로))/g;
    while ((m = lotRegex.exec(normalized)) !== null) {
        const areaName = m[1].replace(/\s+/g, '');
        const lotNo = m[2];
        tokens.add(`LOT:${areaName}:${lotNo}`);
    }

    return Array.from(tokens);
}

/**
 * 기존 DB 주소와 채팅 주소(및 공식 주소 API 검증 결과)의 '대표주소 일치 여부' 판정
 *
 * 왜 이렇게 설계했는가:
 * 1. 고객이 시/도·시/군/구를 빼먹고 '덕다길50번길 35'만 보내도 DB의 '경기 화성시 만세구 장안면 덕다길50번길 35'와 일치 판정.
 * 2. 고객은 지번('정왕동 1567-4')으로, DB는 도로명(또는 반대)으로 저장된 경우 공식 API가 반환한 우편번호·도로명·지번으로 교차 판정.
 * 3. 시골 농가처럼 DB 상세주소에 '현천리 142-1 지번의 농가'라고 기록해둔 특수 케이스도 일치로 인정해 보호.
 * 4. 반대로 시/군이나 구가 명확히 달라졌거나(팔달구 인계동 -> 권선구 곡반정동) 건물번호가 다르면 즉시 '주소 변경(false)'으로 판정.
 */
function isSameRepresentativeAddress({ chatBaseAddr, chatRawAddr, dbAddress, dbDetailAddress, dbZipcode, officialAddr }) {
    if (!dbAddress) return false;

    const chatCombined = `${chatBaseAddr || ''} ${chatRawAddr || ''}`.trim();
    if (!chatCombined) return false;

    // 1단계: 시/도 또는 시/군/구가 둘 다 명시되어 있는데 서로 다르면 무조건 다른 주소(이사함!)
    const chatSido = extractSidoGroup(chatBaseAddr) || extractSidoGroup(chatRawAddr);
    const dbSido = extractSidoGroup(dbAddress);
    if (chatSido && dbSido && chatSido !== dbSido) {
        return false;
    }

    const chatCity = extractCityToken(chatBaseAddr);
    const dbCity = extractCityToken(dbAddress);
    if (chatCity && dbCity && chatCity !== dbCity) {
        return false;
    }

    // 수원시 팔달구 -> 수원시 권선구 같은 동일 시 내 '구' 변경 검사
    // (단, 화성시 만세구/병점구 등 고객이 구 이름을 안 적는 경우는 둘 다 있을 때만 비교)
    const chatGu = (chatBaseAddr || '').match(/([가-힣]{1,4}구)\b/)?.[1];
    const dbGu = (dbAddress || '').match(/([가-힣]{1,4}구)\b/)?.[1];
    if (chatGu && dbGu && chatGu !== dbGu) {
        return false;
    }

    // 2단계: 공식 주소 API 결과와 기존 DB 직접 비교 (지번 <-> 도로명 변환 케이스까지 해결)
    if (officialAddr && officialAddr.found) {
        const normDbZip = normalizeZipcode(dbZipcode);
        const normApiZip = normalizeZipcode(officialAddr.zipcode);

        const apiTokens = extractCoreAddressTokens(
            `${officialAddr.roadAddress || ''} ${officialAddr.jibunAddress || ''}`
        );
        const dbTokens = extractCoreAddressTokens(`${dbAddress} ${dbDetailAddress || ''}`);

        const hasTokenOverlap = apiTokens.some((t) => dbTokens.includes(t));
        if (hasTokenOverlap) {
            return true;
        }

        // 우편번호가 다른 경우는 명백한 주소 이동 (단, 우편번호 개편 예외 방지를 위해 토큰 불일치 함께 확인)
        if (normDbZip && normApiZip && normDbZip !== normApiZip && apiTokens.length > 0 && dbTokens.length > 0) {
            return false;
        }
    }

    // 3단계: 채팅 추출 주소 토큰과 DB 주소(+상세주소 내 특수 지번) 핵심 토큰 교차 비교
    const chatTokens = extractCoreAddressTokens(chatCombined);
    const dbTokens = extractCoreAddressTokens(`${dbAddress} ${dbDetailAddress || ''}`);

    if (chatTokens.length > 0 && dbTokens.length > 0) {
        const matched = chatTokens.some((t) => dbTokens.includes(t));
        if (matched) return true;
    }

    // 4단계: 구/군 단위 없이 단순 텍스트 정규화 포함 여부 보조 확인 (번지 숫자까지 반드시 일치해야 함)
    const cleanStr = (s) => String(s || '').replace(/\s+/g, '').replace(/[().,-]/g, '');
    const chatNums = (chatBaseAddr || '').match(/\d+(?:-\d+)?/g) || [];
    const dbNums = (dbAddress || '').match(/\d+(?:-\d+)?/g) || [];
    if (chatNums.length > 0 && dbNums.length > 0) {
        const mainChatNum = chatNums[chatNums.length - 1];
        if (dbNums.includes(mainChatNum) && cleanStr(dbAddress).includes(cleanStr(chatBaseAddr))) {
            return true;
        }
    }

    return false;
}

/**
 * 고객 이름 동일 여부 비교
 * 왜 필요한가:
 * - '유리 🩷' vs '유리' (이모지/공백 차이) -> 동일 인물
 * - 'Mr. Cho Hyeonbong ( 조 현봉 )' vs 'Mr. Cho Hyeonbong' -> 동일 인물
 * - '유진' + 부가표기 'Thidawan Kijjanulak' vs DB '유진' -> 동일 인물
 * - 반면 DB 'Yuri' vs 채팅 'Honey', DB '하*' vs 채팅 '하나' -> 이름 변경(수정 대상)으로 감지
 *
 * @returns {{ isSame: boolean, cleanName: string }}
 */
function compareCustomerName(chatName, chatAltName, dbName) {
    // 이모지 및 불필요 기호 제거하되 태국어(\u0E00-\u0E7F), 라오스어(\u0E80-\u0EFF), 한글, 영문, 숫자, 괄호/점은 유지
    const sanitizeName = (s) =>
        String(s || '')
            .replace(/^(?:이름\s*[:：]?\s*)/i, '')
            .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}☎️📞🩷❤️💕✨⭐]/gu, '')
            .replace(/\s+/g, ' ')
            .trim();

    const cleanChat = sanitizeName(chatName);
    const cleanAlt = sanitizeName(chatAltName);
    const cleanDb = String(dbName || '').trim();

    if (!cleanChat) {
        return { isSame: true, cleanName: cleanDb };
    }
    if (!cleanDb) {
        return { isSame: false, cleanName: cleanChat };
    }

    // DB 이름에 과거 마스킹('*')이 포함되어 있으면 마스킹 없는 온전한 이름으로 업데이트하도록 변경 판정
    if (cleanDb.includes('*')) {
        return { isSame: false, cleanName: cleanChat };
    }

    const norm = (s) =>
        sanitizeName(s)
            .toLowerCase()
            .replace(/[\s()._-]/g, '');

    const nChat = norm(cleanChat);
    const nAlt = norm(cleanAlt);
    const nDb = norm(cleanDb);

    if (!nChat) return { isSame: true, cleanName: cleanDb };

    if (nChat === nDb || (nAlt && nAlt === nDb)) {
        return { isSame: true, cleanName: cleanDb };
    }

    // 한쪽이 'Mr. Cho Hyeonbong (조현봉)'이고 DB가 'Mr. Cho Hyeonbong'처럼 3글자 이상 완전 포함 관계인 경우 동일 인물로 간주
    if (nDb.length >= 2 && (nChat.includes(nDb) || nDb.includes(nChat))) {
        return { isSame: true, cleanName: cleanDb };
    }
    if (nAlt && nDb.length >= 2 && (nAlt.includes(nDb) || nDb.includes(nAlt))) {
        return { isSame: true, cleanName: cleanDb };
    }

    return { isSame: false, cleanName: cleanChat };
}

module.exports = {
    normalizeKoreanPhoneDetail,
    normalizeKoreanPhone,
    normalizeZipcode,
    extractCoreAddressTokens,
    isSameRepresentativeAddress,
    compareCustomerName,
};
