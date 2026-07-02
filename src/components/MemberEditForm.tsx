"use client";

import { useActionState, useState } from "react";
import {
  updateMemberAction,
  resetMemberPasswordAction,
  setMemberStatusAction,
  deleteMemberAction,
  type MemberFormState,
} from "@/app/actions/admin";
import { SubmitButton } from "./SubmitButton";
import { ALL_ROLES, ROLE_LABEL, STATUS_LABEL, type Role, type Status } from "@/lib/constants";

const STATUSES: Status[] = ["APPROVED", "SUSPENDED", "PENDING", "REJECTED"];

export function MemberEditForm({
  userId,
  isSelf,
  initial,
}: {
  userId: string;
  isSelf: boolean;
  initial: {
    storeName: string;
    phone: string;
    address: string;
    role: string;
    status: string;
    payerNames: string[];
  };
}) {
  const [state, formAction] = useActionState<MemberFormState, FormData>(
    updateMemberAction,
    {},
  );
  const [pwState, pwAction] = useActionState<MemberFormState, FormData>(
    resetMemberPasswordAction,
    {},
  );
  const [confirmDelete, setConfirmDelete] = useState(false);

  const suspended = initial.status === "SUSPENDED";

  return (
    <>
      {/* 정지/복구 빠른 버튼 */}
      {!isSelf && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="spread" style={{ alignItems: "center" }}>
            <div>
              <div className="row__title">계정 상태</div>
              <div className="row__sub">
                현재 {STATUS_LABEL[initial.status as Status]}
              </div>
            </div>
            <form action={setMemberStatusAction}>
              <input type="hidden" name="userId" value={userId} />
              <input
                type="hidden"
                name="status"
                value={suspended ? "APPROVED" : "SUSPENDED"}
              />
              <button className={`btn btn--sm ${suspended ? "btn--primary" : "btn--danger"}`}>
                {suspended ? "정지 해제" : "계정 정지"}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* 개인정보 + 역할/상태 */}
      <form action={formAction} className="card">
        <input type="hidden" name="userId" value={userId} />
        <div className="section-label" style={{ margin: "0 0 10px" }}>
          회원 정보 수정
        </div>

        {state?.ok && (
          <div className="notice notice--ok" style={{ marginBottom: 12 }}>
            저장되었어요.
          </div>
        )}
        {state?.error && (
          <div className="notice notice--error" style={{ marginBottom: 12 }}>
            {state.error}
          </div>
        )}

        <div className="field">
          <label className="label" htmlFor="storeName">상호명</label>
          <input id="storeName" name="storeName" className="input" defaultValue={initial.storeName} />
        </div>
        <div className="field">
          <label className="label" htmlFor="phone">연락처</label>
          <input id="phone" name="phone" className="input" defaultValue={initial.phone} />
        </div>
        <div className="field">
          <label className="label" htmlFor="address">소재지</label>
          <input id="address" name="address" className="input" defaultValue={initial.address} />
        </div>
        <div className="field">
          <label className="label" htmlFor="payerNames">입금자명 (입금 자동매칭용)</label>
          <input
            id="payerNames"
            name="payerNames"
            className="input"
            defaultValue={initial.payerNames.join(", ")}
            placeholder="통장에 찍히는 이름, 여러 개면 콤마로 (예: 새롭상회, 홍길동)"
          />
          <p className="hint">이 점포가 입금할 때 통장에 찍히는 이름이에요. 정확할수록 자동 입금확인이 잘 돼요.</p>
        </div>

        <div className="field">
          <label className="label" htmlFor="role">역할</label>
          <select
            id="role"
            name="role"
            className="input"
            defaultValue={initial.role}
            disabled={isSelf}
          >
            {ALL_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r as Role]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="label" htmlFor="status">상태</label>
          <select
            id="status"
            name="status"
            className="input"
            defaultValue={initial.status}
            disabled={isSelf}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
        {isSelf && (
          <p className="hint">본인 계정은 역할·상태를 바꿀 수 없어요(잠금 방지).</p>
        )}

        <div style={{ marginTop: 8 }}>
          <SubmitButton pendingText="저장 중…">저장하기</SubmitButton>
        </div>
      </form>

      {/* 비밀번호 초기화 */}
      <form action={pwAction} className="card" style={{ marginTop: 16 }}>
        <input type="hidden" name="userId" value={userId} />
        <div className="section-label" style={{ margin: "0 0 10px" }}>
          비밀번호 초기화
        </div>
        {pwState?.ok && (
          <div className="notice notice--ok" style={{ marginBottom: 12 }}>
            비밀번호가 변경되었어요.
          </div>
        )}
        {pwState?.error && (
          <div className="notice notice--error" style={{ marginBottom: 12 }}>
            {pwState.error}
          </div>
        )}
        <div className="field">
          <label className="label" htmlFor="password">새 비밀번호</label>
          <input
            id="password"
            name="password"
            className="input"
            placeholder="새 비밀번호 (4자 이상)"
            autoComplete="new-password"
          />
        </div>
        <SubmitButton pendingText="변경 중…">비밀번호 변경</SubmitButton>
      </form>

      {/* 회원 삭제 */}
      {!isSelf && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="section-label" style={{ margin: "0 0 10px" }}>
            회원 삭제
          </div>
          <p className="hint" style={{ marginBottom: 12 }}>
            삭제하면 이 회원과 발주 이력이 모두 사라져요. 되돌릴 수 없어요.
          </p>
          {!confirmDelete ? (
            <button
              type="button"
              className="btn btn--danger"
              onClick={() => setConfirmDelete(true)}
            >
              회원 삭제
            </button>
          ) : (
            <form action={deleteMemberAction}>
              <input type="hidden" name="userId" value={userId} />
              <p style={{ fontWeight: 700, marginBottom: 10 }}>
                정말 삭제할까요?
              </p>
              <div className="confirm__actions">
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => setConfirmDelete(false)}
                >
                  취소
                </button>
                <button className="btn btn--danger">네, 삭제합니다</button>
              </div>
            </form>
          )}
        </div>
      )}
    </>
  );
}
