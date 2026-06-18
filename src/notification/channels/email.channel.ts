import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class EmailChannel {
  private readonly logger = new Logger(EmailChannel.name);
  private transporter: nodemailer.Transporter;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.transporter = nodemailer.createTransport({
      host: this.configService.get<string>('notification.smtp.host'),
      port: this.configService.get<number>('notification.smtp.port'),
      auth: {
        user: this.configService.get<string>('notification.smtp.user'),
        pass: this.configService.get<string>('notification.smtp.pass'),
      },
    });
  }

  async send(
    userId: string,
    subject: string,
    body: string,
    data?: Record<string, any>,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, firstname: true },
    });
    if (!user) {
      this.logger.warn(`Cannot send email: user ${userId} not found`);
      return;
    }

    try {
      await this.transporter.sendMail({
        from: this.configService.get<string>('notification.smtp.from'),
        to: user.email,
        subject,
        html: this.renderTemplate(subject, body, user.firstname, data),
      });
    } catch (err) {
      this.logger.error(
        `Failed to send email to ${user.email}: ${err.message}`,
      );
    }
  }

  private renderTemplate(
    subject: string,
    body: string,
    firstname: string,
    _data?: Record<string, any>,
  ): string {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #2563eb; color: white; padding: 20px; text-align: center;">
          <h1 style="margin: 0; font-size: 24px;">AI Clinic</h1>
        </div>
        <div style="padding: 20px; background: #f9fafb;">
          <p>Hello ${firstname},</p>
          <h2 style="color: #1f2937;">${subject}</h2>
          <p style="color: #4b5563; line-height: 1.6;">${body}</p>
        </div>
        <div style="padding: 12px 20px; background: #e5e7eb; text-align: center; font-size: 12px; color: #6b7280;">
          AI Clinic &mdash; You received this email because you have an account with us.
        </div>
      </div>
    `;
  }
}
