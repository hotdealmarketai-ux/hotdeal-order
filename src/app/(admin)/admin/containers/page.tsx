import { Topbar } from "@/components/Topbar";
import { requireAdmin } from "@/lib/session";
import { kstToday } from "@/lib/date";
import { listContainers, computeContainerBoard } from "@/app/actions/container";
import { ContainerBoard } from "@/components/ContainerBoard";

export const dynamic = "force-dynamic";

// 용기 회수 관리 — 계산서 공구란에 0원으로 적어 둔 반납 용기(아이스박스·우유 콘티 등)를
// 지점별로 집계해 나간/회수/미회수를 보고, 회수를 기록한다. 재고·미수·매출과 무관.
export default async function ContainersPage(props: {
  searchParams: Promise<{ c?: string }>;
}) {
  await requireAdmin();
  const { c } = await props.searchParams;
  const all = await listContainers(true);
  const active = all.filter((x) => x.active);
  const selectedId =
    (c && active.some((x) => x.id === c) ? c : active[0]?.id) ?? "";
  const board = selectedId ? await computeContainerBoard(selectedId) : null;

  return (
    <>
      <Topbar backHref="/admin" title="비품 출고" />
      <div className="page">
        <ContainerBoard
          allContainers={all}
          selectedId={selectedId}
          board={board}
          today={kstToday()}
        />
      </div>
    </>
  );
}
