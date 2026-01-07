import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding categories...");

  const categories = [
    {
      name: "Tutorials",
      slug: "tutorials",
      description: "Guides and tutorials to learn",
      icon: "📚",
    },
    {
      name: "Projects",
      slug: "projects",
      description: "Community projects",
      icon: "🚀",
    },
    {
      name: "Resources",
      slug: "resources",
      description: "Useful resources and references",
      icon: "📦",
    },
    {
      name: "Templates",
      slug: "templates",
      description: "Templates and boilerplates",
      icon: "📋",
    },
    {
      name: "Tools",
      slug: "tools",
      description: "Tools and utilities",
      icon: "🔧",
    },
  ];

  for (const cat of categories) {
    await prisma.category.upsert({
      where: { slug: cat.slug },
      update: {},
      create: cat,
    });
    console.log(`  ✓ ${cat.name}`);
  }

  console.log("Done!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
