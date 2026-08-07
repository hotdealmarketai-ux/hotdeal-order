"use client";

import { useState, useRef, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  addNodeAction,
  renameNodeAction,
  deleteNodeAction,
  moveNodeAction,
  addBlockAction,
  updateBlockAction,
  uploadBlockImageAction,
  moveBlockAction,
  deleteBlockAction,
} from "@/app/actions/onboarding";

type Crumb = { id: string; title: string };
type Child = { id: string; title: string; order: number };
type Block = {
  id: string;
  order: number;
  type: string;
  text: string;
  imageUrl: string;
  colSpan: number;
};

const TEMPLATE_BASE = "/admin/onboarding/template";
const CHILD_LABEL = ["대분류", "중분류", "소분류"]; // level 0→대, 1→중, 2→소 자식

// 폭 선택(그리드 12칸): 전체/½/⅓/¼
const WIDTHS = [
  { span: 12, label: "전체" },
  { span: 6, label: "½" },
  { span: 4, label: "⅓" },
  { span: 3, label: "¼" },
];

export function TemplateEditor({
  node,
  breadcrumb,
  level,
  childrenNodes,
  blocks,
  totalChecks,
}: {
  node: { id: string; title: string } | null; // null=루트
  breadcrumb: Crumb[];
  level: number; // 0=루트, 1=대, 2=중, 3=소
  childrenNodes: Child[];
  blocks: Block[];
  totalChecks: number;
}) {
  const router = useRouter();
  const childLabel = CHILD_LABEL[level] ?? "분류";
  const canAddChild = level < 3;

  return (
    <div>
      {/* 경로 */}
      <div className="onbcrumb">
        <Link href={TEMPLATE_BASE} className="onbcrumb__link">
          튜토리얼
        </Link>
        {breadcrumb.map((c, i) => (
          <span key={c.id} className="onbcrumb__seg">
            <span className="onbcrumb__sep">›</span>
            {i === breadcrumb.length - 1 ? (
              <span className="onbcrumb__cur">{c.title || "(제목 없음)"}</span>
            ) : (
              <Link href={`${TEMPLATE_BASE}?node=${c.id}`} className="onbcrumb__link">
                {c.title || "(제목 없음)"}
              </Link>
            )}
          </span>
        ))}
      </div>

      {/* 현재 분류 제목(루트는 편집 대상 아님) */}
      {node ? (
        <NodeTitle id={node.id} title={node.title} />
      ) : (
        <h1 className="h1" style={{ marginBottom: 4 }}>
          튜토리얼 구성
        </h1>
      )}

      {/* 콘텐츠 블록 — 노드 안에서만 */}
      {node && (
        <section style={{ marginTop: 18 }}>
          <div className="section-label">내용</div>
          {blocks.length === 0 ? (
            <div className="empty" style={{ marginBottom: 10 }}>
              아직 내용이 없어요. 아래에서 추가하세요.
            </div>
          ) : (
            <div className="onbgrid">
              {blocks.map((b, i) => (
                <BlockCard
                  key={b.id}
                  block={b}
                  first={i === 0}
                  last={i === blocks.length - 1}
                />
              ))}
            </div>
          )}
          <AddBlock nodeId={node.id} onDone={() => router.refresh()} />
          <p className="hint" style={{ marginTop: 8 }}>
            체크박스 {totalChecks}개 · 이 수를 기준으로 지점 진행률이 계산돼요.
          </p>
        </section>
      )}

      {/* 하위 분류 */}
      <section style={{ marginTop: 22 }}>
        <div className="section-label">{childLabel}</div>
        <div className="list" style={{ marginBottom: 10 }}>
          {childrenNodes.map((c, i) => (
            <ChildRow
              key={c.id}
              child={c}
              first={i === 0}
              last={i === childrenNodes.length - 1}
            />
          ))}
          {childrenNodes.length === 0 && (
            <div className="empty">{childLabel}가 없어요.</div>
          )}
        </div>
        {canAddChild ? (
          <AddCategory parentId={node?.id ?? null} label={childLabel} />
        ) : (
          <p className="hint">소분류까지만 만들 수 있어요.</p>
        )}
      </section>
    </div>
  );
}

// ── 현재 노드 제목(인라인 저장) ──
function NodeTitle({ id, title }: { id: string; title: string }) {
  const [val, setVal] = useState(title);
  const [, start] = useTransition();
  const save = () =>
    start(async () => {
      if (val === title) return;
      await renameNodeAction({ id, title: val });
    });
  return (
    <input
      className="input onbtitle"
      value={val}
      onChange={(e) => setVal(e.target.value)}
      onBlur={save}
      placeholder="분류 제목"
    />
  );
}

// ── 하위 분류 한 줄 ──
function ChildRow({
  child,
  first,
  last,
}: {
  child: Child;
  first: boolean;
  last: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(child.title);
  const [pending, start] = useTransition();

  const saveName = () =>
    start(async () => {
      await renameNodeAction({ id: child.id, title: val });
      setEditing(false);
      router.refresh();
    });
  const move = (dir: "up" | "down") =>
    start(async () => {
      await moveNodeAction({ id: child.id, dir });
      router.refresh();
    });
  const remove = () =>
    start(async () => {
      if (!confirm(`'${child.title || "(제목 없음)"}'와 그 안의 모든 내용을 삭제할까요?`)) return;
      await deleteNodeAction({ id: child.id });
      router.refresh();
    });

  return (
    <div className="row" style={{ alignItems: "center", gap: 8 }}>
      {editing ? (
        <input
          className="input"
          value={val}
          autoFocus
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && saveName()}
          style={{ flex: 1 }}
        />
      ) : (
        <Link
          href={`${TEMPLATE_BASE}?node=${child.id}`}
          className="row__main"
          style={{ textDecoration: "none" }}
        >
          <div className="row__title">{child.title || "(제목 없음)"}</div>
        </Link>
      )}
      <div className="onbrow__tools">
        {editing ? (
          <button className="btn btn--xs btn--primary" onClick={saveName} disabled={pending}>
            저장
          </button>
        ) : (
          <>
            <button className="onbicon" onClick={() => move("up")} disabled={pending || first} aria-label="위로">
              ↑
            </button>
            <button className="onbicon" onClick={() => move("down")} disabled={pending || last} aria-label="아래로">
              ↓
            </button>
            <button className="onbicon" onClick={() => setEditing(true)} disabled={pending} aria-label="이름">
              ✎
            </button>
            <button className="onbicon onbicon--danger" onClick={remove} disabled={pending} aria-label="삭제">
              ✕
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── 분류 추가 ──
function AddCategory({ parentId, label }: { parentId: string | null; label: string }) {
  const router = useRouter();
  const [val, setVal] = useState("");
  const [pending, start] = useTransition();
  const add = () =>
    start(async () => {
      const title = val.trim();
      if (!title) return;
      await addNodeAction({ parentId, title });
      setVal("");
      router.refresh();
    });
  return (
    <div style={{ display: "flex", gap: 8 }}>
      <input
        className="input"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && add()}
        placeholder={`${label} 이름`}
        style={{ flex: 1 }}
      />
      <button className="btn btn--sm btn--primary" onClick={add} disabled={pending || !val.trim()}>
        {pending ? "추가 중…" : "추가"}
      </button>
    </div>
  );
}

// ── 블록 추가(타입 선택) ──
const BLOCK_MENU = [
  { type: "HEADING", label: "제목" },
  { type: "TEXT", label: "텍스트" },
  { type: "IMAGE", label: "이미지" },
  { type: "CHECK", label: "체크박스" },
];
function AddBlock({ nodeId, onDone }: { nodeId: string; onDone: () => void }) {
  const [pending, start] = useTransition();
  const add = (type: string) =>
    start(async () => {
      await addBlockAction({ nodeId, type });
      onDone();
    });
  return (
    <div className="onbadd">
      <span className="onbadd__label">추가</span>
      {BLOCK_MENU.map((m) => (
        <button
          key={m.type}
          className="btn btn--xs btn--soft"
          onClick={() => add(m.type)}
          disabled={pending}
        >
          + {m.label}
        </button>
      ))}
    </div>
  );
}

// ── 블록 카드(그리드 아이템) ──
function BlockCard({ block, first, last }: { block: Block; first: boolean; last: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const span = Math.min(12, Math.max(1, block.colSpan || 12));

  const setWidth = (colSpan: number) =>
    start(async () => {
      await updateBlockAction({ id: block.id, colSpan });
      router.refresh();
    });
  const move = (dir: "up" | "down") =>
    start(async () => {
      await moveBlockAction({ id: block.id, dir });
      router.refresh();
    });
  const remove = () =>
    start(async () => {
      if (!confirm("이 블록을 삭제할까요?")) return;
      await deleteBlockAction({ id: block.id });
      router.refresh();
    });

  return (
    <div className="onbblock" style={{ gridColumn: `span ${span}` }}>
      <div className="onbblock__body">
        {block.type === "IMAGE" ? (
          <ImageBlock block={block} />
        ) : (
          <TextBlock block={block} />
        )}
      </div>
      <div className="onbblock__bar">
        <div className="onbblock__widths">
          {WIDTHS.map((w) => (
            <button
              key={w.span}
              className={`onbchip ${span === w.span ? "is-on" : ""}`}
              onClick={() => setWidth(w.span)}
              disabled={pending}
            >
              {w.label}
            </button>
          ))}
        </div>
        <div className="onbrow__tools">
          <button className="onbicon" onClick={() => move("up")} disabled={pending || first} aria-label="위로">
            ↑
          </button>
          <button className="onbicon" onClick={() => move("down")} disabled={pending || last} aria-label="아래로">
            ↓
          </button>
          <button className="onbicon onbicon--danger" onClick={remove} disabled={pending} aria-label="삭제">
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}

// 제목/텍스트/체크박스 라벨 — 인라인 저장.
function TextBlock({ block }: { block: Block }) {
  const [val, setVal] = useState(block.text);
  const [saved, setSaved] = useState(false);
  const [, start] = useTransition();
  const save = () =>
    start(async () => {
      if (val === block.text) return;
      await updateBlockAction({ id: block.id, text: val });
      setSaved(true);
      setTimeout(() => setSaved(false), 1200);
    });

  const placeholder =
    block.type === "HEADING" ? "제목" : block.type === "CHECK" ? "체크 항목 내용" : "내용";

  return (
    <div>
      {block.type === "CHECK" && <span className="onbtypetag">체크박스</span>}
      {block.type === "HEADING" ? (
        <input
          className="input onbheadinput"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onBlur={save}
          placeholder={placeholder}
        />
      ) : block.type === "CHECK" ? (
        <div className="onbcheckedit">
          <span className="onbcheckedit__box" aria-hidden>
            ☐
          </span>
          <input
            className="input"
            value={val}
            onChange={(e) => setVal(e.target.value)}
            onBlur={save}
            placeholder={placeholder}
          />
        </div>
      ) : (
        <textarea
          className="input"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onBlur={save}
          placeholder={placeholder}
          rows={3}
          style={{ resize: "vertical", width: "100%" }}
        />
      )}
      {saved && <span className="onbsaved">저장됨</span>}
    </div>
  );
}

// 이미지 — 붙여넣기 / 파일 업로드.
function ImageBlock({ block }: { block: Block }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");

  const upload = (file: File) =>
    start(async () => {
      setErr("");
      const fd = new FormData();
      fd.set("blockId", block.id);
      fd.set("file", file);
      const res = await uploadBlockImageAction(fd);
      if (res.error) {
        setErr(res.error);
        return;
      }
      router.refresh();
    });

  const onPaste = (e: React.ClipboardEvent) => {
    const item = Array.from(e.clipboardData.items).find((it) => it.type.startsWith("image/"));
    if (item) {
      const file = item.getAsFile();
      if (file) {
        e.preventDefault();
        upload(file);
      }
    }
  };

  return (
    <div>
      {block.imageUrl ? (
        <div className="onbimg">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={block.imageUrl} alt="" />
        </div>
      ) : null}
      <div
        className="onbdrop"
        tabIndex={0}
        onPaste={onPaste}
        onClick={() => fileRef.current?.click()}
      >
        {pending
          ? "업로드 중…"
          : block.imageUrl
            ? "이미지 교체 — 클릭하거나 붙여넣기"
            : "이미지 붙여넣기 또는 클릭해서 업로드"}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) upload(f);
          e.target.value = "";
        }}
      />
      {err && <div className="notice notice--error" style={{ marginTop: 6 }}>{err}</div>}
    </div>
  );
}
