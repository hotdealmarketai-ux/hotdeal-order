"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function AdminNav() {
  const path = usePathname();
  const items = [
    { href: "/admin", label: "홈", match: "/admin" },
    { href: "/vendor", label: "공동구매 발주", match: "/vendor" },
    { href: "/admin/reservations", label: "예약발주", match: "/admin/reservations" },
  ];
  // 최장 접두 일치가 활성 — /admin/reservations 에서 홈(/admin)이 같이 켜지지 않게.
  const matched = items.filter((it) => path === it.match || path.startsWith(it.match + "/"));
  const activeMatch = matched.reduce(
    (a, b) => (b.match.length > (a?.match.length ?? -1) ? b : a),
    matched[0] as (typeof items)[number] | undefined,
  )?.match;

  return (
    <nav className="bottomnav">
      {items.map((it) => {
        const active = it.match === activeMatch;
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
