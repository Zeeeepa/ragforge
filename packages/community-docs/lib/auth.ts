import NextAuth from "next-auth";
import Discord from "next-auth/providers/discord";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "./db";

type Role = "READ" | "WRITE" | "ADMIN";

export const { handlers, signIn, signOut, auth } = NextAuth({
  adapter: PrismaAdapter(prisma),
  providers: [
    Discord({
      clientId: process.env.AUTH_DISCORD_ID!,
      clientSecret: process.env.AUTH_DISCORD_SECRET!,
      allowDangerousEmailAccountLinking: true,
      authorization: {
        params: {
          scope: "identify email guilds",
        },
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      if (account?.provider === "discord" && profile) {
        const discordProfile = profile as { id: string; username: string; avatar?: string };

        // Upsert user with Discord data
        await prisma.user.upsert({
          where: { discordId: discordProfile.id },
          update: {
            username: discordProfile.username,
            avatar: discordProfile.avatar
              ? `https://cdn.discordapp.com/avatars/${discordProfile.id}/${discordProfile.avatar}.png`
              : null,
          },
          create: {
            id: user.id!,
            discordId: discordProfile.id,
            username: discordProfile.username,
            email: user.email,
            avatar: discordProfile.avatar
              ? `https://cdn.discordapp.com/avatars/${discordProfile.id}/${discordProfile.avatar}.png`
              : null,
          },
        });
      }
      return true;
    },
    async session({ session, user }) {
      // Fetch full user with role
      const dbUser = await prisma.user.findUnique({
        where: { id: user.id },
        select: { id: true, role: true, username: true, avatar: true },
      });

      if (dbUser) {
        // Extend session.user with custom properties
        const extendedUser = session.user as unknown as {
          id: string;
          role: Role;
          username: string;
          image?: string | null;
        };
        extendedUser.id = dbUser.id;
        extendedUser.role = dbUser.role as Role;
        extendedUser.username = dbUser.username;
        extendedUser.image = dbUser.avatar;
      }

      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
});
