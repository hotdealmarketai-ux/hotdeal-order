import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

// 운영에서 개발용 플레이스홀더 시크릿 사용 시 경고(세션 위변조 위험) — 빌드는 막지 않음
if (process.env.NODE_ENV === "production") {
  const secret = process.env.AUTH_SECRET ?? "";
  if (!secret || secret.includes("change-me") || secret.includes("dev-only")) {
    console.error(
      "[auth] ⚠️ AUTH_SECRET이 안전하지 않습니다. 운영에서는 `openssl rand -base64 32` 값으로 교체하세요.",
    );
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  // 자동 로그인(remember) 시 최대치(~400일, 브라우저 쿠키 상한)까지 유지 → 로그아웃 전엔 안 끊김.
  // 미체크 시 jwt 콜백에서 12시간으로 단축.
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 400 },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: {
        username: { label: "아이디" },
        password: { label: "비밀번호", type: "password" },
        remember: { label: "자동 로그인" },
      },
      authorize: async (creds) => {
        const username = String(creds?.username ?? "").trim();
        const password = String(creds?.password ?? "");
        if (!username || !password) return null;

        const user = await prisma.user.findUnique({ where: { username } });
        if (!user) return null;

        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) return null;

        // 토큰에는 안정적인 uid만 싣고, 역할/상태는 매 요청 DB에서 최신값을 읽는다
        // (관리자 승인/역할 변경이 즉시 반영되도록)
        return {
          id: user.id,
          name: user.storeName,
          remember: String(creds?.remember ?? "") === "true",
        };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.uid = (user as { id: string }).id;
        // 기본은 자동 로그인 유지(true). 명시적으로 false일 때만 단기 세션.
        (token as { remember?: boolean }).remember =
          (user as { remember?: boolean }).remember !== false;
      }
      if ((token as { remember?: boolean }).remember === false) {
        // 자동 로그인 미체크 → 12시간 후 만료
        (token as { exp?: number }).exp = Math.floor(Date.now() / 1000) + 60 * 60 * 12;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user && token.uid) {
        session.user.id = token.uid as string;
      }
      return session;
    },
  },
});
