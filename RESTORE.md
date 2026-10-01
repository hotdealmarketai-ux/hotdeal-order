# 재해 복구(Restore) 런북 — 오더야

DB·데이터가 전부 날아갔을 때 **빠짐없이 복원**하는 절차. 한 번도 안 해본 복원은 백업이 아니므로,
`restore-verify` 워크플로(주 1회)가 자동으로 복원 가능성을 검증한다.

## 백업이 어디에 있나

| 대상 | 백업 | 주기/보관 | 위치 |
|---|---|---|---|
| **DB 전체**(모든 테이블·관계) | `db-backup.yml` → `pg_dump -Fc` | 매일 07시 KST / 30일 | GitHub Actions 아티팩트 `neon-backup-*` |
| **업로드 파일**(사업자등록증·온보딩·채팅/메신저 첨부) | `media-backup.yml` | 매일 07시 KST / 30일 | GitHub Actions 아티팩트 `media-backup-*` |
| 복원 리허설(자동 검증) | `restore-verify.yml` | 주 1회(일 08시 KST) | — |

> ⚠ Neon 자체 복원(PITR)은 플랜상 **최근 6시간**뿐이다. 그보다 오래된 사고는 위 pg_dump 가 유일한 수단.
> ⚠ 백업은 GitHub 한 곳·30일뿐이다. 더 오래/이중으로 남기려면 아티팩트를 주기적으로 다른 저장소에 내려받아 둘 것.

## 1. DB 복원

```bash
# 1) 최신 성공 백업 받기 (gh CLI, 저장소 접근권한 있는 계정)
RID=$(gh run list -R hotdealmarketai-ux/hotdeal-order --workflow db-backup.yml --status success -L1 --json databaseId -q '.[0].databaseId')
gh run download "$RID" -R hotdealmarketai-ux/hotdeal-order -D restore
DUMP=$(find restore -name '*.dump' | head -1)   # 예: restore/neon-backup-xxx/neon-YYYYMMDD.dump

# 2) 새(빈) Postgres 준비
#    - Neon 콘솔에서 새 프로젝트/브랜치 생성, 또는 기존 DB를 비운 상태
#    - 직결(unpooled) 연결 문자열을 NEW_DB 에 넣는다 (-pooler 없는 host)
NEW_DB='postgresql://USER:PW@ep-xxxx.c-9.us-east-1.aws.neon.tech/neondb?sslmode=require'

# 3) 복원 (pg_dump 를 뜬 것과 같은 메이저 버전인 pg_restore 17 필요)
#    로컬에 pg17 없으면 docker 사용:
docker run --rm -v "$PWD/restore:/r" postgres:17 \
  pg_restore --no-owner --no-privileges -d "$NEW_DB" "/r/$(basename "$(dirname "$DUMP")")/$(basename "$DUMP")"
#    (역할/권한 관련 경고는 정상 — 데이터가 들어가면 성공)
```

복원 확인:
```bash
docker run --rm postgres:17 psql "$NEW_DB" -c "SELECT count(*) FROM \"User\";" -c "SELECT count(*) FROM \"Order\";"
```

## 2. 업로드 파일(미디어) 복원

`media-backup-*` 아티팩트를 받아 압축을 풀면 두 폴더가 나온다:
```bash
gh run download <media-backup run id> -R hotdealmarketai-ux/hotdeal-order -D media
tar -xzf media/media-backup-*/media-*.tar.gz -C media
# media/supabase/business-certs/*  : 사업자등록증·온보딩 이미지(원래 파일명=uuid 유지)
# media/vercel-blob/*              : 메신저/채팅 첨부(원래 pathname 유지)
```

- **Supabase**: 같은 bucket(`business-certs`)에 **같은 파일명 그대로** 업로드하면, DB 안의 URL
  (`.../object/public/business-certs/<uuid>.<ext>`)이 그대로 다시 맞는다. (같은 Supabase 프로젝트/도메인일 때)
- **Vercel Blob**: 다시 업로드하면 blob 호스트/경로가 **바뀌어** DB에 저장된 기존 URL과 안 맞을 수 있다.
  이 경우 새 URL로 재업로드 후, DB의 해당 참조(메신저 메시지 등)를 새 URL로 치환해야 한다.
  → Blob 백업은 "원본 파일 보존"이 1차 목적이고, 링크 완전복구는 수작업 치환이 필요할 수 있음(문서화된 한계).

## 3. 앱 재연결

- 새 DB 연결 문자열을 Vercel 환경변수에 반영(`hotdealorder_POSTGRES_PRISMA_URL` 등 Neon 연동이 자동 주입하는 값).
- `prisma migrate deploy` 는 **실행하지 말 것**(이미 덤프에 스키마 포함). 필요 시 스키마 일치만 확인.
- 재배포 후 로그인·발주·계산서·재고·메신저 동작 점검.

## 4. 평소 점검

- `db-backup` / `media-backup` / `restore-verify` 가 **초록(성공)** 인지 주기적으로 확인.
  (실패 시 자동으로 GitHub 이슈가 생성/코멘트된다. GitHub 알림 메일도 켜 둘 것.)
- 분기 1회 정도, 이 문서대로 **실제 복원 리허설**을 해볼 것.
