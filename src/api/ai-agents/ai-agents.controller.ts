import {
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
import { CookieAuthGuard } from '../auth/guards/jwt.guard';
import { ApiStandardOkResponse } from '../common/decorators/api-standard-ok-response.decorator';

@ApiTags('Ai Agents')
@Controller('ai-agents')
export class AiAgentsController {
  private readonly logger = new Logger(AiAgentsController.name);

  constructor(private readonly aiService: BotpressService) {}

  @ApiOperation({ description: 'Used for logging in the user' })
  @ApiStandardOkResponse('void')
  @UseGuards(CookieAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('start')
  async start(@CurrentUser() user: User) {
    return this.aiService.start(user);
  }

  @UseGuards(CookieAuthGuard)
  @Post('message')
  @HttpCode(204)
  async send(
    @CurrentUser() user: User,
    @Body() body: { conversationId?: string; text: string },
  ) {
    const actualConversationId = (
      await this.aiService.getConversation(user, true)
    ).id; // FIXME: Found the root cause of frontend sometimes creating more than 1 conversation or selecting invalid one.
    await this.aiService.send(user, actualConversationId, body.text);
  }

  @UseGuards(CookieAuthGuard)
  @Get('messages/:conversationId')
  async pollMessages(
    @CurrentUser() user: User,
    @Param('conversationId') conversationId: string,
    @Query('dateOffset') dateOffset?: string,
  ) {
    return this.aiService.pollForNewMessages(
      user,
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

    const actualConversationId = (await this.aiService.getConversation(user))
      .id;
    this.logger.log(
      `Setting up SSE stream for conversation ${actualConversationId}`,
    );

    try {
      // Set SSE headers before any writes
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no', // Disable buffering in nginx
        'Access-Control-Allow-Origin': 'http://localhost:5173',
        'Access-Control-Allow-Credentials': 'true',
      });

      // Helper to send SSE events with proper formatting
      const sendEvent = (event: string, data: unknown): boolean => {
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

      // Send initial connection confirmation
      sendEvent('connected', {
        conversationId: actualConversationId,
        timestamp: new Date().toISOString(),
      });

      // Get listener from service
      const { listener } = await this.aiService.listen(
        user,
        actualConversationId,
      );

      // Set up event handlers BEFORE the listener starts receiving events
      const onMessage = (ev: chat.Signals['message_created']) => {
        this.logger.debug('Botpress message received:', ev);
        sendEvent('message_created', ev);
      };

      const onError = (err: unknown) => {
        this.logger.error('Botpress listener error:', err);
        sendEvent('error', { message: String(err) });
      };

      const onUnknown = (payload: unknown) => {
        this.logger.warn('Botpress emitted unknown signal:', payload);
        let normalized: any = payload;
        if (typeof payload === 'string') {
          try {
            normalized = JSON.parse(payload);
          } catch (error) {
            this.logger.warn(
              'Failed to parse unknown Botpress payload as JSON:',
              error,
            );
          }
        }

        if (normalized?.type && normalized.data) {
          sendEvent(normalized.type, normalized.data);
          return;
        }

        sendEvent('unknown', payload);
      };

      // Attach event handlers
      listener.on('message_created', onMessage);
      listener.on('error', onError);
      listener.on('unknown', onUnknown);

      // Heartbeat to keep connection alive (every 30 seconds)
      const heartbeatInterval = setInterval(() => {
        try {
          reply.raw.write(`: heartbeat ${Date.now()}\n\n`);
        } catch (error) {
          this.logger.warn('Failed to send heartbeat:', error);
          clearInterval(heartbeatInterval);
        }
      }, 30000);

      this.logger.log(
        `SSE stream established for conversation ${actualConversationId}`,
      );

      // Cleanup function
      const cleanup = async () => {
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
        this.logger.debug(
          `SSE stream closed for conversation ${actualConversationId}`,
        );
      };

      // Handle client disconnect
      req.raw.on('close', cleanup);
      req.raw.on('aborted', cleanup);
      reply.raw.on('close', cleanup);
      reply.raw.on('finish', cleanup);

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
