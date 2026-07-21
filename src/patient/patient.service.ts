import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { User } from '@prisma/client';
import { CreatePatientProfileDto } from './dto/create-patient-profile.dto';
import { UpdatePatientProfileDto } from './dto/update-patient-profile.dto';

@Injectable()
export class PatientService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Check if a user already has a patient profile.
   */
  async hasProfile(userId: string) {
    return this.prisma.patientProfile.findUnique({ where: { userId } });
  }

  /**
   * Create a new patient profile for the given user.
   * Only PATIENT-role users should call this (enforced at controller level).
   */
  async createProfile(user: User, data: CreatePatientProfileDto) {
    if (await this.hasProfile(user.id)) {
      throw new ConflictException('Patient already has a profile.');
    }

    try {
      return await this.prisma.patientProfile.create({
        data: {
          userId: user.id,
          location: data.location,
          bio: data.bio,
          medicalHistory: data.medicalHistory ?? [],
          allergies: data.allergies ?? [],
          medications: data.medications ?? [],
          surgeries: data.surgeries ?? [],
          familyHistory: data.familyHistory ?? [],
        },
      });
    } catch (error: any) {
      if (error.code === 'P2002') {
        throw new ConflictException('Patient already has a profile.');
      }
      throw error;
    }
  }

  /**
   * Update the patient profile for the given user.
   */
  async updateProfile(user: User, data: UpdatePatientProfileDto) {
    const profile = await this.hasProfile(user.id);
    if (!profile) {
      throw new NotFoundException('Patient profile not found.');
    }

    return this.prisma.patientProfile.update({
      where: { userId: user.id },
      data: {
        ...data,
      },
    });
  }

  /**
   * Get the patient profile for the given user.
   */
  async getProfile(userId: string) {
    const profile = await this.prisma.patientProfile.findUnique({
      where: { userId },
    });
    if (!profile) {
      throw new NotFoundException('Patient profile not found.');
    }
    return profile;
  }
}
