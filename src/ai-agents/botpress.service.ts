import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as chat from '@botpress/chat';
import { User, AiConversations } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

interface UserContext {
  client: chat.AuthenticatedClient;
  /** Prefer reuse: one conversation per user (or you can map per-channel/thread). */
  conversationId?: string;
}

// TODO: Save conversationId in the database per user
// TODO: Add multi conversations per user support
// TODO: Add File Communications.

// TODO: Add Http Polling mechanism as A Plan B in case SSE not works well for a client.
@Injectable()
export class BotpressService {
  private readonly logger = new Logger(BotpressService.name);
  private readonly webhookId: string;
  private readonly users = new Map<string, UserContext>();

  constructor(
    readonly configService: ConfigService,
    private readonly prismaService: PrismaService,
  ) {
    this.webhookId = configService.get<string>('botpress.webhookId');
    if (!this.webhookId) {
      throw new ServiceUnavailableException('Bot Agent Key is missing');
    }
  }

  private async getClient(user: User): Promise<UserContext> {
    this.logger.debug(`Getting client for user=${user.id}, existing clients: ${Array.from(this.users.keys()).join(', ')}`);
    
    const existing = this.users.get(user.id);
    if (existing) {
      this.logger.debug(`Reusing existing client for user=${user.id}, bpUser=${existing.client.user.id}`);
      return existing;
    }

    // creates a Chat-API "user" under the hood
    this.logger.debug(`Creating new Botpress client for user=${user.id}`);
    const client = await chat.Client.connect({ webhookId: this.webhookId });

    const ctx: UserContext = { client };
    this.users.set(user.id, ctx);
    this.logger.debug(
      `Connected new Botpress client for user=${user.id} bpUser=${client.user.id}`,
    );
    return ctx;
  }

  async ensureConversation(user: User): Promise<AiConversations> {
    const ctx = await this.getClient(user);
    
    // If we already have a conversation ID in context, use it
    if (ctx.conversationId) {
      this.logger.debug(`Using cached conversation=${ctx.conversationId} for user=${user.id}`);
      const existing = await this.prismaService.aiConversations.findUnique({
        where: { id: ctx.conversationId }
      });
      if (existing) {
        return existing;
      }
    }
    
    // For now, let's create a fresh conversation to avoid permission issues
    // TODO: In production, you might want to reuse conversations more intelligently
    this.logger.debug(`Creating fresh conversation for user=${user.id} with bpUser=${ctx.client.user.id}`);
    const { conversation } = await ctx.client.createConversation({});
    ctx.conversationId = conversation.id;
    this.logger.debug(`Created new conversation=${conversation.id} for user=${user.id}`);
    
    return this.prismaService.aiConversations.create({
      data: { userId: user.id, id: ctx.conversationId }
    });
  }

  start(user: User) {
    return this.ensureConversation(user);
  }

  async getConversationId(user: User): Promise<string> {
    const ctx = await this.getClient(user);
    if (ctx.conversationId) {
      return ctx.conversationId;
    }
    
    // If not in context, check database
    const conversation = await this.ensureConversation(user);
    return conversation.id;
  }

  async send(user: User, conversationId: string, text: string): Promise<void> {
    this.logger.debug(`Sending message to Botpress: conversationId=${conversationId}, text="${text}"`);
    const ctx = await this.getClient(user);
    
    const result = await ctx.client.createMessage({
      conversationId,
      payload: { type: 'text', text },
    });
    this.logger.debug(`Message sent to Botpress successfully:`, result);
    
    // Add a test to check if we can list messages after sending
    setTimeout(async () => {
      try {
        this.logger.debug(`Checking messages in conversation ${conversationId} after 5 seconds...`);
        const messages = await ctx.client.listMessages({ conversationId });
        this.logger.debug(`Messages in conversation:`, messages);
        
        // Check if there are new messages from the bot
        const botMessages = messages.messages.filter(msg => 
          msg.userId !== ctx.client.user.id && 
          new Date(msg.createdAt) > new Date(Date.now() - 10000) // Last 10 seconds
        );
        
        if (botMessages.length > 0) {
          this.logger.debug(`Found ${botMessages.length} new bot messages that weren't delivered via SSE:`, botMessages);
        }
      } catch (error) {
        this.logger.error(`Error listing messages:`, error);
      }
    }, 5000);
  }

  async listen(user: User, conversationId: string) {
    this.logger.debug(`Setting up listener for conversationId=${conversationId}`);
    const ctx = await this.getClient(user);
    
    try {
      // The SDK wraps Chat API's GET /conversations/:id/listen (SSE). :contentReference[oaicite:1]{index=1}
      this.logger.debug(`Creating listener with client user: ${ctx.client.user.id}`);
      const listener = await ctx.client.listenConversation({ id: conversationId });
      this.logger.debug(`Listener established for conversationId=${conversationId}`);
      
      // Ensure the listener is connected
      this.logger.debug(`Ensuring listener is connected...`);
      try {
        // Check current state
        const currentState = (listener as any)._state;
        this.logger.debug(`Current listener state: ${currentState}`);
        
        if (currentState !== 'connected') {
          this.logger.debug(`Listener not connected, calling connect()...`);
          if (typeof (listener as any).connect === 'function') {
            await (listener as any).connect();
            this.logger.debug(`connect() called successfully`);
          }
          
          // Wait a bit and check state again
          setTimeout(() => {
            const newState = (listener as any)._state;
            this.logger.debug(`Listener state after connect(): ${newState}`);
          }, 500);
        }
      } catch (e) {
        this.logger.error(`Error ensuring listener connection:`, e);
      }
      
      // Wait for the listener to be ready before returning
      let attempts = 0;
      const maxAttempts = 10;
      
      while (attempts < maxAttempts) {
        const state = (listener as any)._state;
        this.logger.debug(`Listener state check attempt ${attempts + 1}: ${state}`);
        
        if (state === 'connected') {
          this.logger.debug(`Listener is connected and ready`);
          break;
        }
        
        if (attempts === 0) {
          // First attempt - try to connect
          try {
            if (typeof (listener as any).connect === 'function') {
              await (listener as any).connect();
            }
          } catch (e) {
            this.logger.error(`Error calling connect():`, e);
          }
        }
        
        // Wait 200ms before next check
        await new Promise(resolve => setTimeout(resolve, 200));
        attempts++;
      }
      
      const finalState = (listener as any)._state;
      this.logger.debug(`Final listener state: ${finalState}`);
      
      if (finalState !== 'connected') {
        this.logger.warn(`Listener may not be properly connected (state: ${finalState})`);
      }
      
      return { client: ctx.client, listener };
    } catch (error) {
      this.logger.error(`Failed to establish listener for conversationId=${conversationId}:`, error);
      // Clear the user context so we can try fresh next time
      this.users.delete(user.id);
      throw error;
    }
  }

  // Method to clear user context (useful for debugging)
  clearUserContext(user: User) {
    this.logger.debug(`Clearing context for user=${user.id}`);
    this.users.delete(user.id);
  }

  // Method to test Botpress bot configuration
  async testBotpress(user: User): Promise<any> {
    const ctx = await this.getClient(user);
    
    try {
      // Test 1: Check if we can create a conversation
      const { conversation } = await ctx.client.createConversation({});
      this.logger.debug(`Test conversation created: ${conversation.id}`);
      
      // Test 2: Send a test message
      const message = await ctx.client.createMessage({
        conversationId: conversation.id,
        payload: { type: 'text', text: 'Test message' },
      });
      this.logger.debug(`Test message sent:`, message);
      
      // Test 3: Wait and check for responses
      await new Promise(resolve => setTimeout(resolve, 3000));
      const messages = await ctx.client.listMessages({ conversationId: conversation.id });
      this.logger.debug(`Messages after test:`, messages);
      
      return { conversation, message, messages };
    } catch (error) {
      this.logger.error(`Botpress test failed:`, error);
      throw error;
    }
  }

  // Method to poll for new messages (workaround for SSE issues)
  async pollForNewMessages(user: User, conversationId: string, lastMessageTime?: Date): Promise<any[]> {
    const ctx = await this.getClient(user);
    
    try {
      const messages = await ctx.client.listMessages({ conversationId });
      
      // Filter for bot messages newer than lastMessageTime
      const cutoffTime = lastMessageTime || new Date(Date.now() - 60000); // Default: last minute
      const newBotMessages = messages.messages.filter(msg => 
        msg.userId !== ctx.client.user.id && 
        new Date(msg.createdAt) > cutoffTime
      );
      
      return newBotMessages;
    } catch (error) {
      this.logger.error(`Error polling for messages:`, error);
      return [];
    }
  }

  // Method to create a manual SSE connection bypassing the SDK
  async createManualSSEConnection(user: User, conversationId: string): Promise<any> {
    const ctx = await this.getClient(user);
    
    try {
      // Try to get the Botpress API URL and create a manual EventSource
      // This is a workaround since the SDK's listener isn't working
      const webhookId = this.webhookId;
      const userId = ctx.client.user.id;
      
      // Construct the SSE URL manually (this might need adjustment based on Botpress API)
      const sseUrl = `https://chat.botpress.cloud/conversations/${conversationId}/listen`;
      
      this.logger.debug(`Attempting manual SSE connection to: ${sseUrl}`);
      this.logger.debug(`With user: ${userId}, webhook: ${webhookId}`);
      
      return {
        sseUrl,
        userId,
        webhookId,
        conversationId,
        note: 'Manual SSE connection details - implement EventSource in controller'
      };
    } catch (error) {
      this.logger.error(`Manual SSE connection failed:`, error);
      throw error;
    }
  }

  // Method to test the SSE listener specifically
  async testListener(user: User): Promise<any> {
    const ctx = await this.getClient(user);
    
    try {
      // Create a test conversation
      const { conversation } = await ctx.client.createConversation({});
      this.logger.debug(`Test listener conversation created: ${conversation.id}`);
      
      // Set up listener
      const listener = await ctx.client.listenConversation({ id: conversation.id });
      this.logger.debug(`Test listener established`);
      
      // Set up event handlers
      const events: any[] = [];
      const eventHandler = (eventName: string) => (data: any) => {
        this.logger.debug(`Test listener received ${eventName}:`, data);
        events.push({ eventName, data, timestamp: new Date() });
      };
      
      listener.on('message_created', eventHandler('message_created'));
      listener.on('error', eventHandler('error'));
      
      // Send a test message
      const message = await ctx.client.createMessage({
        conversationId: conversation.id,
        payload: { type: 'text', text: 'Test listener message' },
      });
      this.logger.debug(`Test message sent:`, message);
      
      // Wait for events
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Check for messages
      const messages = await ctx.client.listMessages({ conversationId: conversation.id });
      
      // Cleanup
      try {
        listener.disconnect?.();
      } catch (e) {
        this.logger.debug(`Error disconnecting test listener:`, e);
      }
      
      return {
        conversation,
        message,
        messages,
        events,
        listenerMethods: Object.getOwnPropertyNames(listener),
        listenerPrototype: Object.getOwnPropertyNames(Object.getPrototypeOf(listener))
      };
    } catch (error) {
      this.logger.error(`Test listener failed:`, error);
      throw error;
    }
  }
}
