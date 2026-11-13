-- 부동산고객: 명함 사진 백업. 사진 파일은 Cloudflare R2(버킷 realtor-cards)에 두고, 여기에는 파일 이름만 적는다.
ALTER TABLE realtor_responses ADD COLUMN card_key TEXT NOT NULL DEFAULT '';
-- 동의 문구: 사진을 보관하게 되었으므로 "저장하지 않습니다" 문장을 바꾼다 (해당 문장이 있는 문구만)
UPDATE realtor_forms SET consent_text = replace(consent_text, '당사 서버에는 사진을 저장하지 않습니다.', '사진은 백업용으로 줄여서 보유 기간 동안 보관합니다.') WHERE instr(consent_text, '당사 서버에는 사진을 저장하지 않습니다.') > 0;
