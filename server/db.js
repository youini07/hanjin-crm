const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { normalizeKoreanPhone, normalizeZipcode } = require('./utils/normalizer');

const dataDir = process.env.DATA_DIR || (process.pkg ? process.cwd() : __dirname);
const dbPath = path.join(dataDir, 'customers.db');

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Database connection error:', err.message);
    } else {
        console.log('Connected to SQLite database.');
        db.serialize(() => {
            db.run(`
                CREATE TABLE IF NOT EXISTS customers (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    phone TEXT UNIQUE NOT NULL,
                    name TEXT NOT NULL,
                    zipcode TEXT,
                    address TEXT,
                    detail_address TEXT,
                    fb_name TEXT DEFAULT '',
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);

            // 기존 customers 테이블에 fb_name 컬럼이 없는 경우 안전하게 추가
            db.all('PRAGMA table_info(customers)', [], (pragmaErr, cols) => {
                if (!pragmaErr && Array.isArray(cols)) {
                    const hasFbCol = cols.some((c) => c.name === 'fb_name');
                    if (!hasFbCol) {
                        db.run("ALTER TABLE customers ADD COLUMN fb_name TEXT DEFAULT ''");
                    }
                }
            });

            // 과거 채팅 내역에서 추출한 전체 전화번호별 최신 페이스북 아이디 사전 테이블
            // 왜: 아직 주소록(customers)에 등록되지 않은 과거 사진주문 고객이 추후 등록될 때에도 최신 FB 아이디를 자동 매칭하기 위함
            db.run(`
                CREATE TABLE IF NOT EXISTS fb_directory (
                    phone TEXT PRIMARY KEY,
                    fb_name TEXT NOT NULL,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);

            // 웹에서 입력한 API 키 및 AI 모델 설정 저장용 테이블
            db.run(`
                CREATE TABLE IF NOT EXISTS app_settings (
                    key TEXT PRIMARY KEY,
                    value TEXT,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);

            // 기존 DB에 4자리로 잘못 저장된 서울권(0xxxx) 우편번호를 5자리 문자열로 일괄 복구
            db.run(
                `UPDATE customers
                 SET zipcode = '0' || trim(zipcode), updated_at = CURRENT_TIMESTAMP
                 WHERE length(trim(zipcode)) = 4
                   AND trim(zipcode) GLOB '[0-9][0-9][0-9][0-9]'`,
                function (fixErr) {
                    if (!fixErr && this.changes > 0) {
                        console.log(
                            `✅ [DB 자동보정] 4자리 우편번호 ${this.changes}건을 5자리(0 포함)로 복구했습니다.`
                        );
                    }
                }
            );
        });
    }
});

/** DB 조회 결과 행의 전화번호와 5자리 우편번호를 정규화 */
const sanitizeCustomerRow = (row) => {
    if (!row) return row;
    return {
        ...row,
        phone: normalizeKoreanPhone(row.phone),
        zipcode: normalizeZipcode(row.zipcode),
        fb_name: row.fb_name ? String(row.fb_name).trim() : '',
    };
};

const getCustomerByPhone = (rawPhone) => {
    const phone = normalizeKoreanPhone(rawPhone);
    return new Promise((resolve, reject) => {
        db.get(
            "SELECT * FROM customers WHERE replace(phone, '-', '') = ?",
            [phone],
            (err, row) => {
                if (err) reject(err);
                else resolve(sanitizeCustomerRow(row));
            }
        );
    });
};

/** fb_directory에서 전화번호에 해당하는 최신 FB 아이디 조회 */
const getDirectoryFbByPhone = (phone) => {
    return new Promise((resolve) => {
        if (!phone) return resolve('');
        db.get('SELECT fb_name FROM fb_directory WHERE phone = ?', [phone], (err, row) => {
            if (err || !row) resolve('');
            else resolve(String(row.fb_name || '').trim());
        });
    });
};

/**
 * 고객 저장/업데이트 (fb_name은 새 값이 있을 때만 최신 값으로 갱신하고, 빈 값이면 기존 저장값 보존)
 */
const upsertCustomer = async (customer, isSync = false) => {
    const phone = normalizeKoreanPhone(customer.phone);
    const name = String(customer.name || '').trim();
    const zipcode = normalizeZipcode(customer.zipcode);
    const address = String(customer.address || '').trim();
    const detail_address = String(customer.detail_address || '').trim();
    let fb_name = customer.fb_name ? String(customer.fb_name).trim() : '';

    // 새 FB 이름이 들어왔으면 fb_directory 사전도 최신화하고, 없으면 사전에서 보완 조회
    if (fb_name && phone) {
        await new Promise((resolve) => {
            db.run(
                `INSERT INTO fb_directory (phone, fb_name, updated_at)
                 VALUES (?, ?, CURRENT_TIMESTAMP)
                 ON CONFLICT(phone) DO UPDATE SET fb_name = excluded.fb_name, updated_at = CURRENT_TIMESTAMP`,
                [phone, fb_name],
                () => resolve()
            );
        });
    } else if (phone) {
        fb_name = await getDirectoryFbByPhone(phone);
    }

    const normalizedCustomer = { phone, name, zipcode, address, detail_address, fb_name };

    return new Promise((resolve, reject) => {
        const query = `
            INSERT INTO customers (phone, name, zipcode, address, detail_address, fb_name, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(phone) DO UPDATE SET
                name = excluded.name,
                zipcode = excluded.zipcode,
                address = excluded.address,
                detail_address = excluded.detail_address,
                fb_name = CASE
                    WHEN excluded.fb_name IS NOT NULL AND excluded.fb_name != '' THEN excluded.fb_name
                    ELSE customers.fb_name
                END,
                updated_at = CURRENT_TIMESTAMP
        `;
        db.run(
            query,
            [phone, name, zipcode, address, detail_address, fb_name],
            async function (err) {
                if (err) {
                    reject(err);
                } else {
                    if (!isSync) {
                        try {
                            const { pushCustomerToSheet } = require('./google_sheets');
                            await pushCustomerToSheet(normalizedCustomer);
                        } catch (e) {
                            console.error('구글 시트 연동 실패:', e);
                        }
                    }
                    resolve(this.lastID);
                }
            }
        );
    });
};

const upsertCustomersLocalOnly = async (customers) => {
    for (const c of customers) {
        await upsertCustomer(c, true);
    }
};

/**
 * 대량 전화번호 -> 최신 FB 아이디 매핑 일괄 반영 (트랜잭션 최적화)
 */
const bulkApplyLatestFbMap = (phoneToFbEntries) => {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            db.run('BEGIN TRANSACTION');
            const dirStmt = db.prepare(`
                INSERT INTO fb_directory (phone, fb_name, updated_at)
                VALUES (?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(phone) DO UPDATE SET
                    fb_name = excluded.fb_name,
                    updated_at = CURRENT_TIMESTAMP
            `);
            const custStmt = db.prepare(`
                UPDATE customers
                SET fb_name = ?, updated_at = CURRENT_TIMESTAMP
                WHERE replace(phone, '-', '') = ?
            `);

            let updatedCustomers = 0;
            for (const [rawPhone, rawFb] of phoneToFbEntries) {
                const phone = normalizeKoreanPhone(rawPhone);
                const fb = String(rawFb || '').trim();
                if (!phone || !fb) continue;
                dirStmt.run([phone, fb]);
                custStmt.run([fb, phone], function () {
                    if (this && this.changes > 0) updatedCustomers += this.changes;
                });
            }

            dirStmt.finalize();
            custStmt.finalize();
            db.run('COMMIT', (err) => {
                if (err) reject(err);
                else resolve({ totalDirectoryCount: phoneToFbEntries.length, updatedCustomers });
            });
        });
    });
};

const getCustomersByPhones = (phones) => {
    return new Promise((resolve, reject) => {
        if (!phones || phones.length === 0) {
            return resolve([]);
        }
        const normalized = phones.map((p) => normalizeKoreanPhone(p)).filter(Boolean);
        if (normalized.length === 0) {
            return resolve([]);
        }
        const placeholders = normalized.map(() => '?').join(',');
        const query = `SELECT * FROM customers WHERE replace(phone, '-', '') IN (${placeholders})`;
        db.all(query, normalized, (err, rows) => {
            if (err) reject(err);
            else resolve((rows || []).map(sanitizeCustomerRow));
        });
    });
};

const fixFourDigitZipcodesInDB = () => {
    return new Promise((resolve, reject) => {
        db.run(
            `UPDATE customers
             SET zipcode = '0' || trim(zipcode), updated_at = CURRENT_TIMESTAMP
             WHERE length(trim(zipcode)) = 4
               AND trim(zipcode) GLOB '[0-9][0-9][0-9][0-9]'`,
            function (err) {
                if (err) reject(err);
                else resolve(this.changes || 0);
            }
        );
    });
};

const getAllSettings = () => {
    return new Promise((resolve, reject) => {
        db.all('SELECT key, value FROM app_settings', [], (err, rows) => {
            if (err) return reject(err);
            const map = {};
            for (const r of rows || []) {
                map[r.key] = r.value || '';
            }
            resolve(map);
        });
    });
};

const getSetting = async (key, defaultValue = '') => {
    const all = await getAllSettings();
    return all[key] !== undefined && all[key] !== '' ? all[key] : defaultValue;
};

const saveSettings = async (settingsObj, isSync = false) => {
    const entries = Object.entries(settingsObj).filter(([, v]) => v !== undefined);
    await new Promise((resolve, reject) => {
        db.serialize(() => {
            const stmt = db.prepare(`
                INSERT INTO app_settings (key, value, updated_at)
                VALUES (?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(key) DO UPDATE SET
                    value = excluded.value,
                    updated_at = CURRENT_TIMESTAMP
            `);
            for (const [k, v] of entries) {
                stmt.run([k, String(v ?? '').trim()]);
            }
            stmt.finalize((err) => (err ? reject(err) : resolve()));
        });
    });

    if (!isSync) {
        try {
            const allSettings = await getAllSettings();
            const { pushSettingsToSheet } = require('./google_sheets');
            await pushSettingsToSheet(allSettings);
        } catch (err) {
            console.error('구글 시트 설정 백업 실패 (로컬 저장은 완료됨):', err.message);
        }
    }
};

module.exports = {
    db,
    getCustomerByPhone,
    getCustomersByPhones,
    getDirectoryFbByPhone,
    upsertCustomer,
    upsertCustomersLocalOnly,
    bulkApplyLatestFbMap,
    fixFourDigitZipcodesInDB,
    getAllSettings,
    getSetting,
    saveSettings,
};
