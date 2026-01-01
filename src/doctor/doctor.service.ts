import {
  ConflictException,
  Injectable,
  MethodNotAllowedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, User, UserRolesEnum } from '@prisma/client';
import { toCapitalCase } from 'src/common/tools';

@Injectable()
export class DoctorService {
  constructor(private readonly prisma: PrismaService) {}

  async hasProfile(userId: string, fromAnyKind: boolean = false) {
    return (
      (await this.prisma.doctorProfile.findFirst({ where: { userId } })) ||
      (fromAnyKind &&
        (await this.prisma.patientProfile.findFirst({ where: { userId } })))
    );
  }
  async createDoctorProfile(
    user: User,
    data: Prisma.DoctorProfileCreateWithoutUserInput,
  ) {
    if (user.role !== UserRolesEnum.DOCTOR) {
      throw new MethodNotAllowedException(
        `${toCapitalCase(user.role || 'Unknown')} user is not allowed to create a doctor profile.`,
      );
    }
    if (await this.hasProfile(user.id, false)) {
      throw new ConflictException(`Doctor already has a profile.`);
    }
    return this.prisma.doctorProfile.create({
      data: { ...data, userId: user.id },
    });
  }
}
