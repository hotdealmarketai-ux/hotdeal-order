"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { upload } from "@vercel/blob/client";
import { compressImage } from "@/lib/image-compress";
import { Sheet } from "@/components/Sheet";
import { MediaLightbox } from "@/components/MediaLightbox";
import {
  loadMessengerMinutesAction,
  createMessengerMinutesAction,
  markMessengerMinutesReadAction,
  deleteMessengerMinutesAction,
  type MinutesDTO,
} from "@/app/actions/messenger";

const WD = ["일", "월", "화", "수", "목", "금", "토"];
// yyyy-mm-dd → 요일 인덱스(순수 달력 날짜, 로컬 자정 생성으로 TZ 밀림 없음).
const weekdayOf = (ymd: string) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d).getDay();
};
const kstToday = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const monthLabel = (ymd: string) => `${Number(ymd.slice(0, 4))}년 ${Number(ymd.slice(5, 7))}월`;
const titleOf = (ymd: string) => `${Number(ymd.slice(5, 7))}월 ${Number(ymd.slice(8, 10))}일 회의`;

const AV_COLORS = ["#2f5bea", "#1e3a9e", "#5b8def", "#7c6cf0", "#2aa198", "#e08a1e", "#d64d7a"];
const avColor = (name: string) => {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AV_COLORS[h % AV_COLORS.length];
};
const initial = (name: string) => (name.trim()[0] ?? "?");
const MAX_IMAGES = 30; // 서버 MINUTES_MAX_IMAGES와 동일하게 유지.

// 회의록 — 회의 사진(A4 세로)을 날짜별로 보관. 카드 누르면 전체화면 슬라이드 뷰어, 하단에 읽은 사람 표시.
export function MinutesPane({ me }: { me: { id: string; name: string } }) {
  const [items, setItems] = useState<MinutesDTO[] | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [viewer, setViewer] = useState<{ urls: string[] } | null>(null);
  const [confirmDel, setConfirmDel] = useState<MinutesDTO | null>(null);
  const [delBusy, setDelBusy] = useState(false);

  const reload = async () => {
    try {
      const r = await loadMessengerMinutesAction();
      setItems(r);
    } catch {
      setItems([]);
    }
  };
  useEffect(() => {
    reload();
  }, []);

  // 월별 그룹(이미 최신 날짜순 정렬됨).
  const groups = useMemo(() => {
    const out: { key: string; label: string; rows: MinutesDTO[] }[] = [];
    for (const m of items ?? []) {
      const key = m.date.slice(0, 7);
      const g = out.find((x) => x.key === key);
      if (g) g.rows.push(m);
      else out.push({ key, label: monthLabel(m.date), rows: [m] });
    }
    return out;
  }, [items]);

  const openViewer = (m: MinutesDTO) => {
    if (!m.imageUrls.length) return;
    setViewer({ urls: m.imageUrls });
    // 처음 열 때 읽음 기록(낙관적).
    if (!m.readByMe) {
      setItems((prev) =>
        prev?.map((x) =>
          x.id === m.id
            ? { ...x, readByMe: true, readers: x.readers.some((r) => r.id === me.id) ? x.readers : [...x.readers, { id: me.id, name: me.name }] }
            : x,
        ) ?? prev,
      );
      // 서버 실패 시 낙관적 '읽음'을 롤백(다른 팀원 화면과 불일치 방지).
      const rollback = () =>
        setItems((prev) =>
          prev?.map((x) => (x.id === m.id ? { ...x, readByMe: false, readers: x.readers.filter((r) => r.id !== me.id) } : x)) ?? prev,
        );
      markMessengerMinutesReadAction(m.id)
        .then((r) => {
          if (!r?.ok) rollback();
        })
        .catch(rollback);
    }
  };

  const doDelete = async () => {
    if (!confirmDel || delBusy) return;
    setDelBusy(true);
    const id = confirmDel.id;
    const r = await deleteMessengerMinutesAction(id).catch(() => ({ error: "삭제에 실패했어요." }));
    setDelBusy(false);
    if (r?.error) {
      alert(r.error);
      return;
    }
    setItems((prev) => prev?.filter((x) => x.id !== id) ?? prev);
    setConfirmDel(null);
  };

  return (
    <div className="mn">
      <div className="mn__inner">
        <div className="mn__head">
          <div className="mn__hi">회의록</div>
          <div className="mn__sub">우리 팀 회의 기록</div>
        </div>

        {items === null ? (
          <div className="mn__empty">불러오는 중…</div>
        ) : items.length === 0 ? (
          <div className="mn__empty">
            아직 올라온 회의록이 없어요.
            <br />
            아래 <b>＋ 업로드</b>로 첫 회의록을 올려보세요.
          </div>
        ) : (
          groups.map((g) => (
            <div className="mn__group" key={g.key}>
              <div className="mn__daylabel">{g.label}</div>
              {g.rows.map((m) => (
                <div
                  className="mncard"
                  key={m.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => openViewer(m)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      openViewer(m);
                    }
                  }}
                >
                  <div className="mncard__badge">
                    <b>{m.date.slice(8, 10)}</b>
                    <span>{WD[weekdayOf(m.date)]}</span>
                  </div>
                  <div className="mncard__main">
                    <div className="mncard__title">{titleOf(m.date)}</div>
                    {m.agenda ? (
                      <div className="mncard__agenda">{m.agenda}</div>
                    ) : (
                      <div className="mncard__agenda mncard__agenda--none">안건 메모 없음</div>
                    )}
                    <div className="mncard__foot">
                      <span className="mncard__count">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                          <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="2" />
                          <circle cx="8.5" cy="10" r="1.6" fill="currentColor" />
                          <path d="M5 17l4-4 3 3 3-4 4 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        {m.imageUrls.length}장
                      </span>
                      <div className="mncard__reads">
                        {m.readers.length > 0 ? (
                          <>
                            <span className="avstack">
                              {m.readers.slice(0, 5).map((r) => (
                                <span className="av" key={r.id} style={{ background: avColor(r.name) }}>
                                  {initial(r.name)}
                                </span>
                              ))}
                            </span>
                            <span className="mncard__readtxt">{m.readers.length}명 읽음</span>
                          </>
                        ) : (
                          <span className="mncard__readtxt mncard__readtxt--none">아직 읽지 않음</span>
                        )}
                      </div>
                    </div>
                    {m.readers.length > 0 && (
                      <div className="mncard__readers">{m.readers.map((r) => r.name).join(" · ")}</div>
                    )}
                  </div>
                  {m.mine && (
                    <span
                      className="mncard__del"
                      role="button"
                      tabIndex={0}
                      aria-label="회의록 삭제"
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmDel(m);
                      }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path d="M5 7h14M10 7V5h4v2M8 7l1 12h6l1-12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                  )}
                </div>
              ))}
            </div>
          ))
        )}
      </div>

      <button type="button" className="mn__fab" onClick={() => setUploadOpen(true)}>
        <span className="mn__fabplus">＋</span> 업로드
      </button>

      {viewer && <MediaLightbox media={{ src: viewer.urls[0], type: "image" }} group={viewer.urls} onClose={() => setViewer(null)} />}

      {uploadOpen && (
        <MinutesUploadSheet
          onClose={() => setUploadOpen(false)}
          onCreated={() => {
            setUploadOpen(false);
            reload();
          }}
        />
      )}

      {confirmDel && (
        <Sheet onClose={() => (delBusy ? null : setConfirmDel(null))}>
          <div className="sheet__panel mn-confirm">
            <div className="mn-confirm__t">이 회의록을 삭제할까요?</div>
            <div className="mn-confirm__d">{titleOf(confirmDel.date)} · 사진 {confirmDel.imageUrls.length}장. 삭제하면 되돌릴 수 없어요.</div>
            <div className="mn-confirm__row">
              <button type="button" className="mn-btn mn-btn--ghost" onClick={() => setConfirmDel(null)} disabled={delBusy}>
                취소
              </button>
              <button type="button" className="mn-btn mn-btn--danger" onClick={doDelete} disabled={delBusy}>
                {delBusy ? "삭제 중…" : "삭제"}
              </button>
            </div>
          </div>
        </Sheet>
      )}
    </div>
  );
}

// ── 업로드 바텀시트 ──────────────────────────────────────────
type Pic = { key: string; preview: string; url: string | null; pct: number };

function MinutesUploadSheet({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [date, setDate] = useState(kstToday());
  const [agenda, setAgenda] = useState("");
  const [pics, setPics] = useState<Pic[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const keySeq = useRef(0);
  // 최신 pics를 ref로 추적 — 언마운트 cleanup이 최초 렌더의 빈 배열을 캡처하지 않게(stale closure 방지).
  const picsRef = useRef<Pic[]>([]);
  picsRef.current = pics;

  // 컴포넌트 해제 시 미리보기 objectURL 정리.
  useEffect(
    () => () => {
      picsRef.current.forEach((p) => URL.revokeObjectURL(p.preview));
    },
    [],
  );

  const addFiles = async (files: File[]) => {
    setErr("");
    const room = MAX_IMAGES - pics.length;
    if (room <= 0) {
      setErr(`사진은 최대 ${MAX_IMAGES}장까지 올릴 수 있어요.`);
      return;
    }
    const all = files.filter((f) => f.type.startsWith("image"));
    const imgs = all.slice(0, room); // 남은 자리만큼만(초과 업로드→유실·고아 방지).
    if (!imgs.length) return;
    if (all.length > imgs.length) setErr(`사진은 최대 ${MAX_IMAGES}장까지예요. 초과분은 제외했어요.`);
    const entries: Pic[] = imgs.map((f) => ({ key: `p${keySeq.current++}`, preview: URL.createObjectURL(f), url: null, pct: 0 }));
    setPics((prev) => [...prev, ...entries]);
    await Promise.all(
      imgs.map(async (f, i) => {
        const key = entries[i].key;
        try {
          const cf = await compressImage(f);
          const b = await upload(cf.name, cf, {
            access: "public",
            handleUploadUrl: "/api/chat/upload",
            contentType: cf.type || undefined,
            onUploadProgress: (ev) =>
              setPics((prev) => prev.map((p) => (p.key === key ? { ...p, pct: Math.round(ev.percentage) } : p))),
          });
          setPics((prev) => prev.map((p) => (p.key === key ? { ...p, url: b.url, pct: 100 } : p)));
        } catch {
          setPics((prev) => prev.filter((p) => p.key !== key));
          setErr("사진 업로드에 실패했어요. 다시 시도해 주세요.");
        }
      }),
    );
  };

  const removePic = (key: string) => {
    setPics((prev) => {
      const p = prev.find((x) => x.key === key);
      if (p) URL.revokeObjectURL(p.preview);
      return prev.filter((x) => x.key !== key);
    });
  };

  const uploading = pics.some((p) => p.url === null);
  const ready = pics.filter((p) => p.url).length;
  const canSubmit = !!date && ready > 0 && !uploading && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setErr("");
    const fd = new FormData();
    fd.set("date", date);
    fd.set("agenda", agenda.trim());
    pics.forEach((p) => p.url && fd.append("imageUrls", p.url));
    const r = await createMessengerMinutesAction(fd).catch(() => ({ error: "등록에 실패했어요." }));
    setBusy(false);
    if (r?.error) {
      setErr(r.error);
      return;
    }
    onCreated();
  };

  return (
    <Sheet onClose={() => (busy ? null : onClose())}>
      <div className="sheet__panel mn-up">
        <div className="mn-up__grip" />
        <div className="mn-up__h">회의록 올리기</div>
        <div className="mn-up__sub">회의 날짜와 안건을 적고, 회의록 사진을 올려주세요.</div>

        <div className="mn-up__scroll">
          <div className="mn-fld">
            <div className="mn-fld__l">
              <span className="req">*</span> 회의 날짜
            </div>
            <input type="date" className="mn-input" value={date} max={kstToday()} onChange={(e) => setDate(e.target.value)} />
          </div>

          <div className="mn-fld">
            <div className="mn-fld__l">
              안건 목차 <span className="opt">(간단히)</span>
            </div>
            <textarea
              className="mn-input mn-input--ta"
              value={agenda}
              onChange={(e) => setAgenda(e.target.value)}
              placeholder={"예)\n1. 발주 프로세스 개선\n2. 라벨 재정비\n3. 신규 상품 소싱"}
            />
          </div>

          <div className="mn-fld">
            <div className="mn-fld__l">
              <span className="req">*</span> 회의록 사진
            </div>
            <div className="mn-photos">
              {pics.map((p) => (
                <div className="mn-ph" key={p.key}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.preview} alt="회의록" />
                  {p.url === null && (
                    <span className="mn-ph__prog">
                      <span className="mn-ph__bar" style={{ width: `${p.pct}%` }} />
                    </span>
                  )}
                  <button type="button" className="mn-ph__x" aria-label="사진 제거" onClick={() => removePic(p.key)}>
                    ✕
                  </button>
                </div>
              ))}
              {pics.length < MAX_IMAGES && (
                <button type="button" className="mn-ph mn-ph--add" onClick={() => fileRef.current?.click()} aria-label="사진 추가">
                  ＋
                </button>
              )}
            </div>
            <div className="mn-photos__tag">A4 세로 이미지 · 올린 순서대로 넘겨보기 · 최대 {MAX_IMAGES}장</div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                addFiles(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />
          </div>

          {err && <div className="mn-up__err">{err}</div>}
        </div>

        <button type="button" className="mn-cta" onClick={submit} disabled={!canSubmit}>
          {busy ? "올리는 중…" : uploading ? "사진 준비 중…" : "올리기"}
        </button>
      </div>
    </Sheet>
  );
}
