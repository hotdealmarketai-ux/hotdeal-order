"use client";

export function PrintButton({ label = "영수증 인쇄" }: { label?: string }) {
  return (
    <button
      type="button"
      className="btn btn--ghost"
      onClick={() => window.print()}
    >
      {label}
    </button>
  );
}
