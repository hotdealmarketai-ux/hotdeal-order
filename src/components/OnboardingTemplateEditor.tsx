"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  adminSaveStepAction,
  adminDeleteStepAction,
} from "@/app/actions/onboarding";

type Step = {
  id: string;
  order: number;
  title: string;
  body: string;
  actor: string;
  required: boolean;
};

const ACTORS = [
  { key: "BOTH", label: "점주·본사" },
  { key: "MERCHANT", label: "점주" },
  { key: "ADMIN", label: "본사" },
];

function StepCard({ step }: { step: Step | null }) {
  const router = useRouter();
  const [title, setTitle] = useState(step?.title ?? "");
  const [body, setBody] = useState(step?.body ?? "");
  const [actor, setActor] = useState(step?.actor ?? "BOTH");
  const [required, setRequired] = useState(step?.required ?? true);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");

  const save = () =>
    start(async () => {
      const res = await adminSaveStepAction({
        id: step?.id,
        title,
        body,
        actor,
        required,
      });
      if (res.error) {
        setMsg(res.error);
        return;
      }
      setMsg("저장됨");
      if (!step) {
        setTitle("");
        setBody("");
      }
      router.refresh();
    });

  const remove = () =>
    start(async () => {
      if (!step) return;
      if (!confirm(`'${step.title}' 단계를 삭제(숨김)할까요?`)) return;
      const res = await adminDeleteStepAction({ id: step.id });
      if (res.error) {
        setMsg(res.error);
        return;
      }
      router.refresh();
    });

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="spread" style={{ marginBottom: 8, alignItems: "center" }}>
        <b>{step ? `${step.order}. 단계` : "새 단계 추가"}</b>
        {step && (
          <button
            type="button"
            className="btn btn--xs btn--ghost"
            onClick={remove}
            disabled={pending}
          >
            삭제
          </button>
        )}
      </div>
      <input
        className="input"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="제목"
        style={{ marginBottom: 8 }}
      />
      <textarea
        className="input"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="상세 내용"
        rows={4}
        style={{ marginBottom: 8, resize: "vertical" }}
      />
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
        <div className="cattabs cattabs--seg" style={{ flex: "1 1 auto" }}>
          {ACTORS.map((a) => (
            <button
              type="button"
              key={a.key}
              className={`cattab ${actor === a.key ? "is-active" : ""}`}
              onClick={() => setActor(a.key)}
            >
              {a.label}
            </button>
          ))}
        </div>
        <label style={{ display: "flex", gap: 4, alignItems: "center", fontSize: 13 }}>
          <input
            type="checkbox"
            checked={required}
            onChange={(e) => setRequired(e.target.checked)}
          />
          필수
        </label>
      </div>
      <div className="spread" style={{ alignItems: "center" }}>
        <span className="hint">{msg}</span>
        <button
          type="button"
          className="btn btn--sm btn--primary"
          onClick={save}
          disabled={pending || !title.trim()}
        >
          {pending ? "저장 중…" : step ? "저장" : "추가"}
        </button>
      </div>
    </div>
  );
}

export function OnboardingTemplateEditor({ steps }: { steps: Step[] }) {
  return (
    <div>
      {steps.map((s) => (
        <StepCard key={s.id} step={s} />
      ))}
      <StepCard step={null} />
      <p className="hint" style={{ marginTop: 8 }}>
        이미지 첨부는 다음 단계에서 추가됩니다. 내용을 고치면 진행 중인 모든 점포에 즉시 반영돼요.
      </p>
    </div>
  );
}
