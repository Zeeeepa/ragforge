import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { EditDocumentForm } from "@/components/preview/EditDocumentForm";

type Role = "READ" | "WRITE" | "ADMIN";

interface ExtendedUser {
  id?: string;
  role?: Role;
}

export default async function EditDocumentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  const currentUser = session?.user as ExtendedUser | undefined;

  if (!currentUser) {
    redirect("/login");
  }

  const document = await prisma.document.findUnique({
    where: { id },
    include: {
      category: true,
      uploadedBy: {
        select: { id: true },
      },
    },
  });

  if (!document) {
    notFound();
  }

  // Check permission
  const isOwner = currentUser.id === document.uploadedBy.id;
  const isAdmin = currentUser.role === "ADMIN";

  if (!isOwner && !isAdmin) {
    redirect(`/docs/${id}`);
  }

  // Fetch all categories for the select
  const categories = await prisma.category.findMany({
    select: { id: true, name: true, slug: true },
    orderBy: { name: "asc" },
  });

  return (
    <div className="max-w-2xl mx-auto p-6">
      <nav className="text-sm text-[var(--muted-foreground)] mb-6">
        <Link href={`/docs/${id}`} className="hover:text-[var(--foreground)]">
          ← Retour au document
        </Link>
      </nav>

      <h1 className="text-2xl font-bold mb-6">Modifier le document</h1>

      <EditDocumentForm
        document={{
          id: document.id,
          title: document.title,
          description: document.description || "",
          categoryId: document.categoryId,
        }}
        categories={categories}
      />
    </div>
  );
}
