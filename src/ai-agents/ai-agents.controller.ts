import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { FastifyRequest, FastifyReply } from 'fastify';
import { CurrentUser } from '../user/decorators/current-user.decorator';
import { User } from '@prisma/client';
import { BotpressService } from './botpress.service';
import * as chat from '@botpress/chat';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';
import { OptionalAuthGuard } from '../auth/guards/optional-auth.guard';
import { ApiStandardOkResponse } from '../common/decorators/api-standard-ok-response.decorator';
import { SoapService } from '../soap/soap.service';
import { SendAiMessageDto } from './dto/send-ai-message.dto';

@ApiTags('Ai Agents')
@Controller('ai-agents')
export class AiAgentsController {
  private readonly logger = new Logger(AiAgentsController.name);

  constructor(
    private readonly aiService: BotpressService,
    private readonly soapService: SoapService,
  ) {}

  @ApiOperation({ description: 'Used for logging in the user' })
  @ApiStandardOkResponse('void')
  @UseGuards(OptionalAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('start')
  async start(@CurrentUser() user: User | null) {
    if (user) {
      return this.aiService.start(user);
    }

    return this.aiService.startGuest();
  }

  @UseGuards(OptionalAuthGuard)
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

    const actualConversationId = (
      await this.aiService.getConversation(user, true)
    ).id;
    await this.aiService.send(user, actualConversationId, body.text);
  }

  @UseGuards(CookieAuthGuard)
  @Get('messages/:conversationId')
  async pollMessages(
    @CurrentUser() user: User,
    @Param('conversationId') conversationId: string,
    @Query('dateOffset') dateOffset?: string,
  ) {
    const messages = await this.aiService.pollForNewMessages(
      user,
      conversationId,
      dateOffset ? new Date(dateOffset) : undefined,
    );

    // Check each new message for SOAP tags (handles text + markdown payloads)
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

  /**
   * Guest message polling — allows guests to receive AI responses.
   * No auth required; uses the conversationId from /start as identifier.
   */
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

  @UseGuards(CookieAuthGuard)
  @Get('stream/:conversationId')
  async stream(
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
    @CurrentUser() user: User,
    @Param('conversationId') conversationId: string,
  ) {
    // Take full control of the underlying socket (required for long-lived streams in Fastify)
    reply.hijack();

    // Use the conversationId from the URL — this is what the client received from /start.
    // Do NOT call getConversation() again here; that can create a brand-new conversation
    // instead of using the one the client already has, breaking the message flow.
    const actualConversationId = conversationId;

    try {
      // reply.hijack() bypasses all Fastify/NestJS middleware including CORS.
      // We must emit CORS headers ourselves so the browser does not reject the SSE connection.
      const requestOrigin = (req.headers['origin'] as string | undefined) ?? '';
      const corsHeaders: Record<string, string> = {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no', // Disable buffering in nginx
      };
      if (requestOrigin) {
        corsHeaders['Access-Control-Allow-Origin'] = requestOrigin;
        corsHeaders['Access-Control-Allow-Credentials'] = 'true';
      }
      // Set SSE headers before any writes
      reply.raw.writeHead(200, corsHeaders);

      // Helper to send SSE events with proper formatting.
      // Guards against writes after the stream is closed/destroyed.
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

      // ── Poll mode: tell the client to use polling then close immediately ──────
      if (this.aiService.deliveryMode === 'poll') {
        sendEvent('mode', { mode: 'poll' });
        reply.raw.end();
        return;
      }

      // ── SSE mode (default) ────────────────────────────────────────────────────
      // Send initial connection confirmation
      sendEvent('connected', {
        conversationId: actualConversationId,
        timestamp: new Date().toISOString(),
      });

      // Get listener from service
      const { listener, client } = await this.aiService.listen(
        user,
        actualConversationId,
      );

      // Deduplication: the SDK may fire both the named 'message_created' handler AND
      // the 'unknown' handler for the same event. Track processed IDs to avoid
      // sending duplicates to the client and running SOAP detection twice.
      const processedMessageIds = new Set<string>();

      // Shared logic for handling a bot message_created event.
      const handleBotMessage = (data: Record<string, unknown>) => {
        // Filter user echoes — only forward bot messages
        if (data.userId === client.user.id) {
          return;
        }

        // Deduplicate — skip if we already processed this message ID
        const msgId = data.id as string;
        if (msgId && processedMessageIds.has(msgId)) {
          return;
        }
        if (msgId) processedMessageIds.add(msgId);

        sendEvent('message_created', data);

        // SOAP detection — handles both text and markdown payload types
        const messageText = BotpressService.extractPayloadText(data.payload);
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

      // Named handler — fires when the SDK successfully parses the signal type.
      // In SDK v0.5.x this rarely fires (signals usually arrive via 'unknown'),
      // but we register it for forward compatibility with newer SDK versions.
      const onMessage = (ev: chat.Signals['message_created']) => {
        handleBotMessage(ev as unknown as Record<string, unknown>);
      };

      const onError = (err: unknown) => {
        this.logger.error('Botpress listener error:', err);
        sendEvent('error', { message: String(err) });
      };

      // Fallback handler — catches signals the SDK doesn't parse into named events.
      const onUnknown = (payload: unknown) => {
        let normalized: unknown = payload;
        if (typeof payload === 'string') {
          try {
            normalized = JSON.parse(payload) as unknown;
          } catch {
            // Non-JSON payload (e.g. Botpress "ping" keepalive) — silently ignore
            return;
          }
        }

        const norm = normalized as Record<string, unknown> | null;
        if (!norm || typeof norm.type !== 'string') {
          return; // unrecognised shape, drop silently
        }

        const eventType = norm.type;
        const data = norm.data as Record<string, unknown> | undefined;

        if (eventType === 'message_created' && data) {
          handleBotMessage(data);
          return;
        }

        // message_status_changed is an internal Botpress event — clients don't need it
        if (eventType === 'message_status_changed') {
          return;
        }

        // Forward all other unknown events as-is
        sendEvent(eventType, data ?? norm);
      };

      // Attach event handlers
      listener.on('message_created', onMessage);
      listener.on('error', onError);
      listener.on('unknown', onUnknown);

      // Heartbeat to keep the HTTP connection alive (every 30 seconds).
      // Also refreshes the Botpress client cache deadline so the listener
      // isn't disconnected by the cron cleanup while the stream is active.
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

      // Cleanup function — guarded to be idempotent (multiple close/aborted events can fire)
      const cleanup = async () => {
        if (cleaned) return;
        cleaned = true;
        clearInterval(heartbeatInterval);
        try {
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

      // Handle client disconnect
      req.raw.on('close', cleanup);
      req.raw.on('aborted', cleanup);
      reply.raw.on('close', cleanup);
      // NOTE: 'finish' is intentionally excluded — for SSE streams it fires when data is
      // flushed but the connection may still be live; 'close' handles actual disconnects.

      // Handle errors on the response stream
      reply.raw.on('error', (error) => {
        this.logger.error('SSE stream error:', error);
        cleanup();
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
