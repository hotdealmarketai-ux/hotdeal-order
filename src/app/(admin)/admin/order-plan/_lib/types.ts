// 품목 제한 모드 — 관리자 편성 화면·서버 액션이 같이 쓰는 모양(타입만, 서버/클라이언트 공용).

export type ItemCat = "FRUIT" | "VEG" | "TOOL";
export type AnyCat = ItemCat | "TOFU";

// 관리자가 지금 편성하는 종류 — 공구는 2026-10-17~ 공산품으로만 받아 뺐다(점주 쪽 PLAN_CATS 와 같은 기준).
// 편집 탭·달력 칩·빨간 테두리·다음 7개 발주창·관리자 홈 배지·켜기 점검·저장·복사가 이 목록을 따른다.
// 타입(ItemCat·AnyCat)은 TOOL 을 그대로 둔다 — 이미 만든 공구 편성 데이터를 알아보는 용도(지우지 않고 읽지 않음).
export const ITEM_CATS: ItemCat[] = ["FRUIT", "VEG"];
export const ALL_CATS: AnyCat[] = ["FRUIT", "VEG", "TOFU"];

export const CAT_LABEL: Record<AnyCat, string> = {
  FRUIT: "과일",
  VEG: "야채",
  TOOL: "공구",
  TOFU: "채움채",
};
export const CAT_SHORT: Record<AnyCat, string> = {
  FRUIT: "과",
  VEG: "야",
  TOOL: "공",
  TOFU: "채",
};

/** 편성 품목 초안(저장 단위). 배열 순서 = sortOrder. */
export type ItemDraft = {
  id?: string;
  name: string;
  description: string;
  stockQty: number | null;
  maxPerStore: number | null;
  minPerStore: number | null; // 공구만
  inventoryItemId: string; // 공구만(""=수기)
  supplyPrice: number; // 수기 공구만 의미 있음
  tax: string; // 수기 공구만 의미 있음
  hidden: boolean;
};

/** 불러오기·복사 결과 초안 — '연동 끊김' 표시용 꼬리표 포함. */
export type LoadedDraft = ItemDraft & { brokenLink?: boolean };

export type SaveDayPlanInput = {
  date: string;
  cats: {
    FRUIT?: ItemDraft[];
    VEG?: ItemDraft[];
    TOOL?: ItemDraft[];
    TOFU?: { hiddenSeqs: string[] };
  };
  /** 그 종류 OrderPlan.updatedAt ISO(없으면 null) — 화면을 그린 시점 값 */
  base: Partial<Record<AnyCat, string | null>>;
};

export type SaveDayPlanResult =
  | {
      ok: true;
      notices: string[]; // 숨김 처리 등 알림
      warnings: string[]; // 한도 아래로 줄임 등 경고
      updatedAt: Partial<Record<AnyCat, string | null>>;
    }
  | { ok: false; error: string; cat?: AnyCat; index?: number };

export type LoadPrevResult =
  | {
      ok: true;
      sourceDate: string | null;
      items?: LoadedDraft[];
      hiddenSeqs?: string[];
      notes: string[];
    }
  | { ok: false; error: string };

export type CopyPlanInput = {
  fromDate: string;
  toDates: string[];
  cats: AnyCat[];
  mode: "skip" | "replace";
};

export type CopyPlanResult =
  | {
      ok: true;
      done: { date: string; cat: AnyCat }[];
      skipped: { date: string; cat: AnyCat; reason: string }[];
      notes: string[];
    }
  | { ok: false; error: string };

export type CatState = { state: "none" | "closed" | "some"; count: number };

export type PreflightWindow = {
  key: string;
  label: string;
  cats: Record<ItemCat, CatState>;
  tofu: { exists: boolean; visible: number; total: number };
};

export type PreflightResult =
  | {
      ok: true;
      nowKey: string;
      nextKey: string; // '다음 발주창부터' 적용 시작 창(upcomingWindowKey)
      windows: PreflightWindow[]; // nowKey, nextKey(같으면 하나)
      cartHolds: number;
      cartStores: number;
      windowOrders: number;
      merchants: { id: string; storeName: string }[];
      config: { on: boolean; from: string; pilot: string[] };
    }
  | { ok: false; error: string };

/** 재고 고르기 목록 한 줄(공구 연동). real = 기준재고 − 그 창 담기 − 예약 홀드. */
export type InvPick = {
  id: string;
  name: string;
  supplyPrice: number;
  tax: string;
  base: number;
  real: number;
  locked: boolean; // 공산품 발주 중 — 연동 금지
};

/** 편집 화면 품목별 현황(오늘·지난 창). */
export type ItemStat = {
  total: number;
  storeCount: number;
  remaining: number | null;
  byStore: { storeName: string; qty: number }[];
  real: number | null; // 연동 공구 실재고
};

/** 품목 제한 모드 카드 표시용 요약. active = 지금 창에 이미 적용 중. */
export type ModeCardInfo = { on: boolean; from: string; fromLabel: string; pilotCount: number; active: boolean };
