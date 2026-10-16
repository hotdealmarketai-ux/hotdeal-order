"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  setOrderModeFlagAction,
  addFixedItemAction,
  updateFixedItemAction,
  toggleFixedItemAction,
  deleteFixedItemAction,
  moveFixedItemAction,
} from "@/app/actions/order-config";

type FixedItem = { id: string; name: string; active: boolean };
type Cfg = {
  gridOff: boolean;
  chatOff: boolean;
  fixedFruit: boolean;
  fixedVeg: boolean;
};

export function OrderConfigBoard({
  config,
  fruitItems,
  vegItems,
  restrict = { on: false, allStores: true, active: false },
}: {
  config: Cfg;
  fruitItems: FixedItem[];
  vegItems: FixedItem[];
  // 품목 제한 모드(편성 달력) — 적용 중인 지점에는 '품목 고정'이 쓰이지 않고 채팅 발주는 자동 잠금.
  // active = 시작 창에 이르러 지금 적용 중(시작 전 예약이면 false).
  restrict?: { on: boolean; allStores: boolean; active: boolean };
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const [tab, setTab] = useState<"FRUIT" | "VEG">("FRUIT");
  const [newName, setNewName] = useState("");

  const anyFixed = config.fixedFruit || config.fixedVeg;
  // 제한 모드가 전 지점에 '지금' 적용 중이면 고정과 똑같이 칸 강제·채팅 잠금(effectiveChannels 와 같은 규칙).
  // 시험 지점만이거나 시작 전이면 잠그지 않고 안내 한 줄만.
  const planLock = restrict.on && restrict.allStores && restrict.active;
  const planWhen = restrict.active ? "" : "시작되면 ";
  const planWho = restrict.allStores ? "" : "시험 지점은 ";
  const locked = anyFixed || planLock;
  const lockWhy = planLock ? "품목 제한 모드" : "품목 고정";
  const items = tab === "FRUIT" ? fruitItems : vegItems;
  const catLabel = tab === "FRUIT" ? "과일" : "야채";
  const shownCount = items.filter((i) => i.active).length;
  const hiddenCount = items.length - shownCount;

  function run(fn: () => Promise<{ ok?: boolean; error?: string }>) {
    setErr("");
    start(async () => {
      const res = await fn().catch(() => ({ error: "처리 중 문제가 생겼어요." }));
      if (res?.error) setErr(res.error);
      else router.refresh();
    });
  }

  function toggleFlag(key: keyof Cfg, on: boolean) {
    const fd = new FormData();
    fd.set("key", key);
    fd.set("on", on ? "true" : "false");
    run(() => setOrderModeFlagAction(fd));
  }

  function addItem() {
    const name = newName.trim();
    if (!name) return;
    const fd = new FormData();
    fd.set("category", tab);
    fd.set("name", name);
    setNewName("");
    run(() => addFixedItemAction(fd));
  }

  return (
    <div className="ocfg">
      {err && (
        <div className="notice notice--error" style={{ marginBottom: 14 }}>
          {err}
        </div>
      )}

      {/* 발주 방식 */}
      <div className="card ocfg-card">
        <div className="ocfg-card__title">발주 방식</div>

        <div className="ocfg-row">
          <div className="ocfg-row__main">
            <div className="ocfg-row__lab">칸 발주</div>
            {locked && (
              <div className="ocfg-row__sub">{lockWhy} 중 — 항상 켜짐</div>
            )}
          </div>
          <Switch
            on={planLock ? true : !config.gridOff}
            disabled={pending || locked}
            onToggle={() => toggleFlag("gridOff", config.gridOff ? false : true)}
            label="칸 발주"
          />
        </div>

        <div className="ocfg-row">
          <div className="ocfg-row__main">
            <div className="ocfg-row__lab">채팅 발주</div>
            {locked && (
              <div className="ocfg-row__sub ocfg-row__sub--warn">
                {lockWhy} 중 — 자동 잠금
              </div>
            )}
            {!locked && restrict.on && (
              <div className="ocfg-row__sub ocfg-row__sub--warn">
                품목 제한 모드 {planWhen}
                {planWho}자동 잠금
              </div>
            )}
          </div>
          {locked ? (
            <span className="ocfg-lock">자동 잠금</span>
          ) : (
            <Switch
              on={!config.chatOff}
              disabled={pending}
              onToggle={() => toggleFlag("chatOff", config.chatOff ? false : true)}
              label="채팅 발주"
            />
          )}
        </div>
      </div>

      {/* 품목 고정 */}
      <div className="card ocfg-card" style={planLock ? { opacity: 0.6 } : undefined}>
        <div className="ocfg-card__title">품목 고정</div>
        {restrict.on && (
          <div className="ocfg-row__sub ocfg-row__sub--warn" style={{ marginBottom: 4 }}>
            {planLock
              ? "편성 달력이 적용 중이에요 — 제한 모드 지점에는 이 설정이 쓰이지 않아요."
              : restrict.active
                ? "품목 제한 모드 시험 지점에는 이 설정이 쓰이지 않아요."
                : "품목 제한 모드 시작 전이라 지금은 이 설정이 그대로 쓰여요."}{" "}
            <Link href="/admin/order-plan" style={{ textDecoration: "underline" }}>
              편성 달력 열기
            </Link>
          </div>
        )}
        <div className="ocfg-row">
          <div className="ocfg-row__lab">과일 품목 고정</div>
          <Switch
            on={config.fixedFruit}
            disabled={pending || planLock}
            onToggle={() => toggleFlag("fixedFruit", !config.fixedFruit)}
            label="과일 품목 고정"
          />
        </div>
        <div className="ocfg-row">
          <div className="ocfg-row__lab">야채 품목 고정</div>
          <Switch
            on={config.fixedVeg}
            disabled={pending || planLock}
            onToggle={() => toggleFlag("fixedVeg", !config.fixedVeg)}
            label="야채 품목 고정"
          />
        </div>
        <div className="ocfg-hint">
          켠 칸만 지정 품목으로 고정됩니다. 하나라도 켜면 채팅 발주는 잠깁니다.
        </div>
      </div>

      {/* 고정 품목 관리 */}
      <div className="card ocfg-card">
        <div className="ocfg-card__title ocfg-card__title--row">
          <span>고정 품목</span>
          <span className="ocfg-count">
            노출 {shownCount} · 미노출 {hiddenCount}
          </span>
        </div>

        <div className="cattabs cattabs--seg" style={{ marginBottom: 10 }}>
          <button
            type="button"
            className={`cattab ${tab === "FRUIT" ? "is-active" : ""}`}
            onClick={() => setTab("FRUIT")}
          >
            과일
          </button>
          <button
            type="button"
            className={`cattab ${tab === "VEG" ? "is-active" : ""}`}
            onClick={() => setTab("VEG")}
          >
            야채
          </button>
        </div>

        {items.length === 0 ? (
          <div className="empty" style={{ padding: "18px 0" }}>
            등록된 {catLabel} 고정 품목이 없어요. 아래에서 추가해 주세요.
          </div>
        ) : (
          <div className="ocfg-items">
            {items.map((it, i) => (
              <FixedRow
                key={it.id}
                item={it}
                first={i === 0}
                last={i === items.length - 1}
                pending={pending}
                run={run}
              />
            ))}
          </div>
        )}

        <div className="ocfg-add">
          <input
            className="input"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={`${catLabel} 품목 추가`}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addItem();
              }
            }}
            disabled={pending}
          />
          <button
            type="button"
            className="btn btn--primary"
            onClick={addItem}
            disabled={pending || !newName.trim()}
          >
            추가
          </button>
        </div>
      </div>
    </div>
  );
}

function Switch({
  on,
  disabled,
  onToggle,
  label,
}: {
  on: boolean;
  disabled?: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={`switch ${on ? "is-on" : ""}`}
      onClick={onToggle}
      disabled={disabled}
    >
      <span className="switch__knob" />
    </button>
  );
}

function FixedRow({
  item,
  first,
  last,
  pending,
  run,
}: {
  item: FixedItem;
  first: boolean;
  last: boolean;
  pending: boolean;
  run: (fn: () => Promise<{ ok?: boolean; error?: string }>) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(item.name);
  const [confirmDel, setConfirmDel] = useState(false);

  function save() {
    const v = name.trim();
    if (!v) return;
    const fd = new FormData();
    fd.set("id", item.id);
    fd.set("name", v);
    setEditing(false);
    run(() => updateFixedItemAction(fd));
  }
  function toggleActive() {
    const fd = new FormData();
    fd.set("id", item.id);
    fd.set("active", item.active ? "false" : "true");
    run(() => toggleFixedItemAction(fd));
  }
  function move(dir: "up" | "down") {
    const fd = new FormData();
    fd.set("id", item.id);
    fd.set("dir", dir);
    run(() => moveFixedItemAction(fd));
  }
  function del() {
    const fd = new FormData();
    fd.set("id", item.id);
    setConfirmDel(false);
    run(() => deleteFixedItemAction(fd));
  }

  if (editing) {
    return (
      <div className="ocfg-item ocfg-item--edit">
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              save();
            }
          }}
        />
        <div className="ocfg-item__editbtns">
          <button type="button" className="tbtn" onClick={save} disabled={pending}>
            저장
          </button>
          <button
            type="button"
            className="tbtn tbtn--mute"
            onClick={() => {
              setName(item.name);
              setEditing(false);
            }}
          >
            취소
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`ocfg-item ${item.active ? "" : "is-hidden"}`}>
      <div className="ocfg-item__top">
        <span className={`ocfg-item__name ${item.active ? "" : "is-off"}`}>
          {item.name}
        </span>
        <button
          type="button"
          className={`ocfg-pill ${item.active ? "ocfg-pill--on" : "ocfg-pill--off"}`}
          onClick={toggleActive}
          disabled={pending}
        >
          {item.active ? "노출" : "미노출"}
        </button>
      </div>
      <div className="ocfg-item__acts">
        <button type="button" className="tbtn" onClick={() => setEditing(true)} disabled={pending}>
          수정
        </button>
        {confirmDel ? (
          <>
            <button type="button" className="tbtn tbtn--del" onClick={del} disabled={pending}>
              삭제 확인
            </button>
            <button type="button" className="tbtn tbtn--mute" onClick={() => setConfirmDel(false)}>
              취소
            </button>
          </>
        ) : (
          <button type="button" className="tbtn tbtn--del" onClick={() => setConfirmDel(true)} disabled={pending}>
            삭제
          </button>
        )}
        <span className="ocfg-item__sp" />
        <button
          type="button"
          className="tbtn tbtn--ord"
          onClick={() => move("up")}
          disabled={pending || first}
        >
          위로
        </button>
        <button
          type="button"
          className="tbtn tbtn--ord"
          onClick={() => move("down")}
          disabled={pending || last}
        >
          아래로
        </button>
      </div>
    </div>
  );
}
