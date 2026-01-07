import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { redirect } from "next/navigation";
import Link from "next/link";

type Role = "READ" | "WRITE" | "ADMIN";

interface ExtendedUser {
  id?: string;
  role?: Role;
}

export default async function MyUploadsPage() {
  const session = await auth();
  const currentUser = session?.user as ExtendedUser | undefined;

  if (!currentUser?.id) {
    redirect("/login");
  }

  const documents = await prisma.document.findMany({
    where: { uploadedById: currentUser.id },
    include: {
      category: {
        select: { name: true, slug: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">My Uploads</h1>
        <Link
          href="/upload"
          className="px-4 py-2 bg-[var(--primary)] text-[var(--primary-foreground)] rounded-lg hover:opacity-90"
        >
          New Upload
        </Link>
      </div>

      {documents.length === 0 ? (
        <div className="text-center py-12 bg-[var(--card)] border border-[var(--border)] rounded-xl">
          <p className="text-[var(--muted-foreground)] mb-4">
            You haven't uploaded any documents yet.
          </p>
          <Link
            href="/upload"
            className="text-[var(--primary)] hover:underline"
          >
            Add your first document
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {documents.map((doc) => (
            <div
              key={doc.id}
              className="flex items-center justify-between p-4 bg-[var(--card)] border border-[var(--border)] rounded-lg hover:border-[var(--primary)] transition-colors"
            >
              <div className="flex-1 min-w-0">
                <Link
                  href={`/docs/${doc.id}`}
                  className="font-medium hover:text-[var(--primary)] transition-colors"
                >
                  {doc.title}
                </Link>
                <div className="flex items-center gap-3 mt-1 text-sm text-[var(--muted-foreground)]">
                  <span className="px-2 py-0.5 bg-[var(--secondary)] rounded text-xs">
                    {doc.type.replace("_", " ")}
                  </span>
                  <span>•</span>
                  <Link
                    href={`/browse/${doc.category.slug}`}
                    className="hover:text-[var(--foreground)]"
                  >
                    {doc.category.name}
                  </Link>
                  <span>•</span>
                  <span>
                    {new Intl.DateTimeFormat("en-US", {
                      dateStyle: "short",
                    }).format(doc.createdAt)}
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded text-xs ${
                      doc.status === "READY"
                        ? "bg-green-500/20 text-green-400"
                        : doc.status === "ERROR"
                          ? "bg-red-500/20 text-red-400"
                          : "bg-yellow-500/20 text-yellow-400"
                    }`}
                  >
                    {doc.status}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2 ml-4">
                <Link
                  href={`/docs/${doc.id}/edit`}
                  className="px-3 py-1.5 text-sm bg-[var(--secondary)] rounded hover:bg-[var(--muted)] transition-colors"
                >
                  Edit
                </Link>
                <Link
                  href={`/docs/${doc.id}`}
                  className="px-3 py-1.5 text-sm bg-[var(--primary)] text-[var(--primary-foreground)] rounded hover:opacity-90 transition-opacity"
                >
                  View
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
