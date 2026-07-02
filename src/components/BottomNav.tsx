"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { canViewInventory, type Role } from "@/lib/constants";

export function BottomNav({
  role,
  myBadge = 0,
}: {
  role: Role;
  myBadge?: number;
}) {
  const path = usePathname();
  const items = [
    { href: "/order", label: "발주", badge: 0 },
    ...(canViewInventory(role)
      ? [{ href: "/inventory", label: "재고현황", badge: 0 }]
      : []),
    { href: "/mypage", label: "마이", badge: myBadge },
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
            <span>{it.label}</span>
            {it.badge > 0 && (
              <span className="bottomnav__badge">
                {it.badge > 99 ? "99+" : it.badge}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
