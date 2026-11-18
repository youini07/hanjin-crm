/**
 * server/address_service.js
 * 공식 한국 주소 검증 및 5자리 우편번호 조회 서비스 (카카오 로컬 API / 행안부 도로명주소 API 지원)
 *
 * 왜 필요한가:
 * AI 모델만으로는 한진택배 엑셀 필수 항목인 '실제 5자리 우편번호'를 100% 보장할 수 없으므로,
 * AI가 1차 정제·보정한 주소를 공식 주소 DB에 조회하여 정확한 우편번호와 표준 기본주소를 획득하고
 * 동명 지역(예: 여러 도시의 '명륜동') 중복 여부까지 검증함.
 */

const { normalizeZipcode } = require('./utils/normalizer');

/**
 * 카카오 로컬 주소검색 API 호출
 */
async function searchViaKakao(keyword, kakaoRestApiKey) {
    if (!keyword || !kakaoRestApiKey) return null;

    const url = `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(
        keyword
    )}&size=10`;

    const res = await fetch(url, {
        method: 'GET',
        headers: {
            Authorization: `KakaoAK ${kakaoRestApiKey.trim()}`,
        },
        signal: AbortSignal.timeout(6000),
    });

    if (!res.ok) {
        throw new Error(`Kakao Address API HTTP ${res.status}`);
    }

    const data = await res.json();
    const docs = data?.documents || [];
    if (docs.length === 0) {
        return { found: false, count: 0 };
    }

    // 서로 다른 시/군/구가 여러 개 검색되었는지 확인 (예: 시/군 없이 '명륜동 824-11'만 입력한 경우)
    const distinctRegions = new Set(
        docs
            .map((d) => {
                const r1 = d.road_address?.region_1depth_name || d.address?.region_1depth_name || '';
                const r2 = d.road_address?.region_2depth_name || d.address?.region_2depth_name || '';
                return `${r1} ${r2}`.trim();
            })
            .filter(Boolean)
    );

    const top = docs[0];
    const roadObj = top.road_address;
    const jibunObj = top.address;

    let formattedRoad = '';
    if (roadObj && roadObj.address_name) {
        formattedRoad = roadObj.address_name;
        const extras = [];
        if (roadObj.region_3depth_name) extras.push(roadObj.region_3depth_name);
        if (roadObj.building_name) extras.push(roadObj.building_name);
        if (extras.length > 0) {
            formattedRoad += ` (${extras.join(', ')})`;
        }
    }

    const formattedJibun = jibunObj?.address_name || '';
    const zipcode = normalizeZipcode(roadObj?.zone_no || jibunObj?.zip_code || '');

    return {
        found: true,
        provider: 'kakao',
        count: docs.length,
        isAmbiguous: distinctRegions.size > 1,
        candidateRegions: Array.from(distinctRegions).slice(0, 3),
        zipcode,
        address: formattedRoad || formattedJibun,
        roadAddress: formattedRoad,
        jibunAddress: formattedJibun,
        buildingName: roadObj?.building_name || '',
    };
}

/**
 * 행정안전부 도로명주소 검색 API (business.juso.go.kr) 호출
 */
async function searchViaJuso(keyword, jusoApiKey) {
    if (!keyword || !jusoApiKey) return null;

    // 행안부 API는 특수문자(%, =, >, < 등) 포함 시 에러를 반환하므로 안전하게 정제
    const safeKeyword = keyword
        .replace(/[%=><]/g, ' ')
        .replace(/[,()\[\]]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    if (!safeKeyword) return { found: false, count: 0 };

    const params = new URLSearchParams({
        confmKey: jusoApiKey.trim(),
        currentPage: '1',
        countPerPage: '10',
        keyword: safeKeyword,
        resultType: 'json',
    });

    const url = `https://business.juso.go.kr/addrlink/addrLinkApi.do?${params.toString()}`;
    const res = await fetch(url, {
        method: 'GET',
        signal: AbortSignal.timeout(6000),
    });

    if (!res.ok) {
        throw new Error(`Juso API HTTP ${res.status}`);
    }

    const data = await res.json();
    const common = data?.results?.common;
    if (common && common.errorCode !== '0') {
        throw new Error(`Juso API Error [${common.errorCode}]: ${common.errorMessage}`);
    }

    const jusoList = data?.results?.juso || [];
    if (jusoList.length === 0) {
        return { found: false, count: 0 };
    }

    const distinctRegions = new Set(
        jusoList.map((j) => `${j.siNm || ''} ${j.sggNm || ''}`.trim()).filter(Boolean)
    );

    const top = jusoList[0];
    const zipcode = normalizeZipcode(top.zipNo || '');

    return {
        found: true,
        provider: 'juso',
        count: Number(common?.totalCount || jusoList.length),
        isAmbiguous: distinctRegions.size > 1,
        candidateRegions: Array.from(distinctRegions).slice(0, 3),
        zipcode,
        address: top.roadAddr || top.jibunAddr || '',
        roadAddress: top.roadAddr || '',
        jibunAddress: top.jibunAddr || '',
        buildingName: top.bdNm || '',
    };
}

/**
 * 단일 키워드에 대해 사용 가능한 공식 주소 API(카카오 -> 행안부 순) 호출
 */
async function querySingleKeyword(keyword, keys) {
    const { kakaoRestApiKey, jusoApiKey } = keys;

    if (kakaoRestApiKey) {
        try {
            const kakaoRes = await searchViaKakao(keyword, kakaoRestApiKey);
            if (kakaoRes && kakaoRes.found) return kakaoRes;
        } catch (err) {
            console.warn('[AddressService] Kakao 검색 경고:', err.message);
        }
    }

    if (jusoApiKey) {
        try {
            const jusoRes = await searchViaJuso(keyword, jusoApiKey);
            if (jusoRes && jusoRes.found) return jusoRes;
        } catch (err) {
            console.warn('[AddressService] Juso 검색 경고:', err.message);
        }
    }

    return { found: false, count: 0 };
}

/**
 * AI가 추출한 기본주소(및 발음 오타 대체 후보)로 공식 주소 및 5자리 우편번호 조회
 *
 * @param {string} baseAddress AI 1차 정제 기본주소
 * @param {string} altBaseAddress AI가 추론한 오타 보정 대체 주소 후보 (선택)
 * @param {{ kakaoRestApiKey?: string, jusoApiKey?: string }} keys API 키 객체
 */
async function lookupOfficialAddress(baseAddress, altBaseAddress, keys = {}) {
    const hasAnyKey = Boolean(keys.kakaoRestApiKey?.trim() || keys.jusoApiKey?.trim());
    if (!hasAnyKey || !baseAddress?.trim()) {
        return { found: false, provider: 'none', usedFallbackCandidate: false };
    }

    // 1차 시도: AI가 정제한 기본주소
    const primary = await querySingleKeyword(baseAddress.trim(), keys);
    if (primary.found) {
        return { ...primary, usedFallbackCandidate: false };
    }

    // 2차 시도: 괄호 안 부가 텍스트 제거 후 재시도 (예: '경기도 용인시 처인구 원삼면 맹리로17번길 21-1 (맹리 548-9)')
    const strippedParen = baseAddress.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
    if (strippedParen && strippedParen !== baseAddress.trim()) {
        const second = await querySingleKeyword(strippedParen, keys);
        if (second.found) {
            return { ...second, usedFallbackCandidate: false };
        }
    }

    // 3차 시도: AI가 제안한 발음/철자 오타 대체 후보 (예: '수 섬3길' -> '수성3길')
    if (altBaseAddress && altBaseAddress.trim() && altBaseAddress.trim() !== baseAddress.trim()) {
        const altRes = await querySingleKeyword(altBaseAddress.trim(), keys);
        if (altRes.found) {
            return { ...altRes, usedFallbackCandidate: true, matchedQuery: altBaseAddress.trim() };
        }
    }

    return { found: false, provider: keys.kakaoRestApiKey ? 'kakao' : 'juso', usedFallbackCandidate: false };
}

module.exports = {
    lookupOfficialAddress,
};
