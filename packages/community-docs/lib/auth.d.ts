import "next-auth";

// Role enum inline since Prisma client may not be generated yet
type Role = "READ" | "WRITE" | "ADMIN";

declare module "next-auth" {
  interface User {
    role?: Role;
    username?: string;
  }

  interface Session {
    user: {
      id: string;
      role: Role;
      username: string;
      email?: string | null;
      image?: string | null;
    };
  }
}

declare module "@auth/core/adapters" {
  interface AdapterUser {
    role?: Role;
    username?: string;
  }
}
