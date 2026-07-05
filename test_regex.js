const text = `강원도 평창군 진부면 방아다리로 11
정기승  010  9164  2130 `;
const PHONE_REGEX = /(?:☎|📞|☏|✆|전화|핸드폰|HP|hp)?[\s]*0[1-9][0-9][-.\s]*[0-9]{3,4}[-.\s]*[0-9]{4}/g;
console.log("Match:", text.match(PHONE_REGEX));

const normalizePhone = (raw) => raw.replace(/[^0-9]/g, '');
const matches = text.match(PHONE_REGEX) || [];
const normalized = matches.map(normalizePhone).filter(p => p.length >= 10 && p.length <= 11);
console.log("Normalized:", normalized);
