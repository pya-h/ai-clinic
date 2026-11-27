import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import * as webpush from 'web-push';
import { EmailChannel } from './email.channel';
import { WebPushChannel } from './web-push.channel';

jest.mock('nodemailer', () => ({
  createTransport: jest.fn(),
}));

jest.mock('web-push', () => ({
  setVapidDetails: jest.fn(),
  sendNotification: jest.fn(),
}));

describe('Notification Channels', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('EmailChannel', () => {
    function createConfig(values: Record<string, unknown>): ConfigService {
      return {
        get: jest.fn((key: string) => values[key]),
      } as unknown as ConfigService;
    }

    it('is a no-op when SMTP host is unconfigured', async () => {
      const prisma = { user: { findUnique: jest.fn() } } as any;
      const channel = new EmailChannel(createConfig({}), prisma);

      await channel.send('u1', 'Subject', 'Body');
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('escapes HTML entities in user name, subject, and body when delivering email', async () => {
      const sendMail = jest.fn().mockResolvedValue(undefined);
      (nodemailer.createTransport as jest.Mock).mockReturnValue({ sendMail });
      const prisma = {
        user: {
          findUnique: jest.fn().mockResolvedValue({
            email: 'p@test.local',
            firstname: '<script>Alice</script>',
          }),
        },
      } as any;
      const channel = new EmailChannel(
        createConfig({
          'notification.smtp.host': 'smtp.test.local',
          'notification.smtp.port': 465,
          'notification.smtp.from': 'noreply@test.local',
        }),
        prisma,
      );

      await channel.send('u1', 'Alert & Update', 'Click <a href="x">bad</a>');

      expect(sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'p@test.local',
          html: expect.stringContaining('&lt;script&gt;Alice&lt;/script&gt;'),
        }),
      );
      expect(sendMail.mock.calls[0][0].html).toContain('Alert &amp; Update');
      expect(sendMail.mock.calls[0][0].html).not.toContain('<script>');
    });

    it('swallows transport errors cleanly without throwing', async () => {
      const sendMail = jest.fn().mockRejectedValue(new Error('SMTP timeout'));
      (nodemailer.createTransport as jest.Mock).mockReturnValue({ sendMail });
      const prisma = {
        user: {
          findUnique: jest.fn().mockResolvedValue({
            email: 'p@test.local',
            firstname: 'Alice',
          }),
        },
      } as any;
      const channel = new EmailChannel(
        createConfig({ 'notification.smtp.host': 'smtp.test.local' }),
        prisma,
      );

      await expect(channel.send('u1', 'Hi', 'Body')).resolves.toBeUndefined();
    });
  });

  describe('WebPushChannel', () => {
    function createConfig(values: Record<string, unknown>): ConfigService {
      return {
        get: jest.fn((key: string) => values[key]),
      } as unknown as ConfigService;
    }

    it('skips push delivery when VAPID keys are missing', async () => {
      const prisma = { pushSubscription: { findMany: jest.fn() } } as any;
      const channel = new WebPushChannel(createConfig({}), prisma);

      await channel.send('u1', 'Title', 'Body');
      expect(prisma.pushSubscription.findMany).not.toHaveBeenCalled();
    });

    it('deactivates 410 Gone subscriptions while keeping valid ones active', async () => {
      const prisma = {
        pushSubscription: {
          findMany: jest.fn().mockResolvedValue([
            { id: 'sub-gone', endpoint: 'https://push.test/1', keys: {} },
            { id: 'sub-ok', endpoint: 'https://push.test/2', keys: {} },
          ]),
          update: jest.fn().mockResolvedValue({}),
        },
      } as any;
      (webpush.sendNotification as jest.Mock)
        .mockRejectedValueOnce({ statusCode: 410 })
        .mockResolvedValueOnce({});

      const channel = new WebPushChannel(
        createConfig({
          'notification.vapid.subject': 'mailto:admin@test.local',
          'notification.vapid.publicKey': 'pub',
          'notification.vapid.privateKey': 'priv',
        }),
        prisma,
      );

      await channel.send('u1', 'Match Ready', 'Doctor matched', {
        matchId: 'm1',
      });

      expect(webpush.sendNotification).toHaveBeenCalledTimes(2);
      expect(prisma.pushSubscription.update).toHaveBeenCalledWith({
        where: { id: 'sub-gone' },
        data: { isActive: false },
      });
    });
  });
});
