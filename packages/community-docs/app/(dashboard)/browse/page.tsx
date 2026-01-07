import { prisma } from "@/lib/db";
import Link from "next/link";

export default async function BrowsePage() {
  const categories = await prisma.category.findMany({
    include: {
      _count: {
        select: { documents: true },
      },
    },
    orderBy: { name: "asc" },
  });

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">Browse by Category</h1>

      {categories.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-[var(--muted-foreground)] mb-4">
            No categories yet.
          </p>
          <p className="text-sm text-[var(--muted-foreground)]">
            Administrators can create categories from the admin panel.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {categories.map((category) => (
            <Link
              key={category.id}
              href={`/browse/${category.slug}`}
              className="p-6 bg-[var(--card)] border border-[var(--border)] rounded-lg hover:border-[var(--primary)] transition-colors group"
            >
              <div className="flex items-center gap-3 mb-2">
                {category.icon && (
                  <span className="text-2xl">{category.icon}</span>
                )}
                <h2 className="font-semibold group-hover:text-[var(--primary)] transition-colors">
                  {category.name}
                </h2>
              </div>
              {category.description && (
                <p className="text-sm text-[var(--muted-foreground)] mb-3">
                  {category.description}
                </p>
              )}
              <p className="text-xs text-[var(--muted-foreground)]">
                {category._count.documents} document
                {category._count.documents !== 1 ? "s" : ""}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
