// 점주 중첩 체크리스트(서버) — 분류 트리를 롤업 상태로 렌더. 최하위만 인터랙티브(OnbCheck).
import Image from "next/image";
import { OnbCheck } from "./OnbCheck";
import type { TreeNode, NodeState } from "@/lib/onboarding";

export function OnbTreeView({
  nodes,
  state,
  depth = 0,
}: {
  nodes: TreeNode[];
  state: Map<string, NodeState>;
  depth?: number;
}) {
  return (
    <>
      {nodes.map((n) => {
        const st = state.get(n.id) ?? { complete: false, pending: false };
        return (
          <div key={n.id} className={`onbnode onbnode--d${Math.min(depth, 2)}`}>
            {n.isLeaf ? (
              <OnbCheck
                nodeId={n.id}
                title={n.title}
                state={st.complete ? "approved" : st.pending ? "pending" : "none"}
              />
            ) : (
              <div className="onbrow onbrow--branch">
                <span
                  className={`onbx ${st.complete ? "onbx--done" : st.pending ? "onbx--partial" : "onbx--none"}`}
                  aria-hidden
                >
                  {st.complete ? "✓" : ""}
                </span>
                <span className="onbrow__title">{n.title || "(제목 없음)"}</span>
              </div>
            )}

            {n.description.trim() && <p className="onbnode__desc">{n.description}</p>}
            {n.images.length > 0 && (
              <div className="onbnode__imgs">
                {n.images.map((src, i) => (
                  <Image key={i} src={src} alt="" width={1000} height={700} unoptimized />
                ))}
              </div>
            )}

            {n.children.length > 0 && (
              <div className="onbnode__kids">
                <OnbTreeView nodes={n.children} state={state} depth={depth + 1} />
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
