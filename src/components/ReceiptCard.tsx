"use client";

import { useState } from "react";

export type ReceiptItem = { name: string; qty: string; note: string };
export type ReceiptRawItem = { rawName: string; rawQty: string; rawNote: string };

export function ReceiptCard(props: {
  storeName: string;
  phone?: string;
  categoryLabel: string;
  vendorLabel: string;
  dateText: string;
  pickupTime?: string | null;
  aiSummary?: string;
  aiEngine?: string;
  items: ReceiptItem[];
  rawItems: ReceiptRawItem[];
  rawText?: string;
  isNew?: boolean;
  showStore?: boolean;
  showOriginalButton?: boolean;
  showPrintButton?: boolean;
}) {
  const [orig, setOrig] = useState(false);
  const showStore = props.showStore ?? true;
  const showOriginalButton = props.showOriginalButton ?? true;
  const showPrintButton = props.showPrintButton ?? true;
  const aiOn = props.aiEngine === "claude";

  return (
    <div>
      {props.isNew && (
        <div className="notice notice--ai" style={{ marginBottom: 14 }}>
          ✓ 발주가 접수되었어요. {aiOn ? "AI가" : "자동으로"} 정리한 발주서예요.
        </div>
      )}

      <div className="receipt" id="receipt-print">
        <div className="receipt__head">
          <div className="spread">
            <div>
              {showStore && (
                <div className="receipt__store">{props.storeName}</div>
              )}
            </div>
            {showOriginalButton && (
              <button
                type="button"
                className="btn btn--xs btn--soft"
                onClick={() => setOrig((o) => !o)}
              >
                {orig ? "정리본" : "원본 보기"}
              </button>
            )}
          </div>
          <div
            className="receipt__meta"
            style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap" }}
          >
            <span className="badge badge--mute">{props.dateText}</span>
            {aiOn && <span className="badge badge--ai">AI 정리</span>}
            {props.pickupTime && (
              <span className="badge badge--wait">픽업 {props.pickupTime}</span>
            )}
          </div>
        </div>

        {!orig ? (
          <>
            <div className="receipt__section">
              {props.items.map((it, i) => (
                <div className="receipt-item" key={i}>
                  <div className="receipt-item__name">{it.name || "-"}</div>
                  <div className="receipt-item__qty">{it.qty}</div>
                  {it.note && <div className="receipt-item__note">※ {it.note}</div>}
                </div>
              ))}
            </div>
            {props.aiSummary && (
              <div className="receipt__section">
                <div className="kv">
                  <span className="kv__k">메모</span>
                  <span className="kv__v">{props.aiSummary}</span>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="receipt__section">
            <div className="section-label" style={{ margin: "0 0 8px" }}>
              점주가 입력한 원본
            </div>
            {props.rawItems.map((it, i) => (
              <div className="receipt-item" key={i}>
                <div className="receipt-item__name">{it.rawName || "-"}</div>
                <div className="receipt-item__qty">{it.rawQty}</div>
                {it.rawNote && (
                  <div className="receipt-item__note">※ {it.rawNote}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {showPrintButton && (
        <div style={{ marginTop: 14 }}>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => window.print()}
          >
            영수증 인쇄
          </button>
        </div>
      )}
    </div>
  );
}
