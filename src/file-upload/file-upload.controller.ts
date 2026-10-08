import {
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { FastifyReply } from 'fastify';
import { User } from '@prisma/client';
import { FileUploadService } from './file-upload.service';
import { PrismaService } from '../prisma/prisma.service';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';
import { CurrentUser } from '../user/decorators/current-user.decorator';

@ApiTags('Uploads')
@Controller('uploads')
export class FileUploadController {
  constructor(
    private readonly fileUploadService: FileUploadService,
    private readonly prisma: PrismaService,
  ) {}

  @ApiOperation({ description: 'Serve an uploaded avatar. Public endpoint.' })
  @Get('avatars/:fileName')
  async getAvatar(
    @Param('fileName') fileName: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { stream, mimeType } = await this.fileUploadService.openFile('avatars', fileName);

    // The client may run on another origin than the API and embeds these as <img>.
    reply.header('Cross-Origin-Resource-Policy', 'cross-origin');
    reply.header('Cache-Control', 'public, max-age=86400');
    return new StreamableFile(stream, { type: mimeType });
  }

  @ApiOperation({ description: 'Serve a doctor verification document. Owning doctor and admins only.' })
  @UseGuards(CookieAuthGuard)
  @Get('doctor-documents/:fileName')
  async getDoctorDocument(
    @Param('fileName') fileName: string,
    @CurrentUser() user: User,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const document = await this.prisma.doctorDocument.findFirst({
      where: { fileUrl: `/uploads/doctor-documents/${fileName}` },
      select: { doctor: { select: { userId: true } } },
    });
    if (!document) {
      throw new NotFoundException('File not found.');
    }
    if (!user.isAdmin && !user.isSuperAdmin && document.doctor.userId !== user.id) {
      throw new ForbiddenException('You do not have access to this document.');
    }

    const { stream, mimeType } = await this.fileUploadService.openFile('doctor-documents', fileName);

    reply.header('Cache-Control', 'private, no-store');
    return new StreamableFile(stream, { type: mimeType });
  }
}
