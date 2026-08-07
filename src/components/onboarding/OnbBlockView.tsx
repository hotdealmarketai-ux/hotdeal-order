// 블록 읽기 뷰(그리드) — 점주/관리자 공용. 체크박스만 인터랙티브(OnbCheckbox).
import Image from "next/image";
import { OnbCheckbox } from "./OnbCheckbox";
import type { NodeBlock } from "@/lib/onboarding";

export function OnbBlockView({
  blocks,
  checked,
  userId,
}: {
  blocks: NodeBlock[];
  checked: Set<string>;
  userId?: string; // 있으면 관리자 대리 체크
}) {
  if (blocks.length === 0) return null;
  return (
    <div className="onbgrid onbgrid--view">
      {blocks.map((b) => {
        const span = Math.min(12, Math.max(1, b.colSpan || 12));
        const style = { gridColumn: `span ${span}` };
        if (b.type === "HEADING") {
          if (!b.text.trim()) return null;
          return (
            <h3 key={b.id} className="onbv onbv--h" style={style}>
              {b.text}
            </h3>
          );
        }
        if (b.type === "TEXT") {
          if (!b.text.trim()) return null;
          return (
            <p key={b.id} className="onbv onbv--t" style={style}>
              {b.text}
            </p>
          );
        }
        if (b.type === "IMAGE") {
          if (!b.imageUrl) return null;
          return (
            <div key={b.id} className="onbv onbv--img" style={style}>
              <Image src={b.imageUrl} alt="" width={1200} height={800} unoptimized />
            </div>
          );
        }
        if (b.type === "CHECK") {
          return (
            <div key={b.id} className="onbv onbv--check" style={style}>
              <OnbCheckbox
                blockId={b.id}
                label={b.text}
                checked={checked.has(b.id)}
                userId={userId}
              />
            </div>
          );
        }
        return null;
      })}
    </div>
  );
}
