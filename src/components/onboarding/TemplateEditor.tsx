"use client";

import { useState, useRef, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  addNodeAction,
  updateNodeAction,
  deleteNodeAction,
  moveNodeAction,
  uploadNodeImageAction,
  removeNodeImageAction,
} from "@/app/actions/onboarding";

type Crumb = { id: string; title: string };
type Child = { id: string; title: string; order: number; isLeaf: boolean };
type NodeData = { id: string; title: string; description: string; images: string[] };

const BASE = "/admin/onboarding/template";
const CHILD_LABEL = ["대분류", "중분류", "소분류"]; // level 0→대, 1→중, 2→소 자식

export function TemplateEditor({
  node,
  breadcrumb,
  level,
  childrenNodes,
}: {
  node: NodeData | null; // null=루트
  breadcrumb: Crumb[];
  level: number; // 0=루트, 1=대, 2=중, 3=소
  childrenNodes: Child[];
}) {
  const childLabel = CHILD_LABEL[level] ?? "분류";
  const canAddChild = level < 3;

  return (
    <div>
      {/* 경로 */}
      <div className="onbcrumb">
        <Link href={BASE} className="onbcrumb__link">
          튜토리얼
        </Link>
        {breadcrumb.map((c, i) => (
          <span key={c.id} className="onbcrumb__seg">
            <span className="onbcrumb__sep">›</span>
            {i === breadcrumb.length - 1 ? (
              <span className="onbcrumb__cur">{c.title || "(제목 없음)"}</span>
            ) : (
              <Link href={`${BASE}?node=${c.id}`} className="onbcrumb__link">
                {c.title || "(제목 없음)"}
              </Link>
            )}
          </span>
        ))}
      </div>

      {node ? (
        <>
          {/* 이 분류 = 체크박스. 제목 + 설명 + 이미지 */}
          <NodeFields node={node} />
          {childrenNodes.length === 0 && (
            <p className="hint" style={{ marginTop: 6 }}>
              하위 분류가 없으면 이 분류 자체가 체크 항목이 돼요.
            </p>
          )}
        </>
      ) : (
        <h1 className="h1" style={{ marginBottom: 4 }}>
          튜토리얼 구성
        </h1>
      )}

      {/* 하위 분류 */}
      <section style={{ marginTop: 20 }}>
        <div className="section-label">{childLabel}</div>
        <div className="list" style={{ marginBottom: 10 }}>
          {childrenNodes.map((c, i) => (
            <ChildRow key={c.id} child={c} first={i === 0} last={i === childrenNodes.length - 1} />
          ))}
          {childrenNodes.length === 0 && <div className="empty">{childLabel}가 없어요.</div>}
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

// 현재 분류의 제목 + 설명 + 이미지(모두 인라인 저장).
function NodeFields({ node }: { node: NodeData }) {
  const [title, setTitle] = useState(node.title);
  const [desc, setDesc] = useState(node.description);
  const [, start] = useTransition();
  const [savedT, setSavedT] = useState(false);
  const [savedD, setSavedD] = useState(false);

  const saveTitle = () =>
    start(async () => {
      if (title === node.title) return;
      await updateNodeAction({ id: node.id, title });
      setSavedT(true);
      setTimeout(() => setSavedT(false), 1000);
    });
  const saveDesc = () =>
    start(async () => {
      if (desc === node.description) return;
      await updateNodeAction({ id: node.id, description: desc });
      setSavedD(true);
      setTimeout(() => setSavedD(false), 1000);
    });

  return (
    <div className="card" style={{ display: "grid", gap: 10 }}>
      <label className="onbfield">
        <span className="onbfield__k">분류 이름 {savedT && <em className="onbsaved">저장됨</em>}</span>
        <input
          className="input onbtitle"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={saveTitle}
          placeholder="예: 사업자 등록"
        />
      </label>
      <label className="onbfield">
        <span className="onbfield__k">설명 {savedD && <em className="onbsaved">저장됨</em>}</span>
        <textarea
          className="input"
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          onBlur={saveDesc}
          placeholder="이 분류에 대한 설명(선택)"
          rows={3}
          style={{ resize: "vertical" }}
        />
      </label>
      <NodeImages node={node} />
    </div>
  );
}

function NodeImages({ node }: { node: NodeData }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");

  const upload = (file: File) =>
    start(async () => {
      setErr("");
      const fd = new FormData();
      fd.set("nodeId", node.id);
      fd.set("file", file);
      const res = await uploadNodeImageAction(fd);
      if (res.error) {
        setErr(res.error);
        return;
      }
      router.refresh();
    });
  const remove = (url: string) =>
    start(async () => {
      await removeNodeImageAction({ id: node.id, url });
      router.refresh();
    });
  const onPaste = (e: React.ClipboardEvent) => {
    const item = Array.from(e.clipboardData.items).find((it) => it.type.startsWith("image/"));
    const file = item?.getAsFile();
    if (file) {
      e.preventDefault();
      upload(file);
    }
  };

  return (
    <div className="onbfield">
      <span className="onbfield__k">이미지 (선택)</span>
      {node.images.length > 0 && (
        <div className="onbnode__imgs" style={{ marginBottom: 8 }}>
          {node.images.map((src) => (
            <div key={src} className="onbimg onbimg--edit">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt="" />
              <button type="button" className="onbimg__del" onClick={() => remove(src)} aria-label="삭제">
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="onbdrop" tabIndex={0} onPaste={onPaste} onClick={() => fileRef.current?.click()}>
        {pending ? "업로드 중…" : "이미지 붙여넣기 또는 클릭해서 추가"}
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

// 하위 분류 한 줄 — 드릴/이름/순서/삭제.
function ChildRow({ child, first, last }: { child: Child; first: boolean; last: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(child.title);
  const [pending, start] = useTransition();

  const saveName = () =>
    start(async () => {
      await updateNodeAction({ id: child.id, title: val });
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
        <Link href={`${BASE}?node=${child.id}`} className="row__main" style={{ textDecoration: "none" }}>
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
