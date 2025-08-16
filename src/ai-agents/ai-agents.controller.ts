import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { FastifyRequest, FastifyReply } from 'fastify';
import { CurrentUser } from '../user/decorators/current-user.decorator';
import { User } from '@prisma/client';
import { BotpressService } from './botpress.service';
import * as chat from '@botpress/chat';
import { ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/auth/guards/jwt.guard';

@ApiTags('Ai Agents')
@Controller('ai-agents')
export class AiAgentsController {
  constructor(private readonly aiService: BotpressService) {}

  @Post('start')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  async start(@CurrentUser() user: User) {
    const { conversationId } = await this.aiService.start(user);
    return { conversationId };
  }

  @UseGuards(JwtAuthGuard)
  @Post('message')
  @HttpCode(204)
  async send(
    @CurrentUser() user: User,
    @Body() body: { conversationId: string; text: string },
  ) {
    await this.aiService.send(user, body.conversationId, body.text);
  }

  @UseGuards(JwtAuthGuard)
  @Get('stream/:conversationId')
  async stream(
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
    @CurrentUser() user: User,
    @Param('conversationId') conversationId: string,
  ) {
    // Take full control of the underlying socket (required for long-lived streams in Fastify)
    reply.hijack();

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // (optional) Allow proxies/CDNs to pass through streaming
      'X-Accel-Buffering': 'no',
    });

    const { listener } = await this.aiService.listen(user, conversationId);

    const send = (event: string, data: unknown) => {
      reply.raw.write(`event: ${event}\n`);
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    // Heartbeat to keep intermediaries from closing the stream
    const heartbeat = setInterval(() => {
      reply.raw.write(`: keepalive ${Date.now()}\n\n`);
    }, 15000);

    // Wire Botpress realtime signals → browser
    const onMessage = (ev: chat.Signals['message_created']) =>
      send('message_created', ev);
    const onTyping = (ev: unknown) => send('typing', ev);
    const onStatus = (ev: unknown) => send('status', ev);
    const onError = (err: unknown) => send('error', { message: String(err) });

    listener.on('message_created', onMessage);
    // listener.on('typing', onTyping)
    // listener.on('status_changed', onStatus)
    listener.on('error', onError);

    const cleanup = () => {
      clearInterval(heartbeat);
      try {
        listener.off('message_created', onMessage);
        // listener.off('typing', onTyping)
        // listener.off('status_changed', onStatus)
        listener.off('error', onError);
        listener.disconnect?.();
      } catch {}
      try {
        reply.raw.end();
      } catch {}
    };

    // Fastify exposes the underlying Node req/res; either close event is fine.
    req.raw.on('close', cleanup);
    reply.raw.on('close', cleanup);
  }
}
