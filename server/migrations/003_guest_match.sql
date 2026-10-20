-- 방명록 자동 담당자 입력: 어떤 근거로 채웠는지(예약 / 방문이력)와 연결된 예약. 이미 운영 중인 DB 에 한 번만 실행한다.
ALTER TABLE guestbook ADD COLUMN auto_source TEXT NOT NULL DEFAULT '';
ALTER TABLE guestbook ADD COLUMN reservation_id TEXT NOT NULL DEFAULT '';
