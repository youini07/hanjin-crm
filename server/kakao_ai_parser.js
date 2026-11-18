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

module.exports = {
    DEFAULT_GEMINI_MODEL,
    analyzeKakaoChatWithAI,
    testGeminiConnection,
};
