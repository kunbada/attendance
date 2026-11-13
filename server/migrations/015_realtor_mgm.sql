-- 부동산고객 보완: MGM 참여 여부, 고객 DB 와 묶는 키(휴대폰 또는 사무실 전화 해시). 기존 행은 목록을 열 때 키가 채워진다.
ALTER TABLE realtor_responses ADD COLUMN mgm TEXT NOT NULL DEFAULT '';          -- 부동산 MGM 참여 여부: 참여 / 불참 / 고려중
ALTER TABLE realtor_responses ADD COLUMN cust_hash TEXT NOT NULL DEFAULT '';    -- 고객 DB 연결 키
CREATE INDEX IF NOT EXISTS ix_realtor_cust ON realtor_responses(project_id, cust_hash);
-- 명함 정보는 동의와 무관하게 저장하므로, 예전 기본 동의 문구(거부 시 저장 안 함)를 새 기본 문구로 바꾼다. 직접 고친 문구는 그대로 둔다
UPDATE realtor_forms SET consent_text = '당사는 현장 분양 업무 협력(분양 정보 안내, 고객 소개 협의)을 위해 아래와 같이 개인정보를 수집·이용합니다.

1. 수집 항목: 명함에 적힌 정보(상호, 성명, 직함, 휴대폰·사무실 전화, 주소)
2. 이용 목적: 분양 정보 안내, 고객 소개·부동산 MGM 관련 연락
3. 보유 기간: 현장 분양 종료 후 6개월 (이후 파기)
4. 명함 사진은 글자를 읽기 위해 외부 AI 서비스(Google)로 보내지며, 당사 서버에는 사진을 저장하지 않습니다.

위 내용에 동의하지 않으실 수 있습니다. 동의 여부는 기록되며, 연락을 원하지 않으시면 담당자에게 말씀해 주세요.' WHERE instr(consent_text, '조사 응답만 기록합니다') > 0;
