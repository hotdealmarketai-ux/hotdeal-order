"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function AdminNav() {
  const path = usePathname();
  const items = [
    { href: "/admin", label: "홈", match: "/admin" },
    { href: "/vendor", label: "공동구매 발주", match: "/vendor" },
  ];

  return (
    <nav className="bottomnav">
      {items.map((it) => {
        const active = path === it.match || path.startsWith(it.match + "/");
        return (
          <Link
            key={it.href}
            href={it.href}
            className={`bottomnav__item ${active ? "is-active" : ""}`}
          >
            <span>{it.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
