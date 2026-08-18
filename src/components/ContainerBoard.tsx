"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Sheet } from "./Sheet";
import { formatKDateTime } from "@/lib/format";
import {
  recordContainerReturn,
  deleteContainerReturn,
  computeContainerBranchDetail,
  addContainerType,
  updateContainerType,
  type ContainerType,
  type ContainerBoard as Board,
  type ContainerBranchRow,
  type ContainerShipEntry,
  type ContainerReturnEntry,
} from "@/app/actions/container";

// 용기 회수 관리 보드 — 용기 탭 · 요약(나감/회수/미회수) · 지점별 목록 · 회수 기록/취소 · 용기 종류 관리.
// 나간 수량은 계산서에서 자동 집계(서버). 이 화면은 회수만 기록해 미회수를 남긴다.

const fmtYmd = (d: string) => {
  const [, m, dd] = d.split("-");
  return m && dd ? `${Number(m)}월 ${Number(dd)}일` : d;
};

export function ContainerBoard({
  allContainers,
  selectedId,
  board,
  today,
}: {
  allContainers: ContainerType[];
  selectedId: string;
  board: Board | null;
  today: string;
}) {
  const router = useRouter();
  const active = allContainers.filter((c) => c.active);
  const [manageOpen, setManageOpen] = useState(false);
  const [returnFor, setReturnFor] = useState<ContainerBranchRow | null>(null);

  return (
    <>
      <div className="cont-tabs">
        {active.map((c) => (
          <Link
            key={c.id}
            href={`/admin/containers?c=${c.id}`}
            className={`cont-tab${c.id === selectedId ? " is-on" : ""}`}
          >
            {c.name}
          </Link>
        ))}
        <button
          type="button"
          className="cont-tab cont-tab--add"
          onClick={() => setManageOpen(true)}
        >
          ＋ 용기
        </button>
      </div>

      {!board ? (
        <div
          className="card"
          style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}
        >
          아직 등록된 용기가 없어요. 위 <b>＋ 용기</b>로 아이스박스·우유 콘티를 추가하세요.
        </div>
      ) : (
        <>
          <div className="cont-sum">
            <div className="cont-sc">
              <div className="cont-sc__k">나감</div>
              <div className="cont-sc__v">{board.shippedTotal}</div>
            </div>
            <div className="cont-sc">
              <div className="cont-sc__k">회수</div>
              <div className="cont-sc__v">{board.returnedTotal}</div>
            </div>
            <div className="cont-sc is-warn">
              <div className="cont-sc__k">미회수</div>
              <div className="cont-sc__v">{board.outstandingTotal}</div>
            </div>
          </div>

          {board.branches.length === 0 ? (
            <div
              className="card"
              style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}
            >
              {fmtYmd(board.container.startDate)} 이후 이 용기가 나간 계산서가 아직 없어요.
              <div className="row__sub" style={{ marginTop: 6 }}>
                계산서 공구란에 “{board.container.matchKey}”가 들어가면 여기 집계됩니다.
              </div>
            </div>
          ) : (
            <>
              <div className="section-label">지점별 · 미회수 많은 순</div>
              {board.branches.map((b) => (
                <BranchRow
                  key={b.userId}
                  containerId={board.container.id}
                  row={b}
                  onReturn={() => setReturnFor(b)}
                />
              ))}
              <p className="row__sub" style={{ marginTop: 12 }}>
                ‘나감’은 {fmtYmd(board.container.startDate)}부터 발행된 계산서 공구란에서 자동 집계됩니다.
              </p>
            </>
          )}
        </>
      )}

      {returnFor && board && (
        <ReturnSheet
          container={board.container}
          branch={returnFor}
          onClose={() => setReturnFor(null)}
          onDone={() => {
            setReturnFor(null);
            router.refresh();
          }}
        />
      )}

      {manageOpen && (
        <ManageSheet
          containers={allContainers}
          today={today}
          onClose={() => setManageOpen(false)}
          onChanged={() => router.refresh()}
        />
      )}
    </>
  );
}

// ── 지점 행 + 펼침 상세(계산서별 나간 내역 + 회수 이력) ─────────────
function BranchRow({
  containerId,
  row,
  onReturn,
}: {
  containerId: string;
  row: ContainerBranchRow;
  onReturn: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<{
    shipments: ContainerShipEntry[];
    returns: ContainerReturnEntry[];
  } | null>(null);
  const [loading, setLoading] = useState(false);

  const loadDetail = async () => {
    setLoading(true);
    const d = await computeContainerBranchDetail(containerId, row.userId);
    setDetail(d);
    setLoading(false);
  };
  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (!detail) void loadDetail();
  };
  const delReturn = async (id: string) => {
    const res = await deleteContainerReturn(id);
    if (!res?.error) {
      await loadDetail();
      router.refresh();
    }
  };

  return (
    <>
      <div className="cont-brow">
        <button type="button" className="cont-brow__main" onClick={toggle}>
          <div className="cont-brow__name">{row.store}</div>
          <div className="cont-brow__stat">
            나감 <b>{row.shipped}</b> · 회수 <b>{row.returned}</b>
            {open ? " · 접기" : " · 상세"}
          </div>
        </button>
        <div className="cont-rem">
          <div className={`cont-rem__n${row.outstanding <= 0 ? " is-zero" : ""}`}>
            {row.outstanding}
          </div>
          <div className="cont-rem__u">미회수</div>
        </div>
        {row.outstanding > 0 ? (
          <button type="button" className="cont-recbtn" onClick={onReturn}>
            회수
          </button>
        ) : (
          <span className="cont-done">회수 완료</span>
        )}
      </div>

      {open && (
        <div className="cont-detail">
          {loading && !detail ? (
            <div className="row__sub">불러오는 중…</div>
          ) : detail ? (
            <>
              <div className="cont-detail__lbl">나간 내역 · 계산서 기준</div>
              {detail.shipments.length ? (
                detail.shipments.map((s) => (
                  <div className="cont-detail__row" key={s.date}>
                    <span>{fmtYmd(s.date)}</span>
                    <b>{s.qty}개</b>
                  </div>
                ))
              ) : (
                <div className="row__sub">나간 내역 없음</div>
              )}
              <div className="cont-detail__lbl">회수 이력</div>
              {detail.returns.length ? (
                detail.returns.map((r) => (
                  <div className="cont-detail__row" key={r.id}>
                    <span style={{ minWidth: 0 }}>
                      {formatKDateTime(new Date(r.returnedAt))} · 회수 {r.qty}개
                      {r.memo ? ` · ${r.memo}` : ""}
                    </span>
                    <button
                      type="button"
                      className="btn btn--xs btn--ghost"
                      onClick={() => delReturn(r.id)}
                    >
                      취소
                    </button>
                  </div>
                ))
              ) : (
                <div className="row__sub">회수 이력 없음</div>
              )}
            </>
          ) : null}
        </div>
      )}
    </>
  );
}

// ── 회수 기록 바텀시트 ──────────────────────────────────────────
function ReturnSheet({
  container,
  branch,
  onClose,
  onDone,
}: {
  container: ContainerType;
  branch: ContainerBranchRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const [qty, setQty] = useState(String(Math.max(1, branch.outstanding)));
  const [memo, setMemo] = useState("");
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();

  const bump = (d: number) =>
    setQty((q) => String(Math.max(0, (Math.floor(Number(q) || 0)) + d)));

  const submit = () => {
    setErr("");
    const n = Math.floor(Number(qty) || 0);
    if (n <= 0) {
      setErr("회수 수량을 입력하세요.");
      return;
    }
    start(async () => {
      const fd = new FormData();
      fd.set("containerId", container.id);
      fd.set("userId", branch.userId);
      fd.set("qty", String(n));
      fd.set("memo", memo);
      const res = await recordContainerReturn(fd);
      if (res?.error) {
        setErr(res.error);
        return;
      }
      onDone();
    });
  };

  return (
    <Sheet onClose={onClose}>
      <div className="sheet__panel">
        <div className="sheet__head">
          <div className="sheet__title">회수 기록</div>
          <button type="button" className="sheet__close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="sheet__fulfill">
          <span className="sheet__fulfillk">{container.name}</span>
          <span className="sheet__fulfillv">{branch.store}</span>
        </div>
        <div className="cont-rembox">
          <span className="cont-rembox__k">현재 미회수</span>
          <span className="cont-rembox__v">{branch.outstanding}개</span>
        </div>
        <div className="sheet__body">
          <div
            className="row__sub"
            style={{ fontWeight: 800, color: "var(--fg-soft)", margin: "0 2px 7px" }}
          >
            회수 수량
          </div>
          <div className="cont-step">
            <button type="button" onClick={() => bump(-1)} aria-label="빼기">
              −
            </button>
            <input
              inputMode="numeric"
              value={qty}
              onChange={(e) => setQty(e.target.value.replace(/[^\d]/g, ""))}
            />
            <button type="button" onClick={() => bump(1)} aria-label="더하기">
              ＋
            </button>
          </div>
          <input
            className="input"
            style={{ marginTop: 14 }}
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="메모 (선택) — 예: 배송기사 편에 회수"
            maxLength={200}
          />
          {err && (
            <div className="notice notice--error" style={{ marginTop: 10 }}>
              {err}
            </div>
          )}
        </div>
        <div className="sheet__foot">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            취소
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={pending}
            onClick={submit}
          >
            {pending ? "기록 중…" : "회수 기록하기"}
          </button>
        </div>
      </div>
    </Sheet>
  );
}

// ── 용기 종류 관리 바텀시트 ─────────────────────────────────────
function ManageSheet({
  containers,
  today,
  onClose,
  onChanged,
}: {
  containers: ContainerType[];
  today: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [name, setName] = useState("");
  const [matchKey, setMatchKey] = useState("");
  const [startDate, setStartDate] = useState(today);
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();

  const add = () => {
    setErr("");
    if (!name.trim()) {
      setErr("용기 이름을 입력하세요.");
      return;
    }
    start(async () => {
      const fd = new FormData();
      fd.set("name", name);
      fd.set("matchKey", matchKey);
      fd.set("startDate", startDate);
      const res = await addContainerType(fd);
      if (res?.error) {
        setErr(res.error);
        return;
      }
      setName("");
      setMatchKey("");
      onChanged();
    });
  };

  return (
    <Sheet onClose={onClose}>
      <div className="sheet__panel">
        <div className="sheet__head">
          <div className="sheet__title">용기 종류 관리</div>
          <button type="button" className="sheet__close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="sheet__hint">
          계산서 공구란에 이 매칭 키워드가 들어가면 나간 것으로 집계돼요. 기준일 이후 계산서만 셉니다.
        </div>
        <div className="sheet__body">
          {containers.map((c) => (
            <ContainerEditRow key={c.id} c={c} onChanged={onChanged} />
          ))}

          <div className="card" style={{ marginTop: 12 }}>
            <div
              className="row__sub"
              style={{ fontWeight: 800, color: "var(--fg)", marginBottom: 8 }}
            >
              ＋ 새 용기 추가
            </div>
            <input
              className="input"
              placeholder="용기 이름 (예: 아이스박스)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
            />
            <input
              className="input"
              style={{ marginTop: 8 }}
              placeholder="매칭 키워드 (비우면 이름과 동일)"
              value={matchKey}
              onChange={(e) => setMatchKey(e.target.value)}
              maxLength={60}
            />
            <label
              className="row__sub"
              style={{ display: "block", margin: "10px 2px 4px", fontWeight: 700 }}
            >
              집계 시작일 (기준일)
            </label>
            <input
              className="input"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
            {err && (
              <div className="notice notice--error" style={{ marginTop: 8 }}>
                {err}
              </div>
            )}
            <button
              type="button"
              className="btn btn--primary btn--block"
              style={{ marginTop: 10 }}
              disabled={pending || !name.trim()}
              onClick={add}
            >
              {pending ? "추가 중…" : "용기 추가"}
            </button>
          </div>
        </div>
      </div>
    </Sheet>
  );
}

function ContainerEditRow({
  c,
  onChanged,
}: {
  c: ContainerType;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(c.name);
  const [matchKey, setMatchKey] = useState(c.matchKey);
  const [startDate, setStartDate] = useState(c.startDate);
  const [active, setActive] = useState(c.active);
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();

  const save = () => {
    setErr("");
    if (!name.trim()) {
      setErr("용기 이름을 입력하세요.");
      return;
    }
    start(async () => {
      const fd = new FormData();
      fd.set("id", c.id);
      fd.set("name", name);
      fd.set("matchKey", matchKey);
      fd.set("startDate", startDate);
      fd.set("active", String(active));
      const res = await updateContainerType(fd);
      if (res?.error) {
        setErr(res.error);
        return;
      }
      setEditing(false);
      onChanged();
    });
  };

  if (!editing) {
    return (
      <div className="cont-brow">
        <div className="cont-brow__main" style={{ cursor: "default" }}>
          <div className="cont-brow__name">
            {c.name}
            {!c.active && (
              <span style={{ color: "var(--muted-2)", fontWeight: 700 }}> · 숨김</span>
            )}
          </div>
          <div className="cont-brow__stat">
            키워드 “{c.matchKey}” · {fmtYmd(c.startDate)}부터
          </div>
        </div>
        <button
          type="button"
          className="btn btn--xs btn--soft"
          onClick={() => setEditing(true)}
        >
          수정
        </button>
      </div>
    );
  }

  return (
    <div className="card" style={{ marginBottom: 9 }}>
      <input
        className="input"
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={60}
      />
      <input
        className="input"
        style={{ marginTop: 8 }}
        value={matchKey}
        onChange={(e) => setMatchKey(e.target.value)}
        maxLength={60}
        placeholder="매칭 키워드"
      />
      <label
        className="row__sub"
        style={{ display: "block", margin: "10px 2px 4px", fontWeight: 700 }}
      >
        집계 시작일 (기준일)
      </label>
      <input
        className="input"
        type="date"
        value={startDate}
        onChange={(e) => setStartDate(e.target.value)}
      />
      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginTop: 10,
          fontSize: 13,
          fontWeight: 700,
          color: "var(--fg-2)",
        }}
      >
        <input
          type="checkbox"
          checked={active}
          onChange={(e) => setActive(e.target.checked)}
        />
        탭에 표시 (활성)
      </label>
      {err && (
        <div className="notice notice--error" style={{ marginTop: 8 }}>
          {err}
        </div>
      )}
      <div className="confirm__actions" style={{ marginTop: 10 }}>
        <button
          type="button"
          className="btn btn--xs btn--ghost"
          onClick={() => setEditing(false)}
        >
          취소
        </button>
        <button
          type="button"
          className="btn btn--xs btn--primary"
          disabled={pending || !name.trim()}
          onClick={save}
        >
          {pending ? "저장 중…" : "저장"}
        </button>
      </div>
    </div>
  );
}
