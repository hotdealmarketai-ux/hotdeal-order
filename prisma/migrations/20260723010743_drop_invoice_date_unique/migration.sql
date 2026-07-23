-- 같은 점포·같은 날짜에 계산서를 여러 장 발행할 수 있게 부분 유니크 인덱스를 제거한다.
-- (기존 인덱스는 (userId,date,kind) where status<>'VOID' 로 kind별 하루 1장을 강제해
--  일반 계산서 '무한발행'(추가/부분 청구)을 막고 있었다. 사용자 결정: 일반·주간 모두 여러 장 허용.)
-- 이 인덱스는 Prisma 스키마로 표현 불가(부분 인덱스)라 raw SQL 마이그레이션으로만 관리했었다.
-- 제거 후엔 특별 인덱스가 없어 schema.prisma 와 DB 가 일치한다(db push 시 조용한 유실 위험도 사라짐).
DROP INDEX IF EXISTS "Invoice_userId_date_kind_active_key";
