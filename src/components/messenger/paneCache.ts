import type {
  TaskDTO,
  RecurringDTO,
  WeekItemDTO,
  OrgMemberDTO,
  EventDTO,
  CalTaskDTO,
} from "@/app/actions/messenger";

// 홈 '받은 멘션' 항목 형태(TasksPane 로컬 타입과 동일).
export type MentionCache = {
  id: string;
  channelId: string;
  channelName: string;
  messageId: string;
  by: string;
  preview: string;
  at: string;
};

// 화면 전환 시 '직전에 불러온 데이터'를 즉시 보여주기 위한 세션 내 모듈 캐시(SWR 패턴).
// 각 pane이 mount 때 이 캐시로 즉시 렌더 → 백그라운드로 서버 재조회해 최신화.
// 새로고침(전체 페이지 로드) 시 초기화되며, 폴링/낙관적 로직과는 무관(표시 초기값만 담당).
export const paneCache: {
  homeTasks?: TaskDTO[];
  homeMentions?: MentionCache[];
  homeWeek?: WeekItemDTO[];
  myTasks?: TaskDTO[];
  myRecurring?: RecurringDTO[];
  org?: OrgMemberDTO[];
  cal: Record<string, { events: EventDTO[]; tasks: CalTaskDTO[] }>;
} = { cal: {} };
