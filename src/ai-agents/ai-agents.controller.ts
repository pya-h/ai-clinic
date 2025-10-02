import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
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
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CookieAuthGuard } from 'src/auth/guards/jwt.guard';
import { ApiStandardOkResponse } from 'src/common/decorators/api-standard-ok-response.decorator';

// TODO: Improve Re-connection mechanism
// TODO: Improve the keep alive mechanism and remove setInterval usage.

@ApiTags('Ai Agents')
@Controller('ai-agents')
export class AiAgentsController {
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
    @Body() body: { conversationId: string; text: string },
  ) {
    // Use the conversation ID from the service to ensure consistency
    const actualConversationId = await this.aiService.getConversationId(user);
    console.log(`[Controller] Using conversation ID: ${actualConversationId} (client sent: ${body.conversationId})`);
    await this.aiService.send(user, actualConversationId, body.text);
  }

  @UseGuards(CookieAuthGuard)
  @Post('test')
  async testBotpress(@CurrentUser() user: User) {
    return this.aiService.testBotpress(user);
  }

  @UseGuards(CookieAuthGuard)
  @Get('poll/:conversationId')
  async pollMessages(
    @CurrentUser() user: User,
    @Param('conversationId') conversationId: string,
  ) {
    const actualConversationId = await this.aiService.getConversationId(user);
    return this.aiService.pollForNewMessages(user, actualConversationId);
  }

  @UseGuards(CookieAuthGuard)
  @Post('test-listener')
  async testListener(@CurrentUser() user: User) {
    return this.aiService.testListener(user);
  }

  @UseGuards(CookieAuthGuard)
  @Get('stream/:conversationId')
  async stream(
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
    @CurrentUser() user: User,
    @Param('conversationId') conversationId: string,
  ) {
    try {
      // Take full control of the underlying socket (required for long-lived streams in Fastify)
      reply.hijack();

      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        // (optional) Allow proxies/CDNs to pass through streaming
        'X-Accel-Buffering': 'no',
        'Access-Control-Allow-Origin': 'http://localhost:5173',
        'Access-Control-Allow-Credentials': 'true',
      });

      // Use the conversation ID from the service to ensure consistency
      const actualConversationId = await this.aiService.getConversationId(user);
      console.log(`[Controller] Streaming conversation ID: ${actualConversationId} (client requested: ${conversationId})`);
      
      const { listener } = await this.aiService.listen(user, actualConversationId);

    const send = (event: string, data: unknown) => {
      const payload = { type: event, data };
      console.log(`[SSE] Sending event: ${event}`, payload);
      reply.raw.write(`event: ${event}\n`);
      reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    // Heartbeat to keep intermediaries from closing the stream
    const heartbeat = setInterval(() => {
      reply.raw.write(`: keepalive ${Date.now()}\n\n`);
    }, 15000);

    // Send initial connection confirmation
    send('connected', { conversationId: actualConversationId, timestamp: new Date().toISOString() });

    // Wire Botpress realtime signals → browser
    const onMessage = (ev: chat.Signals['message_created']) => {
      console.log('[Botpress] Message received:', ev);
      send('message_created', ev);
    };
    
    const onError = (err: unknown) => {
      console.error('[Botpress] Error:', err);
      send('error', { message: String(err) });
    };

    // SIMPLE approach - just listen to the events we need
    listener.on('message_created', onMessage);
    listener.on('error', onError);
    
    // Force the listener to connect if it's not already connected
    console.log('[Botpress] Forcing listener connection...');
    try {
      if (typeof (listener as any).connect === 'function') {
        await (listener as any).connect();
        console.log('[Botpress] Listener connect() called successfully');
      }
    } catch (e) {
      console.error('[Botpress] Error calling connect():', e);
    }
    
    // Check if the listener is actually connected
    setTimeout(async () => {
      console.log('[Botpress] Checking listener status...');
      const state = (listener as any)._state;
      console.log('[Botpress] Listener _state:', state);
      
      // If not connected, try to connect
      if (state !== 'connected') {
        console.log('[Botpress] Listener not connected, attempting to connect...');
        try {
          if (typeof (listener as any)._connect === 'function') {
            await (listener as any)._connect();
            console.log('[Botpress] _connect() called successfully');
          }
        } catch (e) {
          console.error('[Botpress] Error calling _connect():', e);
        }
      }
    }, 1000);
    
    console.log(`[SSE] Stream established for conversation: ${actualConversationId}`);

    const cleanup = () => {
      clearInterval(heartbeat);
      console.log('[SSE] Cleaned up heartbeat interval');
      try {
        listener.off('message_created', onMessage);
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
    } catch (error) {
      console.error('[Controller] Error setting up SSE stream:', error);
      try {
        reply.raw.writeHead(500, { 'Content-Type': 'application/json' });
        reply.raw.end(JSON.stringify({ error: 'Failed to establish stream' }));
      } catch (writeError) {
        console.error('[Controller] Error writing error response:', writeError);
      }
    }
  }
}
