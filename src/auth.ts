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
  // 30일 자동로그인 — 한번 가입/로그인하면 계속 유지
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 30 },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: {
        username: { label: "아이디" },
        password: { label: "비밀번호", type: "password" },
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
        return { id: user.id, name: user.storeName };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) token.uid = (user as { id: string }).id;
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
