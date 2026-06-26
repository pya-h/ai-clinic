import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const email = process.env.SUPERUSER_EMAIL || 'admin@ai-clinic.com';
  const password = process.env.SUPERUSER_PASSWORD || 'SuperAdmin123!';

  const superadmin = await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      firstname: 'Super',
      lastname: 'Admin',
      password: await bcrypt.hash(password, 12),
      role: 'NONE',
      isAdmin: true,
      isSuperAdmin: true,
    },
  });
  console.log('Superadmin created:', superadmin.id);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
