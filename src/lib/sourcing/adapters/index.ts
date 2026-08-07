// 어댑터 레지스트리 — enabled()가 true(키 있음)인 것만 엔진이 실행.
import type { LeadAdapter, ProductAdapter } from "../types";
import { naverLocalAdapter } from "./naver-local";
import { firecrawlLeadAdapter, firecrawlProductAdapter } from "./firecrawl";

export const leadAdapters: LeadAdapter[] = [naverLocalAdapter, firecrawlLeadAdapter];
export const productAdapters: ProductAdapter[] = [firecrawlProductAdapter];
