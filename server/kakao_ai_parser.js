/**
 * server/kakao_ai_parser.js
 * Gemini 3.5 Flash-Lite 기반 카카오톡 대화 분석, 외국인 주소 오타 보정,
 * 페이스북 아이디(FB) 백그라운드 매칭 및 필드 단위(이름/주소) 변경 감지 엔진
 */

const { getCustomersByPhones } = require('./db');
const { lookupOfficialAddress } = require('./address_service');
const {
    normalizeKoreanPhoneDetail,
    normalizeZipcode,
    isSameRepresentativeAddress,
    compareCustomerName,
} = require('./utils/normalizer');

const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash-lite';

const ORDER_EXTRACTION_SCHEMA = {
    type: 'OBJECT',
    properties: {
        orders: {
            type: 'ARRAY',
            description: '카카오톡 대화에서 추출한 개별 고객 주문 목록 (순서 유지)',
            items: {
                type: 'OBJECT',
                properties: {
                    phone: {
                        type: 'STRING',
                        description:
                            '수취인 전화번호 원문 (예: 010-1234-5678, +821024644186, 또는 010 생략된 3938-1544). 우편번호나 현관비번은 제외.',
                    },
                    name: {
                        type: 'STRING',
                        description:
                            '수취인 이름 (한글/영문/태국어). "이름", "받는 사람" 접두사나 이모지 제거. 본문에 이름이 없고 "FB 이름"만 있으면 FB 뒤의 이름 사용.',
                    },
                    alt_name: {
                        type: 'STRING',
                        description:
                            '본문에 한글 가명과 영문/태국 본명이 함께 적힌 경우 보조 이름 (없으면 빈 문자열)',
                    },
                    fb_name: {
                        type: 'STRING',
                        description:
                            '해당 고객 정보 마지막(또는 내부)에 적힌 "FB ..." 페이스북 아이디/이름 원문 ("FB" 접두사는 제외하고 순수 아이디만 추출, 없으면 빈 문자열)',
                    },
                    has_text_address: {
                        type: 'BOOLEAN',
                        description:
                            '채팅 텍스트에 도로명/지번 등 기본주소가 적혀 있으면 true. "사진"으로 주소를 보냈거나 주소가 없으면 false.',
                    },
                    raw_address: {
                        type: 'STRING',
                        description: '채팅에 적힌 원본 주소 문자열 그대로',
                    },
                    base_address: {
                        type: 'STRING',
                        description:
                            '오타와 어순을 바로잡은 대한민국 기본주소 (시/도 + 시/군/구 + 읍/면/동/리 + 도로명/건물번호 또는 지번까지만). 예: "28 방내시장길" -> "방내시장길 28", "계옹상북도 봉화군 상운면 후평길 43-3" -> "경상북도 봉화군 상운면 후평길 43-3"',
                    },
                    alt_base_address: {
                        type: 'STRING',
                        description:
                            '외국인 발음 오타 의심 시 공식 주소 검색용 대체 기본주소 후보 (예: "수 섬3길 11-2"일 때 "해남군 해남읍 수성3길 11-2", 없으면 빈 문자열)',
                    },
                    detail_address: {
                        type: 'STRING',
                        description:
                            '건물명/상호명 + 동/층/호수 + 공동현관 비밀번호 및 배송 메모 조합. 태국어/영어 메모(รหัสตึก#2793# 등)는 "(현관 #2793#)"처럼 한국어로 간결히 변환. "상세주소", "기본배송지" 같은 불필요 단어는 제거.',
                    },
                    extracted_zipcode: {
                        type: 'STRING',
                        description: '채팅에 적힌 5자리 우편번호 (없으면 빈 문자열)',
                    },
                    quantity: {
                        type: 'INTEGER',
                        description:
                            '"이 주소로 4장 출력해 주세요" 등 수량 요청이 있으면 해당 숫자, 없으면 1',
                    },
                    has_typo: {
                        type: 'BOOLEAN',
                        description:
                            '외국인 지명 오타를 보정했거나 주소가 불완전해 주의가 필요하면 true',
                    },
                    typo_note: {
                        type: 'STRING',
                        description:
                            '오타 보정 내역 간결 요약 (예: "계옹상북도→경상북도", 없으면 빈 문자열)',
                    },
                },
                required: [
                    'phone',
                    'name',
                    'alt_name',
                    'fb_name',
                    'has_text_address',
                    'raw_address',
                    'base_address',
                    'alt_base_address',
                    'detail_address',
                    'extracted_zipcode',
                    'quantity',
                    'has_typo',
                    'typo_note',
                ],
            },
        },
    },
    required: ['orders'],
};

const SYSTEM_INSTRUCTION = `당신은 한국 택배 송장 정리를 돕는 다국어(한국어·태국어·영어·라오스어) 카카오톡 주문 분석 AI입니다.
카카오톡 PC 버전 대화 목록에서 각 고객의 주문을 순서대로 분리해 JSON으로 반환하세요.

[핵심 분석 규칙]
1. 날짜 구분선, "finish", "이모티콘", "메시지가 삭제되었습니다." 등 잡담/시스템 문구는 제외합니다.
2. 보통 고객 정보 마지막에 "FB 페이스북아이디"가 붙습니다. 이 값을 fb_name 필드에("FB" 글자 제외) 정확히 담아주세요. 한 FB 아래 서로 다른 전화번호/주소가 2건 연속 오면 별도 주문 2건으로 분리하세요.
3. "이 주소로 4장 출력해 주세요." 같은 요청은 해당 주문의 quantity에 반영하세요.
4. 말풍선에 "사진"이라 적혀 있고 텍스트 기본주소가 없는 경우(호수만 텍스트로 있어도 기본주소가 사진이면) 반드시 has_text_address = false로 설정하되, 전화번호가 있으면 절대 누락하지 말고 포함하세요.
5. 전화번호는 +821024644186, 010 - 26018073, 010-759-39711, 010이 생략된 8자리(3938-1544)까지 추출하되, 5자리 우편번호나 현관 비밀번호는 절대 전화번호로 넣지 마세요.
6. 기본주소(base_address)와 상세주소(detail_address)를 정확히 분리하고, 어순 역전("28 방내시장길"->"방내시장길 28") 및 외국인 지명 오타("계옹상북도"->"경상북도", "사복중앙로"->"사북중앙로", "수 섬3길"->"수성3길", "상북도 문경시"->"경상북도 문경시", "주거제시"->"경남 거제시")를 보정해 base_address에 넣으세요. 오타를 보정했다면 has_typo=true와 짧은 typo_note를 남기세요.`;

/**
 * 모바일 카카오톡 캡처(범위 캡처·스크롤 캡처 포함) 이미지 전용 텍스트 추출 지침
 * 왜 별도 지침으로 분리했는가:
 * 모바일 캡처 화면에는 말풍선 옆 노란색 안 읽은 숫자(1, 2, 3), 발신자 프로필명, 시간, 이모티콘 등이 함께 찍히므로
 * 이를 먼저 깨끗한 채팅 원문으로 정제해 기존 붙여넣기 창(textarea)에 넣어주어야 사용자가 눈으로 검토하고 기존 AI 파서를 그대로 재사용할 수 있음.
 */
const IMAGE_OCR_SYSTEM_INSTRUCTION = `당신은 모바일 카카오톡 대화 캡처 이미지에서 주문 관련 말풍선 텍스트만 위에서 아래 순서대로 정확히 추출하는 다국어(한국어·영어·태국어·라오스어) OCR 전문 AI입니다.

[필수 추출 규칙]
1. 반드시 이미지의 **위에서 아래 순서 그대로** 말풍선 내부 텍스트만 추출하세요.
2. 말풍선 바깥의 카카오톡 UI 요소는 **절대 포함하지 마세요**:
   - 말풍선 위에 적힌 상대방 프로필 이름(예: Dreamstyle 등 발신자 표시) 제외
   - 말풍선 옆 노란색 안 읽은 사람 수 숫자(1, 2, 3 등) 절대 제외 (주소 번지수나 전화번호 뒷자리에 섞이지 않게 각별히 주의!)
   - 말풍선 옆 시각 표시(오전 6:34, 오후 1:20 등), 날짜 말풍선(19/11 등), 상단 상태바 제외
   - "메시지가 삭제되었습니다.", 캐릭터 이모티콘/스티커(Okay! 등) 제외
3. 말풍선 안의 내용은 글자 하나 빠뜨리지 말고 원문 그대로 추출하세요:
   - 한국어 주소, 건물명, 동·호수, 현관 비밀번호
   - 파란색 밑줄이 그어진 전화번호(010-xxxx-xxxx, 010 xxxxxxxx 등) 및 주소 링크 텍스트
   - 영문 수취인 이름 및 태국어/라오스어 텍스트(예: "FB ร่ำรวย เงินทอง", "FB นู่เพ็ญ ล้อมค้อม" 등 성조 기호까지 정확히 보존)
   - 주소에 외국인 발음 오타가 있더라도 임의로 고치지 말고 이미지에 적힌 글자 그대로 적으세요.
4. 말풍선 안에 주소가 적힌 사진(종이/화면 촬영본)이 들어 있어 글자를 읽을 수 있다면 그 안의 주소·이름·전화번호를 텍스트로 읽어 적고, 글자가 없는 일반 사진 썸네일이면 "사진"이라고만 적으세요.
5. 각 말풍선 사이는 줄바꿈으로 구분하고, 하나의 주문 묶음("FB ..." 말풍선 직후 등)이 끝날 때는 빈 줄을 한 줄 넣어 가독성을 높이세요.
6. 인사말, 설명, 마크다운 코드블록(\`\`\`) 없이 **오직 추출된 순수 텍스트만** 출력하세요. 추출할 대화 텍스트가 전혀 없으면 빈 문자열만 반환하세요.`;

function splitChatIntoChunks(rawText, maxChunkChars = 5500) {
    const trimmed = String(rawText || '').trim();
    if (trimmed.length <= maxChunkChars) {
        return [trimmed];
    }

    const lines = trimmed.split(/\r?\n/);
    const chunks = [];
    let currentLines = [];
    let currentLen = 0;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        currentLines.push(line);
        currentLen += line.length + 1;

        const isFbBoundary =
            /^\[[^\]]+\]\s+\[(?:오전|오후)\s+\d{1,2}:\d{2}\]\s*[.,\s]*FB\b/i.test(line.trim()) &&
            !/010/.test(line);
        const isFinishOrDate =
            /^\d{4}년\s+\d{1,2}월\s+\d{1,2}일/.test(line.trim()) ||
            /^-{3,}/.test(line.trim()) ||
            /\bfinish\s*$/i.test(line.trim());

        if (currentLen >= maxChunkChars && (isFbBoundary || isFinishOrDate)) {
            chunks.push(currentLines.join('\n'));
            currentLines = [];
            currentLen = 0;
        }
    }

    if (currentLines.length > 0) {
        chunks.push(currentLines.join('\n'));
    }

    return chunks;
}

async function callGeminiExtractChunk(chunkText, apiKey, modelName) {
    const targetModel = (modelName || DEFAULT_GEMINI_MODEL).trim();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        targetModel
    )}:generateContent?key=${encodeURIComponent(apiKey.trim())}`;

    const body = {
        systemInstruction: {
            parts: [{ text: SYSTEM_INSTRUCTION }],
        },
        contents: [
            {
                role: 'user',
                parts: [
                    {
                        text: `아래 카카오톡 대화 목록을 분석하여 모든 고객 주문을 순서대로 JSON 추출해주세요:\n\n${chunkText}`,
                    },
                ],
            },
        ],
        generationConfig: {
            temperature: 0.1,
            responseMimeType: 'application/json',
            responseSchema: ORDER_EXTRACTION_SCHEMA,
        },
    };

    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60000),
    });

    if (!res.ok) {
        let errDetail = '';
        try {
            const errJson = await res.json();
            errDetail = errJson?.error?.message || JSON.stringify(errJson);
        } catch {
            errDetail = await res.text();
        }
        throw new Error(`Gemini API 오류 (${res.status}): ${errDetail}`);
    }

    const data = await res.json();
    const textOut = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!textOut) {
        throw new Error('AI 응답에서 분석 결과를 찾을 수 없습니다.');
    }

    const parsed = JSON.parse(textOut);
    return Array.isArray(parsed?.orders) ? parsed.orders : [];
}

async function testGeminiConnection(apiKey, modelName) {
    const targetModel = (modelName || DEFAULT_GEMINI_MODEL).trim();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        targetModel
    )}:generateContent?key=${encodeURIComponent(apiKey.trim())}`;

    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: '연결 테스트입니다. OK라고만 답하세요.' }] }],
            generationConfig: { maxOutputTokens: 16, temperature: 0 },
        }),
        signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
        let errDetail = '';
        try {
            const errJson = await res.json();
            errDetail = errJson?.error?.message || JSON.stringify(errJson);
        } catch {
            errDetail = await res.text();
        }
        throw new Error(`모델(${targetModel}) 호출 실패 [${res.status}]: ${errDetail}`);
    }

    const data = await res.json();
    const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text || 'OK';
    return { ok: true, model: targetModel, reply: reply.trim() };
}

async function mapWithConcurrency(items, concurrency, mapper) {
    const results = new Array(items.length);
    let idx = 0;

    async function worker() {
        while (idx < items.length) {
            const current = idx++;
            results[current] = await mapper(items[current], current);
        }
    }

    const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
    await Promise.all(workers);
    return results;
}

/**
 * 카카오톡 대화 분석 + 공식 주소 API 검증 + 기존 DB 필드별(이름/주소) 비교
 */
async function analyzeKakaoChatWithAI(rawText, settings = {}) {
    const geminiApiKey = settings.gemini_api_key || process.env.GEMINI_API_KEY || '';
    const geminiModel = settings.gemini_model || DEFAULT_GEMINI_MODEL;
    const addressKeys = {
        kakaoRestApiKey: settings.kakao_rest_api_key || process.env.KAKAO_REST_API_KEY || '',
        jusoApiKey: settings.juso_api_key || process.env.JUSO_API_KEY || '',
    };
    const hasAddressApi = Boolean(
        addressKeys.kakaoRestApiKey.trim() || addressKeys.jusoApiKey.trim()
    );

    if (!geminiApiKey.trim()) {
        throw new Error(
            'Gemini API 키가 설정되지 않았습니다. 우측 상단 [API 설정]에서 키를 입력해 주세요.'
        );
    }

    // 1단계: 청크 분할 병렬 AI 추출
    const chunks = splitChatIntoChunks(rawText, 5500);
    const chunkResults = await mapWithConcurrency(chunks, 3, (chunk) =>
        callGeminiExtractChunk(chunk, geminiApiKey, geminiModel)
    );
    const rawOrders = chunkResults.flat();

    // 2단계: 전화번호 정규화 및 중복 합치기(최신 FB 아이디 우선 유지)
    const normalizedOrders = [];
    for (const item of rawOrders) {
        const phoneDetail = normalizeKoreanPhoneDetail(item.phone, { allowEightDigit: true });
        if (!phoneDetail.phone || phoneDetail.phone.length < 9 || phoneDetail.phone.length > 12) {
            continue;
        }
        normalizedOrders.push({
            ...item,
            _normPhone: phoneDetail.phone,
            _wasZeroTenPrefixed: phoneDetail.wasZeroTenPrefixed,
        });
    }

    if (normalizedOrders.length === 0) {
        return {
            items: [],
            summary: { total: 0, matched: 0, modified: 0, newCount: 0, photoCheck: 0, typoWarning: 0 },
        };
    }

    // 동일 번호+동일 주소 중복 채팅 정리 (뒤에 나온 최신 FB 아이디로 갱신)
    const dedupedOrders = [];
    const seenSignatureMap = new Map();

    for (const ord of normalizedOrders) {
        const addrSig = ord.has_text_address
            ? String(ord.base_address || '').replace(/\s+/g, '')
            : 'NO_ADDR';
        const sig = `${ord._normPhone}::${addrSig}`;

        if (seenSignatureMap.has(sig)) {
            const prevOrd = seenSignatureMap.get(sig);
            prevOrd._duplicateCount = (prevOrd._duplicateCount || 1) + 1;
            if (ord.fb_name && String(ord.fb_name).trim()) {
                prevOrd.fb_name = String(ord.fb_name).trim();
            }
            continue;
        }
        ord._duplicateCount = 1;
        seenSignatureMap.set(sig, ord);
        dedupedOrders.push(ord);
    }

    // 3단계: 로컬 DB 일괄 조회
    const uniquePhones = [...new Set(dedupedOrders.map((o) => o._normPhone))];
    const dbCustomers = await getCustomersByPhones(uniquePhones);
    const dbMap = new Map();
    for (const c of dbCustomers) {
        dbMap.set(c.phone, c);
    }

    // 4단계: 주문별 셀 단위(이름/주소) 변경 판정
    const items = await mapWithConcurrency(dedupedOrders, 5, async (ord) => {
        const phone = ord._normPhone;
        const dbCustomer = dbMap.get(phone) || null;
        const quantity = Math.max(1, Number(ord.quantity) || 1);
        const cleanFbName = String(ord.fb_name || '')
            .replace(/^[.,\s]*(?:F\.?\s*B\.?|페북)\s*[:：.\-]?\s*/i, '')
            .trim();
        const fbUpdated = Boolean(
            cleanFbName && (!dbCustomer || cleanFbName !== (dbCustomer.fb_name || ''))
        );

        // ──────────────────────────────────────────────────────────────────
        // [케이스 1] 사진 등으로 텍스트에 주소가 없는 경우
        // 사용자 규칙: 기존 DB가 있으면 주소를 그대로 불러와 채워주고 주소 칸에만 [확인] 버튼 표시!
        // ──────────────────────────────────────────────────────────────────
        if (!ord.has_text_address || !String(ord.base_address || '').trim()) {
            if (dbCustomer) {
                const nameComp = compareCustomerName(ord.name, ord.alt_name, dbCustomer.name);
                const nameChanged = Boolean(ord.name && ord.name.trim() && !nameComp.isSame);

                return {
                    phone,
                    name: nameChanged ? nameComp.cleanName : dbCustomer.name || '',
                    zipcode: normalizeZipcode(dbCustomer.zipcode),
                    address: dbCustomer.address || '',
                    detail_address: dbCustomer.detail_address || '',
                    quantity,
                    _fbName: cleanFbName || dbCustomer.fb_name || '',
                    _fbUpdated: fbUpdated,
                    _isNew: false,
                    _reviewStatus: 'PHOTO_CHECK',
                    _namePending: nameChanged,
                    _addressPending: 'PHOTO', // 주소 칸에 '사진주소 [확인]' 버튼 표시
                    _isConfirmed: false,
                    _needsAddressCheck: false,
                    _aiNote: ord._duplicateCount > 1 ? `동일채팅 ${ord._duplicateCount}회` : '',
                    _prevDbInfo: {
                        name: dbCustomer.name || '',
                        zipcode: normalizeZipcode(dbCustomer.zipcode),
                        address: dbCustomer.address || '',
                        detail_address: dbCustomer.detail_address || '',
                    },
                };
            }

            // 기존 DB에도 없는 완전 신규 사진 주문 -> 번호와 이름(있으면)만 세팅하고 주소 입력 대기
            const cleanChatName = compareCustomerName(ord.name, ord.alt_name, '').cleanName;
            return {
                phone,
                name: cleanChatName || '',
                zipcode: '',
                address: '',
                detail_address: '',
                quantity,
                _fbName: cleanFbName,
                _fbUpdated: Boolean(cleanFbName),
                _isNew: true,
                _reviewStatus: 'NO_ADDRESS',
                _namePending: false,
                _addressPending: 'NEW_PHOTO',
                _isConfirmed: false,
                _needsAddressCheck: false,
                _chatNameHint: cleanChatName,
                _aiNote: '',
            };
        }

        // 오타 보정 메모 (간결하게 핵심만 유지)
        const warningTags = [];
        let needsAddressCheck = Boolean(ord.has_typo || ord._wasZeroTenPrefixed);
        if (ord.has_typo && ord.typo_note) {
            warningTags.push(`오타보정: ${ord.typo_note}`);
        } else if (ord.has_typo) {
            warningTags.push('주소 오타보정됨');
        }
        if (ord._wasZeroTenPrefixed) {
            warningTags.push('010 자동복원');
        }
        if (ord._duplicateCount > 1) {
            warningTags.push(`중복채팅 ${ord._duplicateCount}회`);
        }

        // ──────────────────────────────────────────────────────────────────
        // [케이스 2] 기존 DB 고객이고 텍스트 주소가 있는 경우 -> 바뀐 칸(이름 / 주소)만 개별 감지
        // ──────────────────────────────────────────────────────────────────
        if (dbCustomer) {
            let sameRepAddr = isSameRepresentativeAddress({
                chatBaseAddr: ord.base_address,
                chatRawAddr: ord.raw_address,
                dbAddress: dbCustomer.address,
                dbDetailAddress: dbCustomer.detail_address,
                dbZipcode: dbCustomer.zipcode,
                officialAddr: null,
            });

            let officialAddr = { found: false };
            if (!sameRepAddr && hasAddressApi) {
                officialAddr = await lookupOfficialAddress(
                    ord.base_address,
                    ord.alt_base_address,
                    addressKeys
                );
                if (officialAddr.found) {
                    sameRepAddr = isSameRepresentativeAddress({
                        chatBaseAddr: ord.base_address,
                        chatRawAddr: ord.raw_address,
                        dbAddress: dbCustomer.address,
                        dbDetailAddress: dbCustomer.detail_address,
                        dbZipcode: dbCustomer.zipcode,
                        officialAddr,
                    });
                }
            }

            const nameComp = compareCustomerName(ord.name, ord.alt_name, dbCustomer.name);

            // [2-A] 대표주소가 기존 DB와 동일한 경우 -> 주소 칸은 건드리지 않음!
            if (sameRepAddr) {
                if (nameComp.isSame) {
                    // 이름·주소 모두 동일 -> 완전 일치!
                    return {
                        phone,
                        name: dbCustomer.name,
                        zipcode: normalizeZipcode(dbCustomer.zipcode),
                        address: dbCustomer.address || '',
                        detail_address: dbCustomer.detail_address || '',
                        quantity,
                        _fbName: cleanFbName || dbCustomer.fb_name || '',
                        _fbUpdated: fbUpdated,
                        _isNew: false,
                        _reviewStatus: 'MATCHED',
                        _namePending: false,
                        _addressPending: null,
                        _isConfirmed: true,
                        _needsAddressCheck: false,
                        _aiNote: ord._duplicateCount > 1 ? `중복채팅 ${ord._duplicateCount}회` : '',
                    };
                } else {
                    // 이름만 바뀐 경우 -> 이름 칸에만 '기존 -> 새 이름 [수정]' 버튼 표시!
                    return {
                        phone,
                        name: nameComp.cleanName,
                        zipcode: normalizeZipcode(dbCustomer.zipcode),
                        address: dbCustomer.address || '',
                        detail_address: dbCustomer.detail_address || '',
                        quantity,
                        _fbName: cleanFbName || dbCustomer.fb_name || '',
                        _fbUpdated: fbUpdated,
                        _isNew: false,
                        _reviewStatus: 'MODIFIED',
                        _namePending: true,
                        _addressPending: null,
                        _isConfirmed: false,
                        _needsAddressCheck: false,
                        _aiNote: '',
                        _prevDbInfo: {
                            name: dbCustomer.name || '',
                            zipcode: normalizeZipcode(dbCustomer.zipcode),
                            address: dbCustomer.address || '',
                            detail_address: dbCustomer.detail_address || '',
                        },
                    };
                }
            }

            // [2-B] 대표주소가 달라진 경우 (이사!) -> 주소 칸에 [수정] 표시 (+ 이름도 바뀌었으면 이름 칸에도 [수정])
            if (!officialAddr.found && hasAddressApi) {
                officialAddr = await lookupOfficialAddress(
                    ord.base_address,
                    ord.alt_base_address,
                    addressKeys
                );
            }

            if (officialAddr.usedFallbackCandidate) {
                needsAddressCheck = true;
                warningTags.push(`발음보정: ${officialAddr.matchedQuery}`);
            }
            if (officialAddr.isAmbiguous) {
                needsAddressCheck = true;
                warningTags.push(`복수지역(${officialAddr.candidateRegions.join('/')})`);
            }

            const newZipcode = officialAddr.found
                ? normalizeZipcode(officialAddr.zipcode)
                : normalizeZipcode(ord.extracted_zipcode);
            const newBaseAddress = officialAddr.found ? officialAddr.address : ord.base_address;
            const nameChanged = !nameComp.isSame && Boolean(nameComp.cleanName);

            if (!newZipcode) {
                needsAddressCheck = true;
            }

            return {
                phone,
                name: nameChanged ? nameComp.cleanName : dbCustomer.name,
                zipcode: newZipcode,
                address: newBaseAddress,
                detail_address: String(ord.detail_address || '').trim(),
                quantity,
                _fbName: cleanFbName || dbCustomer.fb_name || '',
                _fbUpdated: fbUpdated,
                _isNew: false,
                _reviewStatus: 'MODIFIED',
                _namePending: nameChanged,
                _addressPending: 'MODIFIED',
                _isConfirmed: false,
                _needsAddressCheck: needsAddressCheck,
                _aiNote: warningTags.join(' · '),
                _prevDbInfo: {
                    name: dbCustomer.name || '',
                    zipcode: normalizeZipcode(dbCustomer.zipcode),
                    address: dbCustomer.address || '',
                    detail_address: dbCustomer.detail_address || '',
                },
            };
        }

        // ──────────────────────────────────────────────────────────────────
        // [케이스 3] DB에 없는 신규 고객 (텍스트 주소 있음) -> 주소 칸에 [확인] 버튼 표시
        // ──────────────────────────────────────────────────────────────────
        let officialAddr = { found: false };
        if (hasAddressApi) {
            officialAddr = await lookupOfficialAddress(
                ord.base_address,
                ord.alt_base_address,
                addressKeys
            );
        }

        if (officialAddr.usedFallbackCandidate) {
            needsAddressCheck = true;
            warningTags.push(`발음보정: ${officialAddr.matchedQuery}`);
        }
        if (officialAddr.isAmbiguous) {
            needsAddressCheck = true;
            warningTags.push(`복수지역(${officialAddr.candidateRegions.join('/')})`);
        }

        const newZipcode = officialAddr.found
            ? normalizeZipcode(officialAddr.zipcode)
            : normalizeZipcode(ord.extracted_zipcode);
        const newBaseAddress = officialAddr.found ? officialAddr.address : ord.base_address;
        const cleanName = compareCustomerName(ord.name, ord.alt_name, '').cleanName;

        if (!newZipcode) {
            needsAddressCheck = true;
        }

        return {
            phone,
            name: cleanName,
            zipcode: newZipcode,
            address: newBaseAddress,
            detail_address: String(ord.detail_address || '').trim(),
            quantity,
            _fbName: cleanFbName,
            _fbUpdated: Boolean(cleanFbName),
            _isNew: true,
            _reviewStatus: 'NEW',
            _namePending: false,
            _addressPending: 'NEW',
            _isConfirmed: false,
            _needsAddressCheck: needsAddressCheck,
            _aiNote: warningTags.join(' · '),
        };
    });

    const summary = {
        total: items.length,
        matched: items.filter((i) => i._reviewStatus === 'MATCHED').length,
        modified: items.filter((i) => i._reviewStatus === 'MODIFIED').length,
        newCount: items.filter((i) => i._reviewStatus === 'NEW').length,
        photoCheck: items.filter(
            (i) => i._reviewStatus === 'PHOTO_CHECK' || i._reviewStatus === 'NO_ADDRESS'
        ).length,
        typoWarning: items.filter((i) => i._needsAddressCheck).length,
    };

    return {
        model: geminiModel,
        hasAddressApi,
        summary,
        items,
    };
}

/**
 * 단일 캡처 이미지 조각(타일)에서 Gemini Vision으로 카카오톡 대화 텍스트 추출
 * 왜: 세로로 긴 스크롤 캡처 이미지를 적정 높이로 분할한 뒤 조각별로 호출해야
 * 모델 내부 리사이징으로 인한 전화번호 숫자·태국어 글자 뭉개짐을 방지할 수 있음.
 */
async function callGeminiExtractImageTile(tile, apiKey, modelName) {
    const targetModel = (modelName || DEFAULT_GEMINI_MODEL).trim();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        targetModel
    )}:generateContent?key=${encodeURIComponent(apiKey.trim())}`;

    const rawBase64 = String(tile?.data || '').replace(/^data:[^;]+;base64,/, '').trim();
    const mimeType = String(tile?.mimeType || 'image/jpeg').trim();

    if (!rawBase64) {
        return '';
    }

    const body = {
        systemInstruction: {
            parts: [{ text: IMAGE_OCR_SYSTEM_INSTRUCTION }],
        },
        contents: [
            {
                role: 'user',
                parts: [
                    {
                        inlineData: {
                            mimeType,
                            data: rawBase64,
                        },
                    },
                    {
                        text: '이 카카오톡 캡처 화면에서 말풍선 속 텍스트만 위에서 아래 순서대로 정확히 추출해 주세요.',
                    },
                ],
            },
        ],
        generationConfig: {
            temperature: 0.05,
        },
    };

    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60000),
    });

    if (!res.ok) {
        let errDetail = '';
        try {
            const errJson = await res.json();
            errDetail = errJson?.error?.message || JSON.stringify(errJson);
        } catch {
            errDetail = await res.text();
        }
        throw new Error(`Gemini 이미지 인식 오류 (${res.status}): ${errDetail}`);
    }

    const data = await res.json();
    const textOut = data?.candidates?.[0]?.content?.parts
        ?.map((p) => p.text || '')
        .join('')
        .trim();

    if (!textOut) {
        return '';
    }

    // 혹시 마크다운 코드블록(```)으로 감싸져 반환된 경우 안전하게 벗겨냄
    return textOut
        .replace(/^```(?:text|plain)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
}

/**
 * 분할된 세로 타일들의 텍스트를 위->아래 순서대로 병합하되,
 * 불가피하게 겹침(overlap) 구간에서 잘렸을 때 경계면에 동일 줄이 2번 찍히는 현상을 제거
 */
function mergeTileTextsWithoutOverlapDuplicate(tileTexts) {
    const validChunks = tileTexts.map((t) => String(t || '').trim()).filter(Boolean);
    if (validChunks.length === 0) return '';
    if (validChunks.length === 1) return validChunks[0];

    const normLine = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();
    let accLines = validChunks[0].split(/\r?\n/);

    for (let i = 1; i < validChunks.length; i++) {
        const nextLines = validChunks[i].split(/\r?\n/);

        // 이전 청크 끝부분 비어있지 않은 줄들과 다음 청크 앞부분 줄들의 최대 5줄 겹침 검사
        const prevNonEmptyIdx = [];
        for (let p = accLines.length - 1; p >= 0 && prevNonEmptyIdx.length < 5; p--) {
            if (accLines[p].trim()) prevNonEmptyIdx.unshift(p);
        }
        const nextNonEmptyIdx = [];
        for (let n = 0; n < nextLines.length && nextNonEmptyIdx.length < 5; n++) {
            if (nextLines[n].trim()) nextNonEmptyIdx.push(n);
        }

        let skipUntilNextIdx = 0;
        const maxCheck = Math.min(prevNonEmptyIdx.length, nextNonEmptyIdx.length);

        for (let k = maxCheck; k >= 1; k--) {
            let allMatch = true;
            for (let j = 0; j < k; j++) {
                const prevLine = accLines[prevNonEmptyIdx[prevNonEmptyIdx.length - k + j]];
                const nextLine = nextLines[nextNonEmptyIdx[j]];
                if (normLine(prevLine) !== normLine(nextLine) || normLine(prevLine).length < 3) {
                    allMatch = false;
                    break;
                }
            }
            if (allMatch) {
                skipUntilNextIdx = nextNonEmptyIdx[k - 1] + 1;
                break;
            }
        }

        const slicedNext = nextLines.slice(skipUntilNextIdx);
        if (slicedNext.length > 0) {
            if (accLines.length > 0 && accLines[accLines.length - 1].trim() !== '') {
                accLines.push('');
            }
            accLines = accLines.concat(slicedNext);
        }
    }

    return accLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * 카카오톡 캡처 이미지(단일 또는 세로 분할 타일 배열)에서 대화 원문 텍스트 추출
 */
async function extractTextFromKakaoImages(tiles, settings = {}) {
    const geminiApiKey = settings.gemini_api_key || process.env.GEMINI_API_KEY || '';
    const geminiModel = settings.gemini_model || DEFAULT_GEMINI_MODEL;

    if (!geminiApiKey.trim()) {
        throw new Error(
            'Gemini API 키가 설정되지 않았습니다. 우측 상단 [설정]에서 API 키를 입력해 주세요.'
        );
    }

    if (!Array.isArray(tiles) || tiles.length === 0) {
        throw new Error('분석할 캡처 이미지 데이터가 없습니다.');
    }

    if (tiles.length > 15) {
        throw new Error('한 이미지당 분할 조각이 너무 많습니다 (최대 15조각). 이미지를 나누어 올려주세요.');
    }

    // mapWithConcurrency는 입력 배열 인덱스 순서를 100% 보장함 (위 -> 아래 순서 엄격 유지)
    const tileTexts = await mapWithConcurrency(tiles, 2, (tile) =>
        callGeminiExtractImageTile(tile, geminiApiKey, geminiModel)
    );

    const mergedText = mergeTileTextsWithoutOverlapDuplicate(tileTexts);

    return {
        model: geminiModel,
        tileCount: tiles.length,
        text: mergedText,
    };
}

module.exports = {
    DEFAULT_GEMINI_MODEL,
    analyzeKakaoChatWithAI,
    extractTextFromKakaoImages,
    testGeminiConnection,
};
