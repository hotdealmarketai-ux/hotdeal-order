"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { canViewInventory, type Role } from "@/lib/constants";

export function BottomNav({ role }: { role: Role }) {
  const path = usePathname();
  const items = [
    { href: "/order", label: "발주", ic: "📝" },
    ...(canViewInventory(role)
      ? [{ href: "/inventory", label: "재고현황", ic: "📦" }]
      : []),
    { href: "/mypage", label: "마이", ic: "👤" },
  ];

  return (
    <nav className="bottomnav">
      {items.map((it) => {
        const active = path === it.href || path.startsWith(it.href + "/");
        return (
          <Link
            key={it.href}
            href={it.href}
            className={`bottomnav__item ${active ? "is-active" : ""}`}
          >
            <span className="ic" aria-hidden>
              {it.ic}
            </span>
            <span>{it.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
