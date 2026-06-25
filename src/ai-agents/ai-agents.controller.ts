import {
  BadRequestException,
  Body,
  Controller,
  DefaultValuePipe,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { FastifyRequest, FastifyReply } from 'fastify';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../user/decorators/current-user.decorator';
import { User } from '@prisma/client';
import { BotpressService } from './botpress.service';
import * as chat from '@botpress/chat';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';
import { OptionalAuthGuard } from '../auth/guards/optional-auth.guard';
import { ApiStandardOkResponse } from '../common/decorators/api-standard-ok-response.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { SoapService } from '../soap/soap.service';
import { SendAiMessageDto } from './dto/send-ai-message.dto';
import { RenameConversationDto } from './dto/rename-conversation.dto';

@ApiTags('Ai Agents')
@Controller('ai-agents')
export class AiAgentsController {
  private readonly logger = new Logger(AiAgentsController.name);

  constructor(
    private readonly aiService: BotpressService,
    private readonly soapService: SoapService,
    private readonly prisma: PrismaService,
  ) {}

  @ApiOperation({ description: 'Used for logging in the user' })
  @ApiStandardOkResponse('void')
  @UseGuards(OptionalAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @Post('start')
  async start(@CurrentUser() user: User | null) {
    if (user) {
      return this.aiService.start(user);
    }

    return this.aiService.startGuest();
  }

  @UseGuards(OptionalAuthGuard)
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @Post('message')
  @HttpCode(204)
  async send(
    @CurrentUser() user: User | null,
    @Body() body: SendAiMessageDto,
  ) {
    if (!user) {
      if (!body.conversationId) {
        throw new BadRequestException(
          'conversationId is required for guest messages.',
        );
      }

      await this.aiService.sendGuest(body.conversationId, body.text);
      return;
    }

    if (body.conversationId) {
      const conv = await this.prisma.aiConversation.findFirst({
        where: { id: body.conversationId, userId: user.id },
      });
      if (!conv) throw new ForbiddenException('Access denied.');
    }

    const actualConversationId =
      body.conversationId ??
      (await this.aiService.getConversation(user, true)).id;
    await this.aiService.send(user, actualConversationId, body.text);
  }

  @UseGuards(CookieAuthGuard)
  @Get('messages/:conversationId')
  async pollMessages(
    @CurrentUser() user: User,
    @Param('conversationId') conversationId: string,
    @Query('dateOffset') dateOffset?: string,
  ) {
    const conversation = await this.prisma.aiConversation.findFirst({
      where: { id: conversationId, userId: user.id },
    });
    if (!conversation) throw new ForbiddenException('Access denied.');

    const messages = await this.aiService.pollForNewMessages(
      user,
      conversationId,
      dateOffset ? new Date(dateOffset) : undefined,
    );

    for (const msg of messages) {
      const messageText = BotpressService.extractPayloadText(msg?.payload);
      if (messageText && user?.id && this.soapService.containsSoapTag(messageText)) {
        try {
          await this.soapService.detectAndUpsert(user.id, conversationId, messageText);
        } catch (err) {
          this.logger.error('Failed to save SOAP note during poll:', err);
        }
      }
    }

    return messages;
  }

  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @Get('guest/messages/:conversationId')
  async pollGuestMessages(
    @Param('conversationId') conversationId: string,
    @Query('dateOffset') dateOffset?: string,
  ) {
    return this.aiService.pollGuestMessages(
      conversationId,
      dateOffset ? new Date(dateOffset) : undefined,
    );
  }

  @ApiOperation({ description: 'Full conversation history — all messages (user + bot) in chronological order.' })
  @UseGuards(CookieAuthGuard)
  @Get('history/:conversationId')
  async getConversationHistory(
    @CurrentUser() user: User,
    @Param('conversationId') conversationId: string,
  ) {
    return this.aiService.getConversationHistory(user, conversationId);
  }

  @ApiOperation({ description: 'List all AI conversations for the current user.' })
  @UseGuards(CookieAuthGuard)
  @Get('conversations')
  async listConversations(
    @CurrentUser() user: User,
    @Query('skip', new DefaultValuePipe(0), ParseIntPipe) skip: number,
    @Query('take', new DefaultValuePipe(20), ParseIntPipe) take: number,
  ) {
    return this.aiService.listConversations(user.id, skip, take);
  }

  @ApiOperation({ description: 'Rename an AI conversation.' })
  @UseGuards(CookieAuthGuard)
  @Patch('conversations/:conversationId/rename')
  async renameConversation(
    @CurrentUser() user: User,
    @Param('conversationId') conversationId: string,
    @Body() body: RenameConversationDto,
  ) {
    return this.aiService.renameConversation(user.id, conversationId, body.topic);
  }

  @ApiOperation({ description: 'Start a brand-new AI conversation (ignores existing).' })
  @UseGuards(CookieAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('start/new')
  async startNew(@CurrentUser() user: User) {
    return this.aiService.startNew(user);
  }

  @ApiOperation({ description: 'Resume a specific AI conversation by ID.' })
  @UseGuards(CookieAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('start/:conversationId')
  async resumeConversation(
    @CurrentUser() user: User,
    @Param('conversationId') conversationId: string,
  ) {
    return this.aiService.resumeConversation(user, conversationId);
  }

  @UseGuards(CookieAuthGuard)
  @Get('stream/:conversationId')
  async stream(
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
    @CurrentUser() user: User,
    @Param('conversationId') conversationId: string,
  ) {
    const actualConversationId = conversationId;

    const conversation = await this.prisma.aiConversation.findFirst({
      where: { id: conversationId, userId: user.id },
    });
    if (!conversation) throw new ForbiddenException('Access denied.');

    reply.hijack();

    try {

      // hijack() bypasses Fastify CORS — emit headers manually
      const requestOrigin = (req.headers['origin'] as string | undefined) ?? '';
      const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',').map(o => o.trim());
      const corsHeaders: Record<string, string> = {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      };
      if (requestOrigin && allowedOrigins.includes(requestOrigin)) {
        corsHeaders['Access-Control-Allow-Origin'] = requestOrigin;
        corsHeaders['Access-Control-Allow-Credentials'] = 'true';
      }
      reply.raw.writeHead(200, corsHeaders);

      let cleaned = false;
      const sendEvent = (event: string, data: unknown): boolean => {
        if (cleaned || reply.raw.destroyed || !reply.raw.writable) return false;
        try {
          const payload = JSON.stringify(data);
          reply.raw.write(`event: ${event}\n`);
          reply.raw.write(`data: ${payload}\n\n`);
          return true;
        } catch (error) {
          this.logger.error(`Failed to send SSE event ${event}:`, error);
          return false;
        }
      };

      if (this.aiService.deliveryMode === 'poll') {
        sendEvent('mode', { mode: 'poll' });
        reply.raw.end();
        return;
      }

      sendEvent('connected', {
        conversationId: actualConversationId,
        timestamp: new Date().toISOString(),
      });

      const { listener, client } = await this.aiService.listen(
        user,
        actualConversationId,
      );

      const processedMessageIds = new Set<string>();

      // Debounce: buffer bot messages; merge consecutive ones within 500ms.
      // Botpress splits text + quick-reply options into separate events.
      // Merging keeps them as one message for the client and for SOAP detection.
      let pendingBotMsg: { data: Record<string, unknown>; timer: ReturnType<typeof setTimeout> } | null = null;

      const mergePayloads = (
        a: Record<string, unknown> | undefined,
        b: Record<string, unknown> | undefined,
      ): Record<string, unknown> => {
        const pa = (a ?? {}) as Record<string, unknown>;
        const pb = (b ?? {}) as Record<string, unknown>;
        const result = { ...pa, ...pb };
        if (typeof pa.text === 'string' && typeof pb.text === 'string') {
          result.text = pa.text.length >= pb.text.length ? pa.text : pb.text;
        }
        if (typeof pa.markdown === 'string' && typeof pb.markdown === 'string') {
          result.markdown = pa.markdown.length >= pb.markdown.length ? pa.markdown : pb.markdown;
        }
        return result;
      };

      const processBotMessage = (data: Record<string, unknown>) => {
        const msgId = data.id as string;
        if (msgId) processedMessageIds.add(msgId);

        sendEvent('message_created', data);

        const messageText =
          BotpressService.extractPayloadText(data.payload) ??
          BotpressService.extractPayloadText(data as unknown);
        if (messageText && user?.id && this.soapService.containsSoapTag(messageText)) {
          this.soapService
            .detectAndUpsert(user.id, actualConversationId, messageText)
            .then((soap) => {
              if (soap) {
                sendEvent('soap_ready', { soapId: soap.id, conversationId: actualConversationId });
              }
            })
            .catch((err) => {
              this.logger.error('Failed to save SOAP note:', err);
            });
        }
      };

      const flushPendingBotMsg = () => {
        if (!pendingBotMsg) return;
        const { data } = pendingBotMsg;
        pendingBotMsg = null;
        processBotMessage(data);
      };

      const handleBotMessage = (data: Record<string, unknown>) => {
        if (data.userId === client.user.id) return;

        const msgId = data.id as string;
        if (msgId && processedMessageIds.has(msgId)) return;

        if (pendingBotMsg) {
          clearTimeout(pendingBotMsg.timer);
          const prevId = pendingBotMsg.data.id as string | undefined;
          if (prevId) processedMessageIds.add(prevId);
          const merged = { ...data };
          merged.payload = mergePayloads(
            pendingBotMsg.data.payload as Record<string, unknown> | undefined,
            data.payload as Record<string, unknown> | undefined,
          );
          pendingBotMsg = {
            data: merged,
            timer: setTimeout(flushPendingBotMsg, 500),
          };
        } else {
          pendingBotMsg = {
            data,
            timer: setTimeout(flushPendingBotMsg, 500),
          };
        }
      };

      const onMessage = (ev: chat.Signals['message_created']) => {
        handleBotMessage(ev as unknown as Record<string, unknown>);
      };

      const onError = (err: unknown) => {
        this.logger.error('Botpress listener error:', err);
        sendEvent('error', { message: 'An internal error occurred.' });
      };

      const onUnknown = (payload: unknown) => {
        let normalized: unknown = payload;
        if (typeof payload === 'string') {
          try {
            normalized = JSON.parse(payload) as unknown;
          } catch {
            return;
          }
        }

        const norm = normalized as Record<string, unknown> | null;
        if (!norm || typeof norm.type !== 'string') return;

        const eventType = norm.type;
        const data = norm.data as Record<string, unknown> | undefined;

        if (eventType === 'message_created' && data) {
          handleBotMessage(data);
          return;
        }

        if (eventType === 'message_status_changed') return;

        sendEvent(eventType, data ?? norm);
      };

      listener.on('message_created', onMessage);
      listener.on('error', onError);
      listener.on('unknown', onUnknown);

      const heartbeatInterval = setInterval(() => {
        if (cleaned || reply.raw.destroyed || !reply.raw.writable) {
          clearInterval(heartbeatInterval);
          return;
        }
        try {
          reply.raw.write(`: heartbeat ${Date.now()}\n\n`);
          // Keep the Botpress client cache alive for the duration of this stream
          this.aiService.getConversation(user, true).catch(() => {});
        } catch (error) {
          this.logger.warn('Failed to send heartbeat:', error);
          clearInterval(heartbeatInterval);
        }
      }, 30000);

      const cleanup = async () => {
        if (cleaned) return;
        cleaned = true;
        try {
          clearInterval(heartbeatInterval);
          if (pendingBotMsg) {
            clearTimeout(pendingBotMsg.timer);
            flushPendingBotMsg();
          }
          listener.off('message_created', onMessage);
          listener.off('error', onError);
          listener.off('unknown', onUnknown);
          await this.aiService.releaseListener(user.id, listener);
        } catch (error) {
          this.logger.warn('Error during listener cleanup:', error);
        }
        try {
          if (!reply.raw.destroyed) {
            reply.raw.end();
          }
        } catch (error) {
          this.logger.warn('Error closing SSE connection:', error);
        }
      };

      req.raw.on('close', cleanup);
      req.raw.on('aborted', cleanup);
      reply.raw.on('close', cleanup);

      reply.raw.on('error', (error) => {
        this.logger.error('SSE stream error:', error);
        cleanup().catch((err) => {
          this.logger.warn('Error during SSE error cleanup:', err);
        });
      });
    } catch (error) {
      this.logger.error('Error setting up SSE stream:', error);
      try {
        if (!reply.raw.headersSent) {
          reply.raw.writeHead(500, { 'Content-Type': 'application/json' });
        }
        reply.raw.end(JSON.stringify({ error: 'Failed to establish stream' }));
      } catch (writeError) {
        this.logger.error('Error writing error response:', writeError);
      }
    }
  }
}
