const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const { getCustomerByPhone, getCustomersByPhones, upsertCustomer } = require('./db');
const { appendToDailyExcel, appendMultipleToDailyExcel } = require('./excel_service');
const { syncFromSheetToDB } = require('./google_sheets');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});
const PORT = 3001;

// [웹소켓] 공유 그리드 상태
let sharedGridRows = [];

io.on('connection', (socket) => {
    console.log(`[Socket] Client connected: ${socket.id}`);
    
    // 새 클라이언트가 접속하면 현재 그리드 상태를 보내줌
    socket.emit('init_grid', sharedGridRows);

    // 클라이언트로부터 그리드 업데이트 내역 수신 시
    socket.on('update_grid', (newRows) => {
        sharedGridRows = newRows;
        // 다른 모든 클라이언트에게 변경된 그리드 브로드캐스트
        socket.broadcast.emit('grid_updated', sharedGridRows);
    });

    socket.on('disconnect', () => {
        console.log(`[Socket] Client disconnected: ${socket.id}`);
    });
});

app.use(cors());
app.use(express.json());

// 정적 프론트엔드 파일 서빙
app.use(express.static(path.join(__dirname, 'public')));

// ──────────────────────────────────────────────────────
// [기존 API] 전화번호로 단일 고객 검색
// ──────────────────────────────────────────────────────
app.get('/api/customers/search', async (req, res) => {
    let { phone } = req.query;
    if (!phone) {
        return res.status(400).json({ error: 'Phone number is required' });
    }

    // 모든 특수기호, 공백, 하이픈 무시하고 숫자만 추출
    phone = phone.replace(/[^0-9]/g, '');

    try {
        const customer = await getCustomerByPhone(phone);
        if (customer) {
            res.json({ success: true, customer });
        } else {
            res.json({ success: false, message: 'Customer not found' });
        }
    } catch (err) {
        console.error('DB Error:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// ──────────────────────────────────────────────────────
// [기존 API] 고객 저장 + 엑셀 추가 (단건)
// ──────────────────────────────────────────────────────
app.post('/api/customers/save-and-export', async (req, res) => {
    let { phone, name, zipcode, address, detail_address } = req.body;
    
    if (!phone || !name) {
        return res.status(400).json({ error: 'Phone and Name are required' });
    }

    phone = phone.replace(/[^0-9]/g, '');

    try {
        await upsertCustomer({ phone, name, zipcode, address, detail_address });
        const excelPath = await appendToDailyExcel({ phone, name, zipcode, address, detail_address });
        res.json({ success: true, message: 'Saved to DB and Excel', excelPath });
    } catch (err) {
        console.error('Save/Export Error:', err);
        res.status(500).json({ error: 'Failed to save or export: ' + err.message });
    }
});

// ──────────────────────────────────────────────────────
// [신규 API] 전화번호 배열로 한 번에 고객 매칭
// 왜: 카카오톡에서 추출한 여러 전화번호를 한 번에 DB 조회하기 위함
// ──────────────────────────────────────────────────────
app.post('/api/customers/bulk-match', async (req, res) => {
    const { phones } = req.body;

    if (!phones || !Array.isArray(phones) || phones.length === 0) {
        return res.status(400).json({ error: 'phones 배열이 필요합니다.' });
    }

    try {
        // 모든 전화번호를 숫자만 추출하여 정규화
        const normalizedPhones = phones.map(p => String(p).replace(/[^0-9]/g, ''));

        // DB에서 한 번에 조회
        const foundCustomers = await getCustomersByPhones(normalizedPhones);

        // 전화번호 → 고객 정보 맵 생성
        const customerMap = {};
        for (const c of foundCustomers) {
            customerMap[c.phone] = c;
        }

        // 각 전화번호에 대해 매칭 결과 생성
        const results = normalizedPhones.map(phone => {
            const customer = customerMap[phone];
            if (customer) {
                return {
                    phone,
                    found: true,
                    customer: {
                        id: customer.id,
                        name: customer.name,
                        phone: customer.phone,
                        zipcode: customer.zipcode || '',
                        address: customer.address || '',
                        detail_address: customer.detail_address || ''
                    }
                };
            } else {
                // 신규 고객: 전화번호만 채우고 나머지 빈칸
                return {
                    phone,
                    found: false,
                    customer: {
                        name: '',
                        phone,
                        zipcode: '',
                        address: '',
                        detail_address: ''
                    }
                };
            }
        });

        res.json({ success: true, results });
    } catch (err) {
        console.error('Bulk Match Error:', err);
        res.status(500).json({ error: 'DB 매칭 중 오류: ' + err.message });
    }
});

// ──────────────────────────────────────────────────────
// [신규 API] 여러 고객 일괄 저장 + 엑셀 내보내기
// 왜: 그리드에서 수정한 데이터를 한 번에 DB 저장 + 엑셀 생성
// 내보내기 시에만 DB 저장 (임시 상태 → 확정)
// ──────────────────────────────────────────────────────
app.post('/api/customers/bulk-save-and-export', async (req, res) => {
    const { customers } = req.body;

    if (!customers || !Array.isArray(customers) || customers.length === 0) {
        return res.status(400).json({ error: 'customers 배열이 필요합니다.' });
    }

    try {
        let savedCount = 0;
        let skippedCount = 0;

        // 1단계: 모든 고객을 DB에 upsert (이름이 있는 경우만)
        for (const c of customers) {
            const phone = String(c.phone).replace(/[^0-9]/g, '');
            if (!phone || !c.name) {
                skippedCount++;
                continue;
            }
            await upsertCustomer({
                phone,
                name: c.name,
                zipcode: c.zipcode || '',
                address: c.address || '',
                detail_address: c.detail_address || ''
            });
            savedCount++;
        }

        // 2단계: 유효한 고객만 엑셀에 일괄 추가
        const validCustomers = customers.filter(c => {
            const phone = String(c.phone).replace(/[^0-9]/g, '');
            return phone && c.name;
        }).map(c => ({
            ...c,
            phone: String(c.phone).replace(/[^0-9]/g, '')
        }));

        let excelPath = '';
        if (validCustomers.length > 0) {
            excelPath = await appendMultipleToDailyExcel(validCustomers);
        }

        res.json({
            success: true,
            message: `${savedCount}건 저장, ${skippedCount}건 스킵 (이름 미입력)`,
            savedCount,
            skippedCount,
            excelPath
        });
    } catch (err) {
        console.error('Bulk Save/Export Error:', err);
        res.status(500).json({ error: '일괄 저장/내보내기 실패: ' + err.message });
    }
});

// React SPA fallback
app.get(/.*/, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 서버 시작 + 구글 시트 동기화
server.listen(PORT, '0.0.0.0', async () => {
    console.log(`Backend server running on http://0.0.0.0:${PORT}`);
    // 서버가 켜질 때 백그라운드에서 구글 시트 데이터를 로컬 DB로 동기화
    await syncFromSheetToDB();
});
