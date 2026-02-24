import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const superadmin = await prisma.user.upsert({
    where: { email: 'admin@ai-clinic.com' },
    update: {},
    create: {
      email: 'admin@ai-clinic.com',
      firstname: 'Super',
      lastname: 'Admin',
      password: await bcrypt.hash('SuperAdmin123!', 12),
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
