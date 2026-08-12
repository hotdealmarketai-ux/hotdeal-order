"use client";

import { useState } from "react";
import { TaskFormSheet } from "@/components/messenger/TaskFormSheet";

type Member = { id: string; name: string; active: boolean };

// 할 일 추가 버튼 + 팝업(홈 ＋ 버튼, 채널 헤더 버튼에서 공용). channelId 가 있으면 그 채널에 안내 메시지도 게시.
export function AddTaskButton({
  members,
  className,
  label,
  channelId,
  onAdded,
}: {
  members: Member[];
  className?: string;
  label?: React.ReactNode;
  channelId?: string;
  onAdded?: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)} aria-label="할 일 추가">
        {label}
      </button>
      {open && <TaskFormSheet members={members} channelId={channelId} onClose={() => setOpen(false)} onDone={onAdded} />}
    </>
  );
}
