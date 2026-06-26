# 복귀 후 안내 (HANDOFF)

## ✅ 지금까지 완성·검증된 것 (로컬에서 실제 동작 확인)
- 로그인 / 가입신청 / 승인대기 화면, **30일 자동로그인**, 로그아웃
- 가입신청(상호명·연락처·소재지·사업자등록증) → 관리자 승인 시 유형 배정(핫딜 가맹점 / 서부일광 소매)
- 발주 입력(오토그로우 칸, 품목/수량/부연설명) → **AI/규칙기반 정리 → 영수증**(원본 보기 · 장끼 출력)
- **카테고리 라우팅 검증 완료**: 과일→서부일광, 야채→장흥, 두부→채움채, 공구→새롭
- 업자 4개 계정 발주 inbox(목록→상세 발주서), 서부일광은 가맹점+소매 발주 모두 수신·픽업시간 표시
- 새롭(관리자): 전체 발주 / 핫딜마켓 전용 필터 / 공구 inbox / 가입승인 / 재고현황 작성
- 핫딜 가맹점 하단 네비 + 재고현황 열람, 마이페이지(프로필 수정·지난 발주)
- `npm run build` 프로덕션 빌드 통과(18개 라우트, 타입 체크 OK)

## 🔑 복귀 후 채울 값 (`.env.local`)
아래만 채우면 해당 기능이 자동으로 켜집니다.

```ini
# 1) 실제 AI 정리 (없으면 규칙기반으로 계속 동작)
ANTHROPIC_API_KEY="sk-ant-..."

# 2) (배포 시) Supabase Storage — 사업자등록증 운영 저장
NEXT_PUBLIC_SUPABASE_URL="https://<ref>.supabase.co"
SUPABASE_SERVICE_ROLE_KEY="..."
```

## ☁️ 운영 배포 (Supabase + Vercel) — 키 받은 뒤
1. **Supabase 프로젝트 생성** → Settings → Database → Connection string(URI) 복사.
2. 그 값으로 `.env`(또는 Vercel 환경변수)의 `DATABASE_URL` 교체.
3. 스키마/시드 반영:
   ```bash
   npx prisma migrate deploy   # 운영 DB에 스키마 적용
   npm run db:seed             # (선택) 초기 계정/데이터
   ```
4. **Vercel 배포**:
   ```bash
   vercel login        # 또는 토큰
   vercel link
   # 환경변수 등록: DATABASE_URL, AUTH_SECRET(openssl rand -base64 32),
   #               AUTH_TRUST_HOST=true, ANTHROPIC_API_KEY, (Supabase 키들)
   vercel --prod
   ```
   - 빌드 시 `postinstall: prisma generate` 가 자동 실행됩니다.
   - 사업자등록증은 로컬은 `/public/uploads`, 운영은 Supabase Storage(`business-certs` 버킷)로 저장됩니다. 버킷을 미리 만들어 두세요(public read).

## 🧭 의도적으로 '나중에'로 미뤄둔 것 (요청대로)
- **품목 학습 사전 / 품종 묶음 집계 발주서 / 다이→숫자 환산**: 중매인과 디테일 잡은 뒤 별도 진행.
  지금 AI는 '건별 영수증 정리'까지만(의미 보존, 표기 정리). 학습 시 `src/lib/ai.ts` 에 사전/RAG 계층을 얹으면 됩니다.

## 🔒 적대적 코드리뷰 + 보강 (2026-06-26, 다중 에이전트)
검증된 결함 11건 중 머니/보안 핵심을 즉시 수정:
- **(치명) AI 정리본 인덱스 어긋남** → 정리본은 입력과 개수가 1:1일 때만 신뢰, 아니면 원본 그대로 저장(`order.ts`, `ai.ts`). 수량이 엉뚱한 품목에 붙는 사고 차단.
- **(높음) 업자/관리자 승인상태 미검사** → `requireVendor/requireAdmin`에도 `status===APPROVED` 가드 추가(반려/미승인 계정 접근 차단).
- **(높음) 사업자등록증 업로드** → 확장자 화이트리스트(jpg/png/webp/pdf)+10MB 상한, 화이트리스트 밖은 `.bin`으로 저장(저장형 XSS 차단).
- **발주 품목 수/길이 상한**(100건·필드 길이), **저장 실패 try/catch**, **가입 username 경쟁조건(P2002) 처리**, **bcrypt 코스트 12**, **운영 AUTH_SECRET 플레이스홀더 경고**.

남은 선택 보강(차후): 로그인 **레이트리밋/계정잠금**(현재 없음), 신원변경 시 기존 JWT 즉시 무효화(tokenVersion). 비밀번호 최소 길이는 **어르신 편의 위해 4자 유지**(의도적).

## 📌 참고
- 로컬 DB 데이터 디렉터리: `.localpg/` (gitignore). `npm run db:stop` 으로 정지.
- 라우팅·역할 규칙은 `src/lib/constants.ts` 한 곳에서 관리.
